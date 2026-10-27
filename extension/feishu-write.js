(function(root){
  'use strict';
  // 飞书页面写入通道：新增单条记录，或整格覆盖一条已有记录的若干格子。
  // CSRF 只在页面内临时读取，不返回、不保存；载荷不含任何认证信息。
  const ALPHABET='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  function recordId(){
    const out=[];
    while(out.length<13)for(const b of crypto.getRandomValues(new Uint8Array(16)))if(b<248&&out.length<13)out.push(ALPHABET[b%62]);
    return 'rec'+out.join('');
  }
  async function gzip64(text){
    const buf=await new Response(new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    let bin='';for(const b of new Uint8Array(buf))bin+=String.fromCharCode(b);
    return btoa(bin);
  }
  // 单元格只允许文字/网址分段、单选选项编号或数字，字段编号必须来自本次读到的字段定义（由调用方校验）。
  const validCell=c=>c?.type===1?Array.isArray(c.value)&&c.value.every(s=>(s?.type==='text'||s?.type==='url')&&typeof s.text==='string'&&(s.type==='text'?s.link==null:typeof s.link==='string'&&/^https?:\/\//i.test(s.link)))
    :c?.type===3?typeof c.value==='string':c?.type===2&&Number.isFinite(c.value);
  // 完整请求载荷在提交前持久化；恢复时原样重发，由 signature 和 recordId 两层去重。
  // set：整格覆盖已有记录的若干格子；否则新增一条记录。
  async function payload({base,tableId,recordId:id,cells,rev,rank,member,signature,set=false}){
    if(!/^[A-Za-z0-9]+$/.test(base)||!/^tbl[A-Za-z0-9]+$/.test(tableId)||!/^rec[A-Za-z0-9]{13}$/.test(id))throw Error('写入目标无效');
    const entries=Object.entries(cells||{});
    if(!entries.length||entries.some(([fid,c])=>!/^fld[A-Za-z0-9]+$/.test(fid)||!validCell(c)))throw Error('写入内容无效');
    const data={cellData:cells};if(rank)data.tableRank=rank;
    const ops=[set?{command:'SetRecord',type:2,actions:[{action:'data.setRecord',type:2,tableId,recordId:id,data:cells}],syncFlag:0}
      :{command:'AddRecordV2',type:2,actions:[{action:'data.addRecordV2',type:2,tableId,recordId:id,data}],syncFlag:0}];
    return {type:'BITABLE_TABLE',data:{member_id:member,user_ticket:'',type:'USER_CHANGES',token:tableId,lang:'zh',suiteLang:'zh',localRev:rev,
      operations:await gzip64(JSON.stringify(ops)),signature,content_type:'gzip/base64',route_key:base},version:2,req_id:1,context:{os:'windows',platform:'web'}};
  }
  // 注入页面执行，必须自包含。只接受单条记录的 AddRecordV2 或 SetRecord，地址固定，不能用来请求任意地址。
  async function pageSend(request){
    try{
      if(location.origin!==request?.origin)return {error:'origin'};
      const p=request.payload,d=p?.data;
      if(p?.type!=='BITABLE_TABLE'||d?.type!=='USER_CHANGES'||d.content_type!=='gzip/base64'||typeof d.operations!=='string'||!/^tbl[A-Za-z0-9]+$/.test(d.token||''))return {error:'payload'};
      const bytes=Uint8Array.from(atob(d.operations),c=>c.charCodeAt(0));
      const ops=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
      const a=ops?.[0]?.actions?.[0];
      const add=ops?.[0]?.command==='AddRecordV2'&&a?.action==='data.addRecordV2'&&a.data?.cellData&&typeof a.data.cellData==='object';
      const set=ops?.[0]?.command==='SetRecord'&&a?.action==='data.setRecord'&&a.data&&typeof a.data==='object'&&Object.keys(a.data).length>0;
      if(!Array.isArray(ops)||ops.length!==1||!(add||set)||ops[0].actions.length!==1||a.tableId!==d.token||!/^rec[A-Za-z0-9]{13}$/.test(a.recordId||''))return {error:'operation'};
      const csrf=decodeURIComponent((document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/)||[])[1]||'');
      if(!csrf)return {csrf:true};
      let response;
      try{
        response=await fetch('/space/api/rce/messages?member_id='+encodeURIComponent(d.member_id),{method:'POST',credentials:'include',
          headers:{'Content-Type':'application/json','X-CSRFToken':csrf,'x-command':'api.bitable.rce.message'},body:JSON.stringify(p),signal:AbortSignal.timeout(20000)});
      }catch(e){return {network:String(e?.name||'error')};}
      let json=null;try{json=JSON.parse(await response.text());}catch{}
      const str=v=>typeof v==='string'?v.slice(0,200):undefined;
      return {status:response.status,code:json?.code,msg:str(json?.msg),dataType:json?.data?.type,dataCode:json?.data?.code,dataMsg:str(json?.data?.msg),rev:json?.data?.rev};
    }catch(e){return {error:'page:'+String(e?.name||'error')};}
  }
  // pause：确定没有写入或需要用户处理，任务暂停；unknown：可能已写入，必须按 recordId 读回。
  function classify(r){
    if(!r||r.bridge)return {kind:'unknown',message:'页面通道中断'+(r?.bridge?'（'+r.bridge+'）':'')};
    if(r.error)return {kind:'pause',reason:'bridge',message:'页面写入通道拒绝了请求（'+r.error+'）'};
    if(r.csrf||r.status===403)return {kind:'pause',reason:'csrf',message:'飞书安全校验或编辑权限未通过，请刷新飞书页面、确认有编辑权限后点“恢复”'};
    if(r.network)return {kind:'unknown',message:'网络异常（'+r.network+'）'};
    if(r.status===401||r.code===5)return {kind:'pause',reason:'login',message:'飞书登录已失效，请重新登录后点“恢复”'};
    if(!r.status||r.status>=500)return {kind:'unknown',message:'飞书服务异常（HTTP '+r.status+'）'};
    if(r.status!==200)return {kind:'pause',reason:'http',message:'飞书拒绝写入（HTTP '+r.status+'），请检查编辑权限'};
    if(r.code!=null&&r.code!==0)return {kind:'pause',reason:'permission',message:'飞书拒绝写入（'+r.code+(r.msg?' '+r.msg:'')+'），请检查编辑权限'};
    if(r.dataType==='ACCEPT_COMMIT')return {kind:'accepted',rev:r.rev};
    if(r.dataType==='ERROR')return {kind:'error',message:'飞书返回错误 '+r.dataCode+(r.dataMsg?' '+r.dataMsg:'')};
    return {kind:'unknown',message:'飞书返回无法识别的结果'};
  }
  // 选用同域名已打开的飞书标签；没有时在后台新开一个，任务结束后关闭。
  function channel(chrome,{origin,url,timeout=30000}){
    let tabId=null,created=false;
    const same=u=>{try{return new URL(u).origin===origin;}catch{return false;}};
    async function acquire(){
      if(tabId!=null){try{const t=await chrome.tabs.get(tabId);if(t.status==='complete'&&same(t.url))return tabId;}catch{}tabId=null;}
      const ok=(await chrome.tabs.query({url:origin+'/*'})).find(t=>t.status==='complete'&&!t.discarded&&same(t.url));
      if(ok)return tabId=ok.id;
      const t=await chrome.tabs.create({url,active:false});tabId=t.id;created=true;
      for(const until=Date.now()+timeout;Date.now()<until;){
        await sleep(500);
        const x=await chrome.tabs.get(tabId);
        if(x.status==='complete'){if(!same(x.url))throw Error('飞书页面没有停留在目标域名，请先在此浏览器登录飞书');return tabId;}
      }
      throw Error('打开飞书页面超时');
    }
    async function send(body){
      const id=await acquire();
      try{
        const [result]=await chrome.scripting.executeScript({target:{tabId:id},world:'MAIN',func:pageSend,args:[{origin,payload:body}]});
        return result?.result??{bridge:'没有返回结果'};
      }catch(e){return {bridge:String(e?.message||e).slice(0,200)};}
    }
    async function close(){const id=tabId;tabId=null;if(created&&id!=null){created=false;await chrome.tabs.remove(id).catch(()=>{});}}
    return {acquire,send,close};
  }
  const api={recordId,gzip64,payload,pageSend,classify,channel};
  root.WorkToolFeishuWrite=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
