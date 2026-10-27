'use strict';
// service-worker.js imports these as modules first; importScripts is only for classic loading (tests).
if(!globalThis.WorkToolUpdateService)importScripts('data.js','core.js','entries.js','workbook.js','feishu-library.js','feishu-sheet.js','source-compare.js','feishu-sync.js','feishu-write.js','feishu-sync-job.js','local-update.js','github-update.js','update-service.js');
const updates = WorkToolUpdateService.create({chrome});
// 写入任务的进度摘要放在 storage.local，管理页据此刷新；任务和备份本身在 IndexedDB。
const sync = WorkToolFeishuSyncJob.create({chrome,getConfig:()=>getConfig(),refresh:()=>refresh(),readSheet:url=>WorkToolSourceCompare.read(url),
  notify:feishuSyncStatus=>chrome.storage.local.set({feishuSyncStatus}),...globalThis.__workToolSyncDeps});
let opening,refreshing;
const interval=15*60*1000;
const getConfig=async()=>{
  const {feishuConfig,linkSnapshot}=await chrome.storage.local.get(['feishuConfig','linkSnapshot']);
  if(feishuConfig?.url)return feishuConfig;
  // Upgrade from the local cache, without publishing document addresses in the extension.
  const url=linkSnapshot?.configUrl||linkSnapshot?.source||'';
  if(url){try{WorkToolFeishu.source(url);return {url,revision:0};}catch{}}
  return {url:'',revision:0};
};
async function manager(active=true){
  if(opening)return opening;
  opening=(async()=>{
    const {managerTab}=await chrome.storage.session.get('managerTab');
    if(Number.isInteger(managerTab)){
      try{const tab=await chrome.tabs.get(managerTab);if(tab.url?.split('#')[0]===chrome.runtime.getURL('manager.html'))return active?await chrome.tabs.update(managerTab,{active:true}):tab;}catch{}
    }
    const tab=await chrome.tabs.create({url:chrome.runtime.getURL('manager.html'),active});await chrome.storage.session.set({managerTab:tab.id});return tab;
  })();
  try{return await opening;}finally{opening=null;}
}
// 扩展自己新建的标签不经过标签复用：已打开的同一页面直接切过去，否则新建。
async function focusOrCreate(url,same){
  for(const tab of await chrome.tabs.query({})){
    const current=tab.pendingUrl||tab.url;
    if(!current||!same(current))continue;
    await chrome.windows.update(tab.windowId,{focused:true});
    return chrome.tabs.update(tab.id,{active:true});
  }
  return chrome.tabs.create({url,active:true});
}
const samePage=target=>current=>{try{const a=new URL(current),b=new URL(target);return a.origin===b.origin&&a.pathname===b.pathname;}catch{return false;}};
async function refresh(){
  if(refreshing)return refreshing;
  refreshing=(async()=>{
    const config=await getConfig(),attemptedAt=Date.now();
    if(!config.url){await chrome.storage.local.set({feishuStatus:{state:'unconfigured',attemptedAt}});return {ok:false,error:'请先在数据管理配置飞书链接库地址'};}
    const current=async()=>{const c=await getConfig();return c.url===config.url&&c.revision===config.revision;};
    await chrome.storage.local.set({feishuStatus:{state:'loading',attemptedAt,url:config.url}});
    try{
      const result=await WorkToolFeishu.read(config);
      if(!await current())return {ok:false,error:'读取期间数据源已改变，已忽略旧结果'};
      const updatedAt=Date.now();
      const linkSnapshot={data:result.data,name:'飞书链接库',source:result.source,configUrl:config.url,editorURL:result.editorURL,updatedAt,counts:result.counts};
      const feishuStatus={state:'ready',url:result.source,configUrl:config.url,attemptedAt,updatedAt,counts:result.counts};
      await chrome.storage.local.set({linkSnapshot,feishuStatus});return {ok:true,linkSnapshot,feishuStatus};
    }catch(error){
      const message=error.name==='TimeoutError'?'飞书读取超时，请稍后重试':error.message;
      if(await current()){
        const {linkSnapshot}=await chrome.storage.local.get('linkSnapshot');
        await chrome.storage.local.set({feishuStatus:{state:'error',attemptedAt,url:config.url,error:message,fallback:linkSnapshot?.data?'cache':'empty',updatedAt:linkSnapshot?.updatedAt}});
      }
      return {ok:false,error:message};
    }
  })();
  try{return await refreshing;}finally{refreshing=null;}
}
async function refreshIfDue(){
  const {feishuStatus}=await chrome.storage.local.get('feishuStatus');
  const config=await getConfig();
  if(!config.url)return;
  if(!feishuStatus?.attemptedAt||(feishuStatus.configUrl||feishuStatus.url)!==config.url||Date.now()-feishuStatus.attemptedAt>interval)await refresh();
}
async function installAlarm(){await chrome.alarms.create('feishu-refresh',{periodInMinutes:15});await chrome.alarms.create('github-update',{periodInMinutes:360});}
chrome.runtime.onInstalled.addListener(()=>{installAlarm().then(refreshIfDue).catch(console.error);updates.check().catch(console.error);});
chrome.runtime.onStartup.addListener(()=>{installAlarm().then(refreshIfDue).catch(console.error);updates.check().catch(console.error);});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='feishu-refresh')refreshIfDue().catch(console.error);if(alarm.name==='github-update')updates.check().catch(console.error);});
chrome.action.onClicked.addListener(()=>{manager(true).catch(console.error);});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  // Answered by tab-reuse/background/service-worker.js.
  if(typeof message?.type==='string'&&message.type.startsWith('tab-reuse:'))return;
  (async()=>{
    const isManager=sender.url===chrome.runtime.getURL('manager.html');
    const isUpdate=sender.url===chrome.runtime.getURL('update.html');
    const u=new URL(sender.tab?.url||sender.url||'about:blank');
    const isBackend=u.origin==='https://vadmin.648sy.com'&&WorkToolCore.supportedPath(u.pathname);
    if(!isManager&&!isBackend&&!isUpdate)throw Error('此页面不能操作链接库');
    if(message.type==='updates:get')return {ok:true,...await updates.get()};
    if(message.type==='updates:open'){const url=chrome.runtime.getURL('update.html');await focusOrCreate(url,samePage(url));return {ok:true};}
    if(message.type==='updates:check'||message.type==='updates:configure'){
      if(!isManager&&!isUpdate)throw Error('请在扩展更新页配置或手动检查更新');
      const status=message.type==='updates:check'?await updates.check(true):await updates.configure(message.config);
      return {ok:true,status};
    }
    if(message.type==='links:get'){
      refreshIfDue().catch(console.error);
      return {ok:true,...await chrome.storage.local.get(['linkSnapshot','feishuStatus']),feishuConfig:await getConfig()};
    }
    if(message.type==='links:manager'){await manager(true);return {ok:true};}
    if(message.type==='links:openSource'){
      const config=await getConfig();let target=WorkToolFeishu.source(config.url).url;
      const {linkSnapshot}=await chrome.storage.local.get('linkSnapshot');
      if(linkSnapshot?.configUrl===config.url&&linkSnapshot.editorURL){
        try{
          const edit=new URL(linkSnapshot.editorURL),src=WorkToolFeishu.source(edit.href),table=edit.searchParams.get('table');
          if(src.url===linkSnapshot.source&&/^tbl[A-Za-z0-9]+$/.test(table))target=src.url+'?table='+encodeURIComponent(table);
        }catch{}
      }
      // 同一飞书表格（不论当前在哪个数据表）已打开时切过去，不重复新开。
      await focusOrCreate(target,samePage(target));return {ok:true};
    }
    if(message.type==='links:save')throw Error('新版请在飞书表格直接新增；点击“＋新增链接”打开新表');
    if(!isManager)throw Error('请在数据管理页修改配置或手动刷新');
    if(message.type==='manager:ready'){
      if(sender.tab)await chrome.storage.session.set({managerTab:sender.tab.id});return {ok:true};
    }
    if(message.type==='feishu:refresh')return refresh();
    if(message.type==='feishu:configure'){
      if(sync.busy())throw Error('正在写入飞书，完成或暂停后才能切换数据源');
      const src=WorkToolFeishu.source(message.url);
      await chrome.storage.local.set({feishuConfig:{url:src.url,revision:Date.now()+':'+Math.random()}});
      if(refreshing)await refreshing;
      return refresh();
    }
    if(message.type==='source:compare'){
      // 先刷新链接库，刚在飞书补录的内容就不会再列为缺少；刷新失败时用本机缓存对比并说明。
      const url=WorkToolSourceCompare.source(message.url).url;
      await chrome.storage.local.set({sourceSheetConfig:{url}});
      const [sheet,fresh]=await Promise.all([WorkToolSourceCompare.read(url),refresh()]);
      const {linkSnapshot}=await chrome.storage.local.get('linkSnapshot');
      if(!linkSnapshot?.data)throw Error((fresh.error?fresh.error+'；':'')+'没有可对比的链接库数据，请先在“当前数据”刷新成功');
      const result=WorkToolSourceCompare.compare(sheet,linkSnapshot.data);
      return {ok:true,result:{...result,source:sheet.source,checkedAt:Date.now(),libraryUpdatedAt:linkSnapshot.updatedAt,libraryError:fresh.ok?'':fresh.error}};
    }
    // 写入：重新读取原表、链接库和游戏配置（不用缓存），生成清单待确认；确认后后台串行写入并读回核实。
    if(message.type==='source:sync:prepare'){
      const url=WorkToolSourceCompare.source(message.url).url;
      await chrome.storage.local.set({sourceSheetConfig:{url}});
      return {ok:true,job:await sync.prepare(url)};
    }
    if(message.type==='source:sync:run')return {ok:true,job:await sync.run(message.id)};
    if(message.type==='source:sync:resume')return {ok:true,job:await sync.resume(message.id)};
    if(message.type==='source:sync:abandon')return {ok:true,job:await sync.abandon(message.id)};
    if(message.type==='source:sync:status')return {ok:true,job:await sync.status()};
    if(message.type==='source:sync:backup')return {ok:true,backup:await sync.backup(message.id)};
    throw Error('不支持的操作');
  })().then(reply,error=>reply({ok:false,error:error.message}));
  return true;
});
