'use strict';
const $=id=>document.getElementById(id);
$('runtime-version').textContent='当前运行版本：'+(chrome.runtime.getManifest?.().version||'未知');
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
async function run(task){if(busy)return;busy=true;for(const id of ['refresh','save-source'])$(id).disabled=true;notice('正在读取…');try{await task();notice('读取完成，后台页面已同步。');}catch(error){notice(error.message);}finally{busy=false;$('refresh').disabled=false;$('save-source').disabled=!!syncJob?.running;await display().catch(error=>notice(error.message));}}
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
  if(r.serverChanges?.length){
    $('compare-status').textContent=`网址对比：缺少 ${c.missingLinks} 条游戏链接、${c.publicMissing} 条公共链接；另有 ${r.serverChanges.length} 款游戏的专服名称不同。请核对下方明细，再点“对比并写入新增”确认改名。\n`+library;
    const section=el('div','compare-group');section.append(el('h3',null,'专服名称差异（此处只读，尚未修改）'));
    for(const x of r.serverChanges)section.append(el('p','server-audit',`${x.full}\n原表：${x.source.join(' / ')||'共用'}\n链接库：${x.library.join(' / ')||'共用'}`));
    box.append(section);
  }
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
// 同步：后台以原表为准逐款游戏对比，在此勾选确认；执行、核实和恢复都在后台，关闭本页不中断，重新打开可查看。
let syncJob=null,syncTimer=null;
const kindLabel={new:'新游戏',update:'更新',rename:'改名',remove:'原表已删除',public:'公共链接'};
const stateLabel={pending:'未执行',done:'已完成',problem:'有问题',skipped:'已跳过',cancelled:'已放弃',excluded:'未勾选'};
function syncButton(label,handler,secondary=true){const b=el('button',secondary?'secondary small':'small',label);b.type='button';b.onclick=async()=>{b.disabled=true;try{await handler();}catch(error){$('sync-status').textContent=error.message;}finally{b.disabled=false;}};return b;}
function linkButton(label,url){const a=el('a','button secondary small',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function list(title,items,className){if(!items?.length)return null;const box=el('div','change-list '+className);box.append(el('strong',null,title+'（'+items.length+'）'));const ul=el('ul');for(const x of items)ul.append(el('li',null,x));box.append(ul);return box;}
function gameCard(job,g){
  const card=el('div','sync-game'),head=el('label','sync-game-head'),box=el('input');box.type='checkbox';box.checked=g.selected;box.dataset.game=g.key;box.disabled=job.state!=='ready';
  box.onchange=()=>updateConfirm(job);
  head.append(box,el('span','badge',kindLabel[g.kind]||g.kind),el('span','sync-game-name',g.kind==='rename'?g.from+' → '+g.full:g.full));
  if(job.state!=='ready')head.append(el('span','muted',' · '+(stateLabel[g.state]||g.state)));
  card.append(head);
  for(const part of [list('新增',g.added,'add'),list('删除（原表已没有）',g.removed,'remove'),list('专服变化',g.servers,'server'),list('名称/备注修改',g.edited,'edit')])if(part)card.append(part);
  if(g.merged)card.append(el('p','muted',`另有 ${g.merged} 行重复或过时的行将标为“待核对”（插件不再使用，确认后可在飞书删除）。`));
  for(const e of g.errors||[])card.append(el('p','error',e));
  return card;
}
function updateConfirm(job){
  const n=[...document.querySelectorAll('#sync-result input[data-game]')].filter(b=>b.checked).length,b=$('sync-confirm');
  if(b){b.disabled=!n;b.textContent=n?`确认写入（${n} 款）`:'请至少勾选一款';}
}
function renderSync(job){
  syncJob=job;const box=$('sync-result');box.replaceChildren();
  const running=!!job?.running;
  for(const id of ['sync','compare','save-source'])$(id).disabled=running;
  clearTimeout(syncTimer);if(running)syncTimer=setTimeout(()=>pollSync().catch(()=>{}),1500);
  if(!job){$('sync-status').textContent='';return;}
  const games=job.games||[],d=job.done,sum=k=>games.filter(g=>g.selected).reduce((n,g)=>n+(g[k]?.length||0),0);
  let text;
  if(job.state==='ready')text=`以客服资料大全为准，有 ${games.length} 款需要更新链接库：新增 ${sum('added')} 条、删除 ${sum('removed')} 条过时链接、${sum('servers')} 条专服变化，合并 ${games.reduce((n,g)=>n+g.merged,0)} 行重复行。\n请逐款核对，不想改的取消勾选，再点“确认写入”。读取时间：${stamp(job.createdAt)}`;
  else if(job.state==='running'&&running)text=`正在${job.phase}…已核实 ${d.verified} / ${d.total} 项。可关闭本页，写入在后台继续。`;
  else if(job.state==='running')text='上次写入在执行中被中断（浏览器或扩展重启）。点“恢复”先核查已提交的记录，再继续写入。';
  else if(job.state==='paused')text='写入已暂停：'+(job.pause?.message||'原因未知')+`\n已核实 ${d.verified} / ${d.total} 项。`;
  else if(job.state==='cancelled')text='该写入任务已放弃。';
  else if(job.phase==='无需写入')text=`链接库与客服资料大全一致，无需修改。读取时间：${stamp(job.createdAt)}`;
  else text=`写入完成：已核实 ${d.verified} / ${d.total} 项${d.skipped?'，跳过 '+d.skipped+' 项':''}${d.failed?'，失败 '+d.failed+' 项':''}${d.unknown?'，结果未知 '+d.unknown+' 项':''}。`+
    (games.some(g=>g.selected&&g.merged)?'\n重复或过时的行已标为“待核对”，插件不再使用；可在链接库按“状态 = 待核对”筛选后删除。':'');
  if(job.state==='done'&&job.cache)text+='\n'+(job.cache.ok?'插件缓存已刷新。':'写入结果已核实，但插件缓存刷新失败（'+job.cache.error+'），请稍后点“立即刷新”；已写入的内容不受影响。');
  else if(job.state==='done'&&job.phase==='刷新缓存')text+='\n正在刷新插件缓存…';
  $('sync-status').textContent=text;
  const actions=el('div','actions');
  if(job.state==='ready'){
    const confirmButton=syncButton('确认写入',async()=>{
      const skip=[...document.querySelectorAll('#sync-result input[data-game]')].filter(b=>!b.checked).map(b=>b.dataset.game);
      renderSync((await send({type:'source:sync:run',id:job.id,skip})).job);
    },false);confirmButton.id='sync-confirm';
    actions.append(confirmButton,syncButton('取消',async()=>renderSync((await send({type:'source:sync:abandon',id:job.id})).job)));
  }
  if(!running&&job.state==='done'&&d.unknown)actions.append(syncButton('再次核查未知结果',async()=>renderSync((await send({type:'source:sync:resume',id:job.id})).job),false));
  if(!running&&['paused','running'].includes(job.state))actions.append(syncButton('恢复',async()=>renderSync((await send({type:'source:sync:resume',id:job.id})).job),false),syncButton('放弃任务',async()=>{if(confirm('放弃后未执行的项不再写入；已提交但未核实的仍列为“结果未知”。确定放弃？'))renderSync((await send({type:'source:sync:abandon',id:job.id})).job);}));
  if(job.libraryURL)actions.append(linkButton('打开链接库',job.libraryURL));
  if(job.phase!=='无需写入')actions.append(syncButton('下载备份 JSON',async()=>{
    const {backup}=await send({type:'source:sync:backup',id:job.id}),a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,1)],{type:'application/json'}));
    a.href=url;a.download='飞书写入备份-'+new Date(backup.createdAt).toISOString().slice(0,19).replace(/[:T]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }));
  box.append(actions);
  for(const g of games)box.append(gameCard(job,g));
  if(job.warnings?.length)box.append(el('p','muted','原表提示：'+job.warnings.join('；')+'（图片和附件不会同步，请在飞书手动维护）。'));
  if(job.state==='ready')updateConfirm(job);
}
async function pollSync(){renderSync((await send({type:'source:sync:status'})).job);}
$('sync').onclick=async()=>{
  const button=$('sync');if(button.disabled)return;
  for(const id of ['sync','compare'])$(id).disabled=true;$('sync-result').replaceChildren();
  $('sync-status').textContent='正在读取客服资料大全、链接库和游戏配置（不使用缓存）…';
  try{renderSync((await send({type:'source:sync:prepare',url:$('sheet-url').value.trim()})).job);}
  catch(error){$('sync-status').textContent=error.message;}
  finally{if(!syncJob?.running)for(const id of ['sync','compare'])$(id).disabled=false;}
};
chrome.storage.onChanged.addListener((changes,area)=>{const job=area==='local'&&changes.feishuSyncStatus?.newValue;if(job&&(!syncJob||job.id===syncJob.id))renderSync(job);});
pollSync().catch(()=>{});
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
