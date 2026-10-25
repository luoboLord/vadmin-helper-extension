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
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
function copyButton(label,text){
  const button=el('button','secondary small',label);button.type='button';
  button.onclick=async()=>{try{await navigator.clipboard.writeText(text);button.textContent='已复制';}catch{button.textContent='复制失败，请手动选中';}setTimeout(()=>{button.textContent=label;},1500);};
  return button;
}
function copyBlock(label,text,buttonLabel='复制'){const box=el('div','compare-cell');const head=el('div','compare-cell-head');head.append(el('span','compare-label',label),copyButton(buttonLabel,text));box.append(head,el('pre','copy-text',text));return box;}
function renderCompare(r){
  const c=r.counts,box=$('compare-result');box.replaceChildren();
  const library=r.libraryError?'链接库刷新失败（'+r.libraryError+'），已用本机缓存 '+stamp(r.libraryUpdatedAt)+' 对比':'链接库已刷新 · '+stamp(r.libraryUpdatedAt);
  const missing=c.missingLinks+c.publicMissing;
  $('compare-status').textContent=(missing||c.newGames?`原表共 ${c.sourceLinks} 条链接，链接库缺少 ${c.missingLinks} 条游戏链接${c.newGames?'（含新游戏 '+c.newGames+' 款）':''}${c.publicMissing?'、'+c.publicMissing+' 条公共链接':''}。`:`链接库已包含原表全部 ${c.sourceLinks} 条链接，无需补录。`)+'\n'+library;
  if(r.tsv){const top=el('div','actions');top.append(copyButton('复制全部清单（表格）',r.tsv));box.append(top);}
  if(r.newGames.length){
    const section=el('div','compare-group');section.append(el('h3',null,'新游戏：先在“游戏配置”新增'));
    section.append(copyBlock('完整名称 / 游戏 / 版本',r.newGames.map(g=>[g.full,g.game,g.version].join('\t')).join('\n'),'复制配置行'));
    for(const g of r.newGames)if(g.renamed.length)section.append(el('p','muted',`「${g.full}」的网址在链接库「${g.renamed.join('、')}」下都已存在，可能只是改了名称，请先确认。`));
    box.append(section);
  }
  if(r.public.length){const section=el('div','compare-group');section.append(el('h3',null,'公共链接'),copyBlock('名称 | 网址',r.public.map(l=>l.name+' | '+l.url).join('\n')));box.append(section);}
  for(const g of r.groups){
    const section=el('div','compare-group'),title=el('h3',null,g.full+' · '+(g.server||'共用'));
    if(g.newGame)title.append(el('span','badge','新游戏'));
    section.append(title);
    for(const cat of g.categories){
      section.append(copyBlock(cat.category,cat.text));
      for(const l of cat.links)if(l.elsewhere.length&&!g.renamed.length)section.append(el('p','muted',`「${l.name}」的网址已在链接库「${l.elsewhere.join('、')}」下，确认此游戏也需要再补录。`));
    }
    if(g.noteText)section.append(copyBlock('游戏备注',g.noteText));
    box.append(section);
  }
  if(r.warnings.length)box.append(el('p','muted','原表提示：'+r.warnings.join('；')+'。'));
}
$('compare').onclick=async()=>{
  const button=$('compare');if(button.disabled)return;button.disabled=true;$('compare-status').textContent='正在刷新链接库并读取客服资料大全…';
  try{const r=await send({type:'source:compare',url:$('sheet-url').value.trim()});$('sheet-url').value=r.result.source;renderCompare(r.result);}
  catch(error){$('compare-status').textContent=error.message;}
  finally{button.disabled=false;}
};
chrome.storage.local.get('sourceSheetConfig').then(({sourceSheetConfig})=>{if(sourceSheetConfig?.url&&!$('sheet-url').value)$('sheet-url').value=sourceSheetConfig.url;}).catch(()=>{});
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
