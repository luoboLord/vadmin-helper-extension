(function(root){
  'use strict';
  // 写入任务：清单、预期内容、recordId、signature 及请求载荷在提交前存入 IndexedDB；
  // 后台串行执行，内存互斥加事务领取执行权；结果未知时按 recordId 读回，不另建记录。
  const F=root.WorkToolFeishu,Y=root.WorkToolFeishuSync,W=root.WorkToolFeishuWrite;
  const KEEP=5,LEASE=30000,RESEND=[1000,3000],READBACK=[800,2000,4000];
  const FINAL=new Set(['verified','existing','failed','conflict','blocked','skipped','cancelled','unknown']);
  const UNRESOLVED=['prepared','sending','unknown'];
  const settle=(r,ok,fail)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);};
  function idbStore(name='work-tool-feishu-sync'){
    let opening;
    const open=()=>opening||(opening=new Promise((ok,fail)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('jobs',{keyPath:'id'});settle(r,ok,fail);}));
    const read=async(method,arg)=>{const db=await open();return new Promise((ok,fail)=>settle(db.transaction('jobs').objectStore('jobs')[method](arg),ok,fail));};
    const write=async fn=>{const db=await open();return new Promise((ok,fail)=>{const t=db.transaction('jobs','readwrite');let out,error;try{out=fn(t.objectStore('jobs'),e=>{error=e;t.abort();});}catch(e){error=e;t.abort();}t.oncomplete=()=>ok(out);t.onabort=t.onerror=()=>fail(error||t.error);});};
    return {
      get:id=>read('get',id),list:()=>read('getAll'),
      put:job=>write(s=>{s.put(job);}),delete:id=>write(s=>{s.delete(id);}),
      // 同一事务内读出、判断并写回：fn 必须同步，抛错则整笔放弃。
      update:(id,fn)=>write((s,abort)=>{let out;const g=s.get(id);g.onsuccess=()=>{try{out=fn(g.result);s.put(out);}catch(e){abort(e);}};return {get value(){return out;}};}).then(r=>r.value)
    };
  }
  function memoryStore(){
    const jobs=new Map(),copy=v=>v==null?v:structuredClone(v);
    return {get:async id=>copy(jobs.get(id)),list:async()=>[...jobs.values()].map(copy),put:async job=>{jobs.set(job.id,copy(job));},delete:async id=>{jobs.delete(id);},
      update:async(id,fn)=>{const out=fn(copy(jobs.get(id)));jobs.set(id,copy(out));return copy(out);}};
  }
  const DONE=['verified','existing'];
  function gameState(g,ops){
    const mine=ops.filter(o=>o.game===g.key),states=mine.map(o=>o.state);
    if(!g.selected)return 'excluded';
    if(states.every(s=>DONE.includes(s)))return 'done';
    if(states.some(s=>['failed','conflict','blocked','unknown'].includes(s)))return 'problem';
    if(states.some(s=>s==='skipped'))return 'skipped';
    if(states.some(s=>s==='cancelled'))return 'cancelled';
    return 'pending';
  }
  function summary(job,running=false){
    if(!job)return null;
    const ops=job.ops,errors=key=>[...new Set(ops.filter(o=>o.game===key&&o.error).map(o=>o.error))];
    return {id:job.id,state:job.state,phase:job.phase,running,createdAt:job.createdAt,updatedAt:job.updatedAt,source:job.target.source,sheet:job.target.sheet.source,
      libraryURL:job.target.source+'?table='+job.target.tables.library.id,pause:job.pause||null,cache:job.cache||null,error:job.error||'',
      warnings:job.plan.warnings||[],
      games:job.plan.games.map(g=>({key:g.key,full:g.full,from:g.from||'',kind:g.kind,selected:g.selected,merged:g.merged,added:g.added,removed:g.removed,servers:g.servers,edited:g.edited,
        ops:ops.filter(o=>o.game===g.key).length,state:gameState(g,ops),errors:errors(g.key)})),
      done:{verified:ops.filter(o=>DONE.includes(o.state)).length,total:ops.filter(o=>o.state!=='cancelled').length,
        failed:ops.filter(o=>['failed','conflict','blocked'].includes(o.state)).length,unknown:ops.filter(o=>o.state==='unknown').length,skipped:ops.filter(o=>o.state==='skipped').length,
        pending:ops.filter(o=>!FINAL.has(o.state)).length}};
  }
  function create(deps){
    const {store=idbStore(),chrome,getConfig,refresh,readSheet,notify=async()=>{},channel=opts=>W.channel(chrome,opts),
      readTables=F.readTables,readTable=F.readTable,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,owner=crypto.randomUUID()}=deps;
    let active=null,activeId=null,preparing=false;
    const newest=(a,b)=>(b.sequence||0)-(a.sequence||0)||b.createdAt-a.createdAt;
    const latest=async()=>(await store.list()).sort(newest)[0]||null;
    async function save(job){
      job.updatedAt=now();job.owner={id:owner,at:job.updatedAt};
      const saved=await store.update(job.id,cur=>{if(cur?.owner?.id&&cur.owner.id!==owner)throw Error('任务已由其他执行者接管');return job;});
      await notify(summary(saved,activeId===job.id));return saved;
    }
    async function claim(id,states,skip){
      const job=await store.update(id,job=>{
        if(!job)throw Error('写入任务不存在，请重新对比');
        // 已完成但仍有结果未知的行，可再次恢复核查。
        const recheck=job.state==='done'&&states.includes('paused')&&job.ops.some(o=>o.state==='unknown');
        if(!states.includes(job.state)&&!recheck)throw Error(job.state==='done'?'该任务已完成':job.state==='cancelled'?'该任务已放弃':'该任务当前不能执行');
        if(job.owner&&job.owner.id!==owner&&now()-job.owner.at<LEASE)throw Error('该任务刚由另一个执行者处理，请 30 秒后再点“恢复”');
        if(skip){
          for(const g of job.plan.games)g.selected=!skip.includes(g.key);
          if(!job.plan.games.some(g=>g.selected))throw Error('没有勾选任何游戏');
          for(const o of job.ops)if(!job.plan.games.find(g=>g.key===o.game)?.selected)o.state='cancelled';
        }
        return {...job,state:'running',phase:'写入',pause:null,owner:{id:owner,at:now()}};
      });
      await notify(summary(job,true));return job;
    }
    async function prepareInner(url){
      if(active)throw Error('已有写入任务正在执行');
      const jobs=await store.list();
      if(jobs.some(j=>['running','paused'].includes(j.state)))throw Error('有未完成的写入任务，请先“恢复”或“放弃”后再重新对比');
      for(const j of jobs.filter(j=>j.state==='ready'))await store.put({...j,state:'cancelled',phase:'已取消',ops:j.ops.map(o=>({...o,state:'cancelled'}))});
      const config=await getConfig();if(!config.url)throw Error('请先在数据管理配置飞书链接库地址');
      const [sheet,lib]=await Promise.all([readSheet(url),readTables(config,{requireCompact:true})]);
      const stamp=new Date(now()).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'});
      const plan=Y.plan({sheet,library:lib.library,settings:lib.settings,stamp});
      Y.simulate(plan,{sheet,library:lib.library,settings:lib.settings});
      const snapshot=t=>({id:t.id,name:t.name,schema:t.schema,ids:t.ids,records:t.table.recordMap,rev:t.table.latestCSRev});
      const job={id:crypto.randomUUID(),sequence:Math.max(0,...jobs.map(j=>j.sequence||0))+1,createdAt:now(),updatedAt:now(),state:plan.ops.length?'ready':'done',phase:plan.ops.length?'待确认':'无需写入',member:now(),
        target:{configUrl:config.url,configRevision:config.revision,sheet:{source:sheet.source,sheetId:sheet.sheetId},origin:lib.origin,base:lib.base,source:lib.source,
          tables:{library:{id:lib.library.id,schema:lib.library.schema},settings:{id:lib.settings.id,schema:lib.settings.schema}}},
        plan:{counts:plan.counts,warnings:sheet.warnings||[],games:plan.games.map(({ops,...g})=>({...g,selected:true}))},
        ops:plan.ops.map(o=>({...o,recordId:o.recordId||W.recordId(),state:'pending',resends:0,dependsOn:o.dependsOn||[]})),
        snapshot:{library:snapshot(lib.library),settings:snapshot(lib.settings)},pause:null,cache:null};
      await store.put(job);
      const done=(await store.list()).filter(j=>['done','cancelled'].includes(j.state)&&j.id!==job.id).sort(newest);
      for(const old of done.slice(KEEP-1))await store.delete(old.id);
      await notify(summary(job));return summary(job);
    }
    function start(id,states,skip){
      if(preparing)throw Error('正在对比，请稍候');
      if(active)throw Error('已有写入任务正在执行');
      activeId=id;
      const run=(async()=>{try{await claim(id,states,skip);}catch(e){activeId=null;throw e;}})();
      active=run.then(()=>execute(id)).catch(()=>{}).finally(()=>{active=null;activeId=null;});
      return run.then(async()=>summary(await store.get(id),true));
    }
    async function execute(id){
      let job=await store.get(id),ch=null;
      const src={origin:job.target.origin,token:job.target.base};
      const pause=async(reason,message)=>{job.state='paused';job.phase='已暂停';job.pause={reason,message,at:now()};await save(job);return 'pause';};
      async function fresh(){
        const lib=await readTables({url:job.target.source},{requireCompact:true});
        const t=job.target.tables;
        if(lib.base!==job.target.base||lib.library.id!==t.library.id||lib.settings.id!==t.settings.id)throw Object.assign(Error('飞书目标表已变化，任务已暂停；恢复时不会切换写入目标'),{pause:'target'});
        if(lib.library.schema!==t.library.schema||lib.settings.schema!==t.settings.schema)throw Object.assign(Error('飞书表字段结构已变化，任务已暂停，请重新对比'),{pause:'schema'});
        return lib;
      }
      async function verify(op,delays=READBACK){
        const tableId=job.target.tables[op.table].id;
        for(const ms of delays){
          if(ms)await sleep(ms);
          const {table}=await readTable(src,tableId);
          const record=table.recordMap?.[op.recordId];
          if(record){
            const bad=Y.mismatches(record,op.values,table.fieldMap);if(!bad.length)return {state:'match'};
            // 修改：格子仍是旧值，等同于未生效。
            if(op.old&&!Y.mismatches(record,op.old,table.fieldMap).length)continue;
            return {state:'mismatch',fields:bad};
          }
        }
        return {state:'absent'};
      }
      // 修改前确认记录仍在、要改的格子仍是预览时的旧值；已是新值算完成，被他人改过则跳过。
      function setProblem(op,t){
        const record=t.table.recordMap?.[op.recordId];
        if(!record)return {skip:'该记录已被删除，未修改'};
        if(!Y.mismatches(record,op.values,t.table.fieldMap).length)return {already:true};
        const changed=Y.mismatches(record,op.old,t.table.fieldMap).filter(f=>Y.mismatches(record,{[f]:op.values[f]},t.table.fieldMap).length);
        return changed.length?{skip:'「'+changed.join('、')+'」在预览后被他人修改，未覆盖，请重新对比'}:{};
      }
      async function send(op){
        try{await (ch||(ch=channel({origin:job.target.origin,url:job.target.source}))).acquire();}
        catch(e){op.state='prepared';return pause('tab',e.message);}
        // 暂停恢复及重发前重新检查旧值，避免覆盖别人的编辑。
        if(op.kind==='set'){
          const r=setProblem(op,(await fresh())[op.table]);
          if(r.already)return {kind:'already'};
          if(r.skip){op.state='skipped';op.error=r.skip;await save(job);return {kind:'skip'};}
        }
        op.state='sending';op.sentAt=now();await save(job);
        const result=W.classify(await ch.send(op.payload));
        // 登录、CSRF、权限等被拒绝时没有写入；恢复时原载荷重发（同 signature 服务端去重），不占用重发次数。
        if(result.kind==='pause'){op.state='prepared';return pause(result.reason,result.message);}
        return result;
      }
      // 读回确认；不存在或未生效时用原 recordId、原 signature、原载荷重发，最多两次，仍不能核实则保留 unknown。
      async function resolve(op,result,delays){
        if(result.kind==='skip')return;
        let v=await verify(op,delays);
        while(v.state==='absent'&&result.kind!=='error'&&op.resends<RESEND.length){
          await sleep(RESEND[op.resends]);op.resends++;
          result=await send(op);if(result==='pause')return 'pause';
          if(result.kind==='skip')return;
          v=await verify(op);
        }
        if(v.state==='match'){op.state='verified';op.error='';op.verifiedAt=now();}
        else if(v.state==='mismatch'){op.state='conflict';op.error='读回内容与预期不一致：'+v.fields.join('、');}
        else if(result.kind==='error'){op.state='failed';op.error=result.message;}
        else{op.state='unknown';op.error='多次读回仍未确认生效，结果未知；没有另建记录，请稍后点“恢复”再次核查';}
        await save(job);
      }
      async function step(op){
        if(op.state==='pending'){
          const deps=op.dependsOn.map(d=>job.ops.find(o=>o.id===d));
          if(deps.some(d=>!d||!DONE.includes(d.state))){op.state='blocked';op.error='所需的游戏配置修改未成功，本行未写入';await save(job);return;}
          job.phase='写入';const lib=await fresh(),t=lib[op.table];
          if(op.kind==='set'){
            const r=setProblem(op,t);
            if(r.already){op.state='existing';op.error='';await save(job);return;}
            if(r.skip){op.state='skipped';op.error=r.skip;await save(job);return;}
          }else if(t.ids.length+1>Y.LIMIT)return pause('capacity','“'+t.name+'”已达到 '+Y.LIMIT+' 条上限，任务已暂停');
          let cells;try{cells=Y.cells(op.values,t.table.fieldMap,{blank:op.kind==='set'});}catch(e){return pause('schema',e.message);}
          op.signature=crypto.randomUUID();
          op.payload=await W.payload({base:job.target.base,tableId:t.id,recordId:op.recordId,cells,rev:t.table.latestCSRev,rank:op.kind==='add'?t.table.rankInfo?.nextRank:undefined,member:job.member,signature:op.signature,set:op.kind==='set'});
          op.state='prepared';await save(job);
        }
        if(op.state==='prepared'){const r=await send(op);if(r==='pause')return r;job.phase='核实';return resolve(op,r);}
        // 恢复：上次已提交或结果未知，先按 recordId 读回。
        job.phase='核实';
        return resolve(op,{kind:'unknown'},[0,1500]);
      }
      try{
        const config=await getConfig();
        if(config.url!==job.target.configUrl||config.revision!==job.target.configRevision)return await pause('target','数据源配置已改变，任务已暂停；恢复时不会切换写入目标，请改回原数据源或放弃任务');
        await fresh();
        for(const op of job.ops.filter(o=>UNRESOLVED.includes(o.state)))if(await step(op)==='pause')return;
        for(const game of job.plan.games.filter(g=>g.selected)){
          const mine=job.ops.filter(o=>o.game===game.key&&o.state==='pending');if(!mine.length)continue;
          // 整款游戏首次写入前复核：预览后有人改过本款游戏的行或配置，整款跳过，不覆盖。
          if(!game.checked){
            const lib=await fresh();
            if(Y.stale(game,lib.library,lib.settings)){for(const o of mine){o.state='skipped';o.error='预览后链接库中本游戏已被修改，本次未写入，请重新对比';}await save(job);continue;}
            game.checked=true;
          }
          for(const op of mine)if(await step(op)==='pause')return;
        }
        job.state='done';job.phase='刷新缓存';job.pause=null;await save(job);
        let cache;try{cache=await refresh();}catch(e){cache={ok:false,error:e.message};}
        job.cache={ok:!!cache?.ok,error:cache?.ok?'':cache?.error||'缓存刷新失败',at:now()};job.phase='完成';await save(job);
      }catch(e){
        try{if(job.state==='running')await pause(e.pause||'error',(e.name==='TimeoutError'?'飞书读取超时':e.message)+'；已写入的内容不受影响，可稍后点“恢复”');}catch{}
      }finally{await ch?.close();}
    }
    async function abandon(id){
      if(activeId===id)throw Error('任务正在执行，不能放弃');
      const job=await store.update(id,job=>{
        if(!job||!['ready','paused','running'].includes(job.state))throw Error('该任务不能放弃');
        if(job.owner&&job.owner.id!==owner&&now()-job.owner.at<LEASE)throw Error('该任务刚由另一个执行者处理，请稍后再试');
        return {...job,state:'cancelled',phase:'已放弃',ops:job.ops.map(o=>o.state==='pending'||o.state==='prepared'?{...o,state:'cancelled'}:o)};
      });
      await notify(summary(job));return summary(job);
    }
    return {
      prepare:async url=>{if(preparing)throw Error('正在对比，请稍候');preparing=true;try{return await prepareInner(url);}finally{preparing=false;}},abandon,
      run:async(id,skip=[])=>start(id,['ready'],Array.isArray(skip)?skip:[]),resume:async id=>start(id,['paused','running']),
      busy:()=>!!active||preparing,
      status:async()=>{const job=await latest();return summary(job,!!job&&activeId===job.id);},
      backup:async id=>{const job=await store.get(id);if(!job)throw Error('没有找到该任务的备份');return {id:job.id,createdAt:job.createdAt,target:job.target,plan:job.plan,
        ops:job.ops.map(({payload,...o})=>o),snapshot:job.snapshot};},
      idle:()=>active||Promise.resolve()
    };
  }
  const api={create,idbStore,memoryStore,summary};
  root.WorkToolFeishuSyncJob=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
