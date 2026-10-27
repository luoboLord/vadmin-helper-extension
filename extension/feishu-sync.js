(function(root){
  'use strict';
  // 以客服资料大全为准，逐款游戏对齐“链接库_精简”：内容一致的行不动；不一致时在原行改格子，
  // 缺的行新增，多出的重复/过时行标为“待核对”（不删除，确认后可在飞书手动删除）。纯函数，不读写飞书。
  const F=root.WorkToolFeishu,S=root.WorkToolSourceCompare,C=root.WorkToolCore;
  const clean=v=>String(v??'').trim();
  const {norm,urlKey,part,line,ORDER}=S;
  const LIMIT=1000,FIELDS=[...F.COMPACT_CATEGORIES,'游戏备注'],ONE_CELL=true;
  const key=(...parts)=>JSON.stringify(parts);
  const isActive=row=>(clean(row['状态'])||'启用')==='启用';
  const typeOf=row=>clean(row['记录类型'])||'游戏链接';
  const colName=n=>{let s='';for(let x=n;x>0;x=Math.floor((x-1)/26))s=String.fromCharCode(65+(x-1)%26)+s;return s;};
  // 与运行时 filterServer 一致：整格为空或“通用/共用”等为共用；否则按“/”拆分，去掉登录提示后比较。
  function scope(text){
    if(C.isShared(text))return {shared:true,keys:[]};
    return {shared:false,keys:[...new Set(C.splitServers(text).map(C.serverKey))].sort()};
  }
  const scopeKey=s=>s.shared?'*':s.keys.join('/');
  const union=(a,b)=>a.shared||b.shared?{shared:true,keys:[]}:{shared:false,keys:[...new Set([...a.keys,...b.keys])].sort()};
  // 单元格语义：每行“名称 | 网址 | 备注”解析后比较，忽略顺序、空白和网址编码差异。
  function entriesOf(field,text){
    return clean(text).split(/\r?\n/).map(clean).filter(Boolean).map(l=>{
      const p=l.split('|').map(clean);
      if(field==='游戏备注')return {match:'n'+norm(p[0]),text:l,sig:key(norm(p[0]),norm(p.slice(1).join(' | ')))};
      const [name,url,note]=p.length===1?[field,p[0],'']:[p[0],p[1],p.slice(2).join(' | ')];
      return {match:'u'+urlKey(url),text:l,sig:key(norm(name),urlKey(url),norm(note))};
    });
  }
  const canon=(field,text)=>JSON.stringify(entriesOf(field,text).map(e=>e.sig).sort());
  // 原表 → 每款游戏应有的行：同一栏目同一网址（或同一备注）合并专服，再按专服范围分行。
  function desired(sheet){
    const games=new Map();
    sheet.rows.forEach((r,i)=>{
      const [game,version,full,server,category,name,url,note]=r.map(clean);
      const nf=norm(full);if(!nf)return;
      if(!games.has(nf))games.set(nf,{nf,full,game,version,items:[],tokens:[]});
      const g=games.get(nf);
      for(const t of C.isShared(server)?[]:C.splitServers(server))if(!g.tokens.some(x=>C.serverKey(x)===C.serverKey(t)))g.tokens.push(t);
      let item;
      if(url)item={field:ORDER.includes(category)?category:'其他',name:part(name)||category,url,note:part(note),match:'u'+urlKey(url)};
      else if(category==='备注'&&part(name))item={field:'游戏备注',name:part(name),url:'',note:'',match:'n'+norm(part(name))};
      else return;
      const at=sheet.origins?.[i],origin=item.field+' / '+item.name+(at?'：原表 '+colName(at.col)+at.row:'');
      const prev=g.items.find(x=>x.field===item.field&&x.match===item.match),s=scope(server);
      if(prev){prev.scope=union(prev.scope,s);if(!prev.origins.includes(origin))prev.origins.push(origin);return;}
      g.items.push({...item,scope:s,origins:[origin]});
    });
    for(const g of games.values()){
      const rows=new Map();
      for(const item of g.items){const k=scopeKey(item.scope);if(!rows.has(k))rows.set(k,{scope:item.scope,items:[]});rows.get(k).items.push(item);}
      g.rows=[...rows.values()];
    }
    return games;
  }
  function publicItems(sheet){
    const out=[],seen=new Set();
    for(const [name,url]of sheet.public||[]){const uk=urlKey(url);if(!clean(url)||seen.has(uk))continue;seen.add(uk);out.push({name:part(name),url:clean(url)});}
    return out;
  }
  const cellText=(field,items)=>items.filter(x=>x.field===field).map(x=>field==='游戏备注'?x.name:line(x.name,x.url,x.note)).join('\n');
  // 链接库中某款游戏的启用行（含改名前的旧名称），用于对齐和写前复核。
  function gameRows(library,nfs){
    const out=[];
    library.rows.forEach((row,i)=>{if(isActive(row)&&typeOf(row)==='游戏链接'&&nfs.includes(norm(row['完整名称'])))out.push({id:library.ids[i],row});});
    return out;
  }
  const fingerprint=(library,settings,nfs)=>JSON.stringify([gameRows(library,nfs).map(({id,row})=>[id,...['完整名称','专服',...FIELDS].map(f=>clean(row[f]))]),
    // 飞书每次返回的字段顺序不固定，按固定字段列表取值，不能直接序列化整行。
    settings.rows.map((r,i)=>[settings.ids[i],...F.CONFIG_FIELDS.map(f=>clean(r[f]))]).filter(r=>nfs.includes(norm(r[1])))]);
  const publicFingerprint=library=>JSON.stringify(library.rows.map((row,i)=>[library.ids[i],row]).filter(([,row])=>isActive(row)&&typeOf(row)==='公共链接').map(([id,row])=>[id,...FIELDS.map(f=>clean(row[f]))]));
  // 每条链接/备注在两边的差异，供确认前展示。
  function changes(before,after){
    const list=rows=>rows.flatMap(({row})=>FIELDS.flatMap(f=>entriesOf(f,row[f]).map(e=>({...e,field:f,scope:scope(row['专服']),server:clean(row['专服'])}))));
    const a=list(before),b=list(after),out={added:[],removed:[],servers:[],edited:[]};
    for(const e of b){
      const olds=a.filter(x=>x.field===e.field&&x.match===e.match);
      if(!olds.length){out.added.push(e.field+'：'+e.text+(e.server?'（'+e.server+'）':''));continue;}
      const was=olds.map(x=>x.scope).reduce(union);
      if(scopeKey(was)!==scopeKey(e.scope))out.servers.push(e.field+'：'+e.text.split('|')[0].trim()+'　'+([...new Set(olds.map(x=>x.server))].join(' + ')||'共用')+' → '+(e.server||'共用'));
      else if(!olds.some(x=>x.sig===e.sig))out.edited.push(e.field+'：'+olds[0].text+' → '+e.text);
    }
    for(const e of a)if(!b.some(x=>x.field===e.field&&x.match===e.match))out.removed.push(e.field+'：'+e.text+(e.server?'（'+e.server+'）':''));
    for(const k of Object.keys(out))out[k]=[...new Set(out[k])];
    return out;
  }
  function plan({sheet,library,settings,stamp=''}){
    const names=new Set(Object.values(library.table?.fieldMap||{}).map(f=>f.name));
    const has=name=>names.has(name);
    const want=desired(sheet),games=[],ops=[];
    const libGames=new Map();
    library.rows.forEach((row,i)=>{if(isActive(row)&&typeOf(row)==='游戏链接'){const nf=norm(row['完整名称']);if(nf&&!libGames.has(nf))libGames.set(nf,clean(row['完整名称']));}});
    const configs=new Map();settings.rows.forEach((r,i)=>{const nf=norm(r['完整名称']);if(nf&&!configs.has(nf))configs.set(nf,{id:settings.ids[i],row:r});});
    const orders=library.rows.map(r=>clean(r['排序'])).filter(Boolean).map(Number).filter(Number.isFinite);
    let nextOrder=(orders.length?Math.max(...orders):0);
    const tag='插件同步'+(stamp?' '+stamp:'');
    // 改名：原表新出现的游戏，其网址过半都在链接库中某一款原表已没有的游戏下。
    const urls=rows=>new Set(rows.flatMap(({row})=>FIELDS.flatMap(f=>entriesOf(f,row[f]).filter(e=>e.match[0]==='u').map(e=>e.match))));
    const vanished=[...libGames.keys()].filter(nf=>!want.has(nf)),renames=new Map(),claimed=new Set();
    for(const g of want.values()){
      if(libGames.has(g.nf))continue;
      const mine=new Set(g.items.filter(x=>x.url).map(x=>x.match));if(!mine.size)continue;
      const hits=vanished.map(v=>[v,[...urls(gameRows(library,[v]))].filter(u=>mine.has(u)).length]).filter(([,n])=>n*2>=mine.size&&n>0);
      if(hits.length===1&&!claimed.has(hits[0][0])){renames.set(g.nf,hits[0][0]);claimed.add(hits[0][0]);}
    }
    // 修改已有记录时一格一个请求（单格 SetRecord 已实测可用），返回最后一格的编号供依赖。
    const addOp=op=>{
      const parts=op.kind==='set'&&ONE_CELL?Object.keys(op.values).map(f=>({...op,values:{[f]:op.values[f]},old:{[f]:op.old[f]},id:key('set',op.table,op.recordId,f)})):[op];
      for(const p of parts){p.id=p.id||key(p.kind,p.table,p.recordId||ops.length);ops.push(p);}
      return parts.map(p=>p.id);
    };
    for(const g of want.values()){
      const from=renames.get(g.nf),nfs=from?[g.nf,from]:[g.nf],existing=gameRows(library,nfs);
      const full=from?g.full:(libGames.get(g.nf)||configs.get(g.nf)?.row['完整名称']||g.full);
      const tokens=existing.flatMap(({row})=>C.splitServers(row['专服']));
      const serverText=sc=>sc.shared?'':g.tokens.filter(t=>sc.keys.includes(C.serverKey(t))).map(t=>tokens.find(x=>C.serverKey(x)===C.serverKey(t))||t).join('/');
      const target=g.rows.map(r=>({scope:r.scope,items:r.items,values:Object.fromEntries([['完整名称',full],['专服',serverText(r.scope)],...FIELDS.map(f=>[f,cellText(f,r.items)])])}));
      // 对齐：先按相同专服范围，再按共同链接最多配对；配不上的原行标待核对，配不上的新行新增。
      const used=new Set(),pairs=[];
      for(const t of target){const e=existing.find(x=>!used.has(x.id)&&scopeKey(scope(x.row['专服']))===scopeKey(t.scope));if(e){used.add(e.id);pairs.push([t,e]);}}
      for(const t of target.filter(t=>!pairs.some(p=>p[0]===t))){
        const mine=new Set(t.items.map(x=>x.match));let best=null,score=0;
        for(const e of existing.filter(x=>!used.has(x.id))){const n=FIELDS.flatMap(f=>entriesOf(f,e.row[f])).filter(x=>mine.has(x.match)).length;if(n>score){best=e;score=n;}}
        if(best){used.add(best.id);pairs.push([t,best]);}
      }
      const gameOps=[],config=configs.get(g.nf)||(from&&configs.get(from));
      const sourceText=t=>[tag,...t.items.flatMap(x=>x.origins)].join('\n');
      if(!config)gameOps.push(...addOp({kind:'add',table:'settings',values:{'完整名称':g.full,'游戏':g.game,'版本':g.version}}));
      else if(from){
        const values={},old={};
        for(const [f,v]of [['完整名称',g.full],['游戏',g.game],['版本',g.version]])if(clean(config.row[f])!==v){values[f]=v;old[f]=clean(config.row[f]);}
        if(Object.keys(values).length)gameOps.push(...addOp({kind:'set',table:'settings',recordId:config.id,values,old}));
      }
      const deps=[...gameOps];if(!existing.length)nextOrder+=10;
      for(const t of target){
        const pair=pairs.find(p=>p[0]===t);
        if(!pair){
          const order=existing.map(e=>Number(clean(e.row['排序']))).filter(n=>Number.isFinite(n)&&n>0);
          const values={...t.values,'记录类型':'游戏链接','状态':'启用','排序':String(order.length?Math.max(...order):nextOrder)};
          if(has('来源'))values['来源']=sourceText(t);
          gameOps.push(...addOp({kind:'add',table:'library',values,dependsOn:deps}));continue;
        }
        const e=pair[1],values={},old={};
        if(norm(e.row['完整名称'])!==norm(full))values['完整名称']=full;
        if(scopeKey(scope(e.row['专服']))!==scopeKey(t.scope))values['专服']=t.values['专服'];
        for(const f of FIELDS)if(canon(f,e.row[f])!==canon(f,t.values[f]))values[f]=t.values[f];
        if(!Object.keys(values).length)continue;
        if(has('来源'))values['来源']=sourceText(t);
        for(const f of Object.keys(values))old[f]=clean(e.row[f]);
        gameOps.push(...addOp({kind:'set',table:'library',recordId:e.id,values,old,dependsOn:deps}));
      }
      const extra=existing.filter(e=>!used.has(e.id));
      for(const e of extra)gameOps.push(...addOp(retire(e,tag+'：内容已合并到其他行或原表已没有，确认后可删除本行',has)));
      if(!gameOps.length)continue;
      const after=[...pairs.map(([t])=>({row:t.values})),...target.filter(t=>!pairs.some(p=>p[0]===t)).map(t=>({row:t.values}))];
      games.push({key:g.nf,full:g.full,from:from?libGames.get(from):'',kind:from?'rename':existing.length?'update':'new',
        fingerprint:fingerprint(library,settings,nfs),ops:gameOps,merged:extra.length,...changes(existing,after)});
    }
    for(const nf of vanished.filter(v=>!claimed.has(v))){
      const existing=gameRows(library,[nf]),gameOps=existing.flatMap(e=>addOp(retire(e,tag+'：原表已没有此游戏，确认后可删除本行',has)));
      games.push({key:nf,full:libGames.get(nf),kind:'remove',fingerprint:fingerprint(library,settings,[nf]),ops:gameOps,merged:0,...changes(existing,[])});
    }
    // 公共链接集中在一行“其他”栏。
    const pub=publicItems(sheet),pubRows=library.rows.map((row,i)=>({id:library.ids[i],row})).filter(({row})=>isActive(row)&&typeOf(row)==='公共链接');
    const pubText=pub.map(x=>line(x.name,x.url,'')).join('\n');
    if(pub.length){
      const gameOps=[],[first,...rest]=pubRows;
      if(!first){const values={'记录类型':'公共链接','状态':'启用','其他':pubText};if(has('来源'))values['来源']=tag+'\n公共链接：原表第 1 行';gameOps.push(...addOp({kind:'add',table:'library',values}));}
      else{
        const values={};
        if(canon('其他',first.row['其他'])!==canon('其他',pubText))values['其他']=pubText;
        for(const f of FIELDS)if(f!=='其他'&&clean(first.row[f]))values[f]='';
        if(Object.keys(values).length){const old={};for(const f of Object.keys(values))old[f]=clean(first.row[f]);gameOps.push(...addOp({kind:'set',table:'library',recordId:first.id,values,old}));}
      }
      for(const e of rest)gameOps.push(...addOp(retire(e,tag+'：公共链接已合并到另一行，确认后可删除本行',has)));
      if(gameOps.length)games.push({key:'*public',full:'公共链接',kind:'public',fingerprint:publicFingerprint(library),ops:gameOps,merged:rest.length,
        ...changes(pubRows.map(({row})=>({row:{...row,'专服':''}})),[{row:{'其他':pubText}}])});
    }
    for(const game of games)for(const id of game.ops)ops.find(o=>o.id===id).game=game.key;
    const count=kind=>ops.filter(o=>o.kind===kind&&o.table==='library'&&!o.retire).length;
    return {games,ops,counts:{games:games.length,adds:count('add'),sets:count('set'),retires:ops.filter(o=>o.retire).length,configs:ops.filter(o=>o.table==='settings').length,
      links:games.reduce((n,g)=>n+g.added.length,0),removed:games.reduce((n,g)=>n+g.removed.length,0)}};
  }
  function retire(e,reason,has){
    // 先写原因，再改状态：中途中断时不会出现没有说明的待核对行。
    const values={},old={};
    if(has('核对说明')){values['核对说明']=[clean(e.row['核对说明']),reason].filter(Boolean).join('\n');old['核对说明']=clean(e.row['核对说明']);}
    values['状态']='待核对';old['状态']=clean(e.row['状态']);
    return {kind:'set',table:'library',recordId:e.id,values,old,retire:true,full:clean(e.row['完整名称']),dependsOn:[]};
  }
  // 写入前在最新数据上复核：本款游戏的行或配置自预览后有变化则整款跳过，避免覆盖他人的修改。
  function stale(game,library,settings){
    if(game.key==='*public')return publicFingerprint(library)!==game.fingerprint;
    const nfs=JSON.parse(game.fingerprint)[0].map(r=>norm(r[1]));
    return fingerprint(library,settings,[...new Set([game.key,...nfs])])!==game.fingerprint;
  }
  // 模拟全部修改后的完整数据：必须能被现有读取链路接受，且再次对比没有任何修改。
  function simulate(result,{sheet,library,settings}){
    const blank=names=>Object.fromEntries(names.map(n=>[n,'']));
    const lib={ids:[...library.ids],rows:library.rows.map(r=>({...r})),table:library.table},cfg={ids:[...settings.ids],rows:settings.rows.map(r=>({...r}))};
    result.ops.forEach((op,n)=>{
      const t=op.table==='library'?lib:cfg;
      if(op.kind==='set'){const i=t.ids.indexOf(op.recordId);if(i<0)throw Error('模拟修改找不到原记录');Object.assign(t.rows[i],op.values);}
      else{t.ids.push('recSimulated'+n);t.rows.push({...blank(op.table==='library'?[...F.COMPACT_FIELDS,'来源','核对说明']:F.CONFIG_FIELDS),...op.values});}
    });
    if(lib.rows.length>LIMIT)throw Error('写入后链接库将超过 '+LIMIT+' 条，已整批停止');
    if(cfg.rows.length>LIMIT)throw Error('写入后游戏配置将超过 '+LIMIT+' 条，已整批停止');
    F.payload(F.expandCompact(lib.rows,cfg.rows),cfg.rows);
    const again=plan({sheet,library:lib,settings:cfg});
    if(again.games.length)throw Error('模拟写入后仍有 '+again.games.length+' 款游戏需要修改（'+again.games.map(g=>g.full).join('、')+'），已停止，请反馈此问题');
    return {libraryRows:lib.rows.length,configRows:cfg.rows.length};
  }
  // 按实时字段定义生成单元格；字段或选项不存在时报错，不让服务端静默写空。blank 为 true 时空值写成空格子（用于清空）。
  function segments(text,links){
    const out=[],push=s=>{const last=out[out.length-1];if(s.type==='text'&&last?.type==='text')last.text+=s.text;else out.push(s);};
    text.split('\n').forEach((ln,i)=>{
      if(i)push({type:'text',text:'\n'});
      const parts=ln.split('|').map(clean);
      if(!links||!/^https?:\/\//i.test(parts.length===1?parts[0]:parts[1]||'')){push({type:'text',text:ln});return;}
      const url=parts.length===1?parts[0]:parts[1];
      if(parts.length>1)push({type:'text',text:parts[0]+' | '});
      push({type:'url',text:url,link:url});
      if(parts.length>2)push({type:'text',text:' | '+parts.slice(2).join(' | ')});
    });
    return out;
  }
  function fieldsByName(fieldMap){
    const map=new Map();
    for(const [id,f]of Object.entries(fieldMap||{})){if(map.has(f.name))throw Error('表格存在重名字段');map.set(f.name,{id,...f});}
    return map;
  }
  function cells(values,fieldMap,{blank=false}={}){
    const fields=fieldsByName(fieldMap),out={};
    for(const [name,v]of Object.entries(values)){
      const text=clean(v),f=fields.get(name);
      if(!f)throw Error('目标表缺少字段：'+name);
      if(!text){if(blank){if(f.type!==1)throw Error('字段「'+name+'」不能清空');out[f.id]={type:1,value:[]};}continue;}
      if(f.type===1)out[f.id]={type:1,value:segments(text,F.COMPACT_CATEGORIES.includes(name))};
      else if(f.type===3){
        const options=(f.property?.options||[]).filter(o=>o.name===text);
        if(options.length!==1)throw Error('字段「'+name+'」没有唯一的选项「'+text+'」，未写入');
        out[f.id]={type:3,value:options[0].id};
      }else if(f.type===2){
        const n=Number(text);if(!Number.isFinite(n))throw Error('字段「'+name+'」需要数字');
        out[f.id]={type:2,value:n};
      }else throw Error('字段「'+name+'」的类型不支持自动写入');
    }
    return out;
  }
  // 读回核实：写入的每个字段解析后必须与预期一致。返回不一致的字段名。
  function mismatches(record,values,fieldMap){
    const fields=fieldsByName(fieldMap);
    return Object.entries(values).filter(([name,v])=>{
      const f=fields.get(name);if(!f)return true;
      let actual;try{actual=F.cellValue(record?.[f.id],f);}catch{return true;}
      return clean(actual)!==clean(v);
    }).map(([name])=>name);
  }
  const api={LIMIT,scope,desired,plan,stale,simulate,segments,cells,mismatches,canon};
  root.WorkToolFeishuSync=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
