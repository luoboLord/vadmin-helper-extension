(() => {
  'use strict';
  const core = globalThis.WorkToolCore;
  let data = globalThis.WorkToolData;
  let feishuStatus=null;
  let updateStatus=null;
  if (!core || !data || !core.supportedPath(location.pathname)) return;
  const host = document.createElement('div');
  host.id = 'work-tool-game-links';
  host.style.cssText = 'all:initial;position:fixed;right:20px;bottom:24px;z-index:2147483646;display:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  // 紧凑布局：专服标签与链接同排、链接按钮不在中间折行、底部操作和状态合成一行，尽量少占屏幕。
  style.textContent = `
    :host { color-scheme:light; } * { box-sizing:border-box; }
    .panel { width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 32px);display:flex;flex-direction:column;border:1px solid #d5ddea;border-radius:10px;
      background:#f3f6fb;color:#1f2d42;font:13px/1.45 "Microsoft YaHei","PingFang SC",sans-serif;box-shadow:0 10px 32px #0f1f3a2e;overflow:hidden; }
    header { flex-shrink:0;padding:6px 8px 6px 12px;background:#fff;cursor:move;touch-action:none;user-select:none;border-bottom:1px solid #e3e9f2; }
    .top { display:flex;align-items:baseline;gap:8px; } strong { font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%; }
    .source { flex:1;min-width:0;font-size:11px;color:#6b788c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    button { font:inherit;font-size:12px;border:0;border-radius:5px;background:#e8eef9;color:#24539f;padding:2px 8px;cursor:pointer;white-space:nowrap; }
    button:hover { background:#d9e5fb; } button.ghost { background:none;color:#5d6b82; } button.ghost:hover { background:#eef2f8;color:#1f2d42; }
    main { padding:6px;min-height:48px;flex:1;max-height:min(600px,calc(100vh - 110px));overflow:auto;overscroll-behavior:contain; }
    section { background:#fff;border:1px solid #e6ebf3;border-radius:7px;padding:6px 8px;margin-bottom:6px; } section:last-child { margin-bottom:0; }
    h2 { font-size:12px;color:#4b5970;margin:0 0 4px; }
    .group { padding:3px 0; } .group + .group { border-top:1px dashed #e6ebf3; }
    .links { display:flex;flex-wrap:wrap;gap:4px;align-items:center; }
    .tag { font-size:11px;color:#6b788c;background:#f0f3f8;border-radius:4px;padding:1px 6px;white-space:nowrap; }
    .highlight .tag { color:#7d5300;background:#fff1cc;font-weight:bold; }
    a { display:inline-block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none;color:#1f4f9e;background:#edf3ff;
      border:1px solid #dbe6fb;border-radius:5px;padding:1px 7px;font-size:12.5px; } a:hover { background:#dbe8ff;border-color:#b9cff5; }
    .highlight a { background:#fff8e6;border-color:#f2dca6;color:#6b4a00; } .highlight a:hover { background:#ffefc4; }
    .note { font-size:12px;background:#fff6df;color:#7d5300;padding:3px 7px;border-radius:5px;margin:0 0 4px;white-space:pre-wrap;line-height:1.4; }
    .hint { color:#6b788c;padding:6px; }
    footer { flex-shrink:0;display:flex;align-items:center;gap:4px;padding:5px 8px;border-top:1px solid #e3e9f2;background:#fff; }
    .status { flex:1;min-width:0;font-size:11px;color:#6b788c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0 0 0 4px; }
    .status.warn { color:#7d5300; } .status.msg { white-space:normal;color:#7d5300; }
    [hidden] { display:none!important; }
  `;
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  const panel = el('aside', 'panel');
  panel.setAttribute('aria-label', '游戏链接助手');
  const header = el('header');
  const top = el('div', 'top');
  const title = el('strong');
  const toggle = el('button', 'ghost', '收起');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'true');
  const source = el('div', 'source');
  const main = el('main');
  const footer=el('footer');
  top.append(title, source, toggle);
  header.append(top);
  panel.append(header, main, footer);
  shadow.append(style, panel);
  document.documentElement.append(host);

  toggle.onclick = () => {
    main.hidden = !main.hidden;
    footer.hidden=main.hidden;
    toggle.textContent = main.hidden ? '展开' : '收起';
    toggle.setAttribute('aria-expanded', String(!main.hidden));
    clampPosition();
  };
  let drag = null;
  function clampPosition() {
    if (!host.style.left) return;
    host.style.left = Math.max(8, Math.min(parseFloat(host.style.left), innerWidth - host.offsetWidth - 8)) + 'px';
    host.style.top = Math.max(8, Math.min(parseFloat(host.style.top), innerHeight - host.offsetHeight - 8)) + 'px';
  }
  header.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const rect = host.getBoundingClientRect();
    drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    header.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  header.addEventListener('pointermove', event => {
    if (!drag) return;
    host.style.right = 'auto'; host.style.bottom = 'auto';
    host.style.left = (event.clientX - drag.x) + 'px'; host.style.top = (event.clientY - drag.y) + 'px';
    clampPosition();
  });
  header.addEventListener('pointerup', () => { drag = null; });
  header.addEventListener('lostpointercapture', () => { drag = null; });
  window.addEventListener('resize', clampPosition);

  function linkRow(links) {
    const row = el('div', 'links');
    for (const link of links) {
      let url;
      try { url = new URL(link.url); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      const a = el('a', '', link.name || link.category);
      a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.title = [link.category, link.server, link.note, link.url].filter(Boolean).join('\n');
      row.append(a);
    }
    return row;
  }
  function render(selection) {
    main.replaceChildren();
    main.hidden = false; footer.hidden=false; toggle.textContent = '收起'; toggle.setAttribute('aria-expanded', 'true');
    source.textContent = selection.label; source.title = selection.label;
    const match = core.match(selection.label, data, selection.id);
    title.textContent = match?.game?.name || '游戏链接助手';
    if (!match?.game) {
      main.append(el('div', 'hint', !data.games.length ? '尚无本机链接数据，请在数据管理配置飞书链接库，并登录有访问权限的账号读取。' : match?.ambiguous ? '游戏名称匹配不唯一，请在链接表中补充别名。' : '链接表中尚未找到这个游戏，请更新链接数据。'));
    } else {
      if (!match.version && Object.keys(match.game.versions).length > 1) {
        main.append(el('div', 'hint', '未确定具体版本，以下按版本列出链接。'));
      }
      for (const version of Object.values(match.game.versions)) {
        if (match.version && version.full !== match.version) continue;
        const filtered = core.filterServer(version, selection.label);
        if (!filtered.links.length && !filtered.notes.length) continue;
        const card = el('section'); card.append(el('h2', '', version.version || version.full)); card.dataset.version = version.version || version.full;
        for (const [, note] of filtered.notes) card.append(el('div', 'note', note));
        for (const hint of filtered.loginHints) card.append(el('div', 'note', hint));
        const groups = [];
        // 保持飞书表格里从左到右的顺序（越靠左越常用），不按类别重排
        for (const link of filtered.links) {
          const key = core.isShared(link.server) || core.splitServers(link.server).length > 1 ? '共用' : filtered.server;
          if (!groups.length || groups[groups.length - 1].server !== key) groups.push({ server: key, links: [] });
          groups[groups.length - 1].links.push(link);
        }
        for (const { server, links: groupLinks } of groups) {
          // 专服名作为该行第一个小标签，和链接排在同一行，不单独占一行。
          const group = el('div', 'group' + (server !== '共用' ? ' highlight' : '')), row = linkRow(groupLinks), tag = el('span', 'tag', server);
          tag.title = server; row.prepend(tag); group.append(row); card.append(group);
        }
        main.append(card);
      }
      const cards = main.querySelectorAll('section');
      if (!cards.length) main.append(el('div', 'hint', '暂无适用于当前专服的链接。'));
      // 只有一个版本时，版本名并入标题，省掉卡片标题这一行。
      if (cards.length === 1) { title.textContent += ' · ' + cards[0].dataset.version; cards[0].querySelector('h2').remove(); }
    }
    renderAdd(selection);
    host.style.display = 'block'; clampPosition();
  }

  const runtime=globalThis.chrome?.runtime;
  async function send(message){if(!runtime?.id)throw Error('请先加载扩展并刷新后台页面');const result=await runtime.sendMessage(message);if(!result?.ok)throw Error(result?.error||'扩展连接已失效，请刷新后台页面');return result;}
  function renderAdd(){
    footer.replaceChildren();
    const add=el('button','','＋新增链接'),manage=el('button','','数据管理'),update=el('button',updateStatus?.available?'':'ghost',updateStatus?.available?`有新版 ${updateStatus.version}`:'更新');
    add.type=manage.type=update.type='button';
    // 状态只显示一行短句，完整说明放在悬停提示；点击按钮后的操作提示完整显示。
    const status=el('p','status');status.setAttribute('role','status');footer.append(add,manage,update,status);
    const state=feishuStatus?.state;
    const [short,full]=state==='ready'?['飞书已同步','飞书已同步；新增或修改请直接编辑飞书表格。']:state==='loading'?['正在读取飞书…','正在读取飞书，暂用本机已有数据。']:state==='error'?['飞书读取失败','飞书读取失败；有本机缓存时继续使用，请打开数据管理查看。']:['未读取飞书','请打开数据管理配置并读取飞书；扩展不内置业务链接。'];
    status.textContent=short;status.title=full;if(state!=='ready')status.classList.add('warn');
    const say=text=>{status.textContent=status.title=text;status.className='status msg';};
    add.onclick=()=>send({type:'links:openSource'}).then(()=>say('已打开飞书，请在“链接库”新增一行；保存后可在数据管理立即刷新。')).catch(error=>say(error.message));
    manage.onclick=()=>send({type:'links:manager'}).catch(error=>say(error.message));
    update.onclick=()=>send({type:'updates:open'}).catch(error=>say(error.message));
  }

  let lastKey = '';
  let watchedSelect = null;
  const observer = new MutationObserver(sync);
  function sync() {
    const select = document.querySelector('select#form_gid');
    if (select !== watchedSelect) {
      observer.disconnect(); watchedSelect = select;
      if (select) observer.observe(select, { childList:true, subtree:true, attributes:true, characterData:true });
    }
    const selection = core.supportedPath(location.pathname) ? core.readSelection(select) : null;
    const key = selection ? JSON.stringify(selection) : '';
    if (!selection) { host.style.display = 'none'; main.replaceChildren(); lastKey = ''; return; }
    if (key === lastKey) return;
    lastKey = key; render(selection);
  }
  document.addEventListener('change', sync, true);
  document.addEventListener('input', sync, true);
  document.addEventListener('reset', () => setTimeout(sync, 0), true);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pageshow', sync);
  // Select2 的 jQuery change 和 .val() 不一定发送原生事件；读 selectedOptions 兜底。
  // 仅观察游戏下拉框，绝不遍历订单/玩家表格。
  setInterval(sync, 250);
  sync();
  if(runtime?.id){
    send({type:'updates:get'}).then(result=>{updateStatus=result.status;renderAdd();}).catch(()=>{});
    send({type:'links:get'}).then(result=>{feishuStatus=result.feishuStatus;if(result.linkSnapshot?.data)data=result.linkSnapshot.data;lastKey='';sync();}).catch(()=>{});
    chrome.storage.onChanged.addListener((changes,area)=>{
      if(area!=='local')return;
      if(changes.feishuStatus)feishuStatus=changes.feishuStatus.newValue;
      if(changes.githubUpdateStatus){updateStatus=changes.githubUpdateStatus.newValue;renderAdd();}
      if(changes.linkSnapshot?.newValue?.data){data=changes.linkSnapshot.newValue.data;lastKey='';sync();}
      else if(changes.feishuStatus)renderAdd();
    });
  }
})();
