'use strict';
const $=id=>document.getElementById(id);
const notice=text=>{$('notice').textContent=text;};
const stamp=time=>time?new Date(time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'尚未同步';
async function displayUpdate(){
  const r=await send({type:'updates:get'}),s=r.status;
  $('extension-update-status').textContent=!r.config?'尚未配置GitHub更新源':s?.state==='error'?'更新检查失败：'+s.error:s?.available?'发现新版 '+s.version+'，点击下方入口更新':s?.state==='current'?'扩展已是最新版本':'尚未检查更新';
}
let busy=false;
async function send(message){const r=await chrome.runtime.sendMessage(message);if(!r?.ok)throw Error(r?.error||'扩展连接已失效，请重新打开本页');return r;}
async function display(initial=false){
  const result=await send({type:'links:get'}),s=result.feishuStatus,snapshot=result.linkSnapshot;
  if(initial)$('source-url').value=result.feishuConfig.url;
  if(s?.state==='loading')$('data-status').textContent='正在从飞书读取…当前仍显示已有数据';
  else if(s?.state==='ready')$('data-status').textContent='已读取飞书链接库 · '+stamp(s.updatedAt);
  else if(s?.state==='error')$('data-status').textContent=s.error+'；'+(snapshot?.data?'正在使用上次缓存（仅本机）':'尚无本机链接数据');
  else $('data-status').textContent=snapshot?.data?'尚未完成本次同步，正在使用上次本机缓存':'尚未读取飞书，请配置地址并登录有权限的账号';
  const counts=snapshot?.counts;
  $('data-detail').textContent=snapshot?.data?`${counts?counts.links+' 条游戏链接 · '+counts.games+' 款游戏 · '+counts.pending+' 条待核对 · ':''}缓存时间：${stamp(snapshot.updatedAt)}${snapshot.source?' · 来源：'+snapshot.source:''}`:'请先把规范链接库导入飞书，再点击立即刷新。';
  const publicLinks=snapshot?.data?.public||[];const list=$('public-links');list.replaceChildren();$('public-section').hidden=!publicLinks.length;
  for(const link of publicLinks){if(!/^https?:\/\//i.test(link.url))continue;const a=document.createElement('a');a.textContent=link.name;a.href=link.url;a.target='_blank';a.rel='noopener noreferrer';list.append(a,document.createTextNode('　'));}
}
async function run(task){if(busy)return;busy=true;for(const id of ['refresh','save-source'])$(id).disabled=true;notice('正在读取…');try{await task();notice('读取完成，后台页面已同步。');}catch(error){notice(error.message);}finally{busy=false;for(const id of ['refresh','save-source'])$(id).disabled=false;await display().catch(error=>notice(error.message));}}
$('refresh').onclick=()=>run(()=>send({type:'feishu:refresh'}));
$('save-source').onclick=()=>run(()=>send({type:'feishu:configure',url:$('source-url').value.trim()}));
$('open').onclick=()=>send({type:'links:openSource'}).catch(error=>notice(error.message));
$('backup').onclick=async()=>{
  try{const backup=await WorkToolFiles.state('backup');if(!backup)throw Error('没有旧版修改前备份');const a=document.createElement('a'),url=URL.createObjectURL(new Blob([backup.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));a.href=url;a.download='旧版修改前备份-'+backup.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);notice('已导出备份：'+stamp(backup.createdAt));}catch(error){notice(error.message);}
};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.feishuStatus||changes.linkSnapshot))display().catch(error=>notice(error.message));});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.githubUpdateStatus||changes.githubUpdateConfig))displayUpdate().catch(()=>{});});
displayUpdate().catch(error=>{$('extension-update-status').textContent=error.message;});
(async()=>{
  try{
    await send({type:'manager:ready'});await display(true);
    const all=await chrome.storage.local.get(null),pending=Object.entries(all).filter(([k,r])=>k.startsWith('draft:')&&r?.entry&&r.status!=='done');
    $('legacy-section').hidden=!pending.length;
    for(const [,r]of pending){const item=document.createElement('p');item.textContent=[r.entry.full,r.entry.server||'共用',r.entry.name,r.entry.url].join(' · ');$('requests').append(item);}
  }catch(error){notice(error.message);}
})();
