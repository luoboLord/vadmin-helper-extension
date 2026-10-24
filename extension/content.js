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
  style.textContent = `
    :host { color-scheme:light; } * { box-sizing:border-box; }
    .panel { width:min(360px,calc(100vw - 24px)); border:1px solid #dce3ef;border-radius:12px;
      background:#f4f7fc;color:#233047;font:13px/1.5 "Microsoft YaHei",sans-serif;box-shadow:0 8px 32px #172b4d30;overflow:hidden; }
    header { padding:10px 12px;background:white;cursor:move;touch-action:none;border-bottom:1px solid #e4eaf3; }
    .top { display:flex;align-items:center;gap:8px; } strong { flex:1;font-size:15px;overflow-wrap:anywhere; }
    button { font:inherit;border:0;border-radius:6px;background:#e9effa;color:#2859a9;padding:3px 8px;cursor:pointer; }
    button:hover,a:hover { background:#dbe8ff; } .source { font-size:11px;color:#66758b;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    main { padding:8px;max-height:min(480px,calc(100vh - 140px));overflow:auto;overscroll-behavior:contain; }
    section { background:white;border-radius:8px;padding:9px;margin-bottom:7px; } section:last-child { margin-bottom:0; }
    h2 { font-size:13px;margin:0 0 7px; } .group { margin-top:7px; } .label { font-size:11px;color:#66758b;margin-bottom:3px; }
    .links { display:flex;flex-wrap:wrap;gap:5px; } a { display:inline-block;text-decoration:none;color:#2454ad;background:#edf3ff;border-radius:5px;padding:3px 7px;overflow-wrap:anywhere; }
    .note { font-size:12px;background:#fff5dd;color:#885900;padding:5px 7px;border-radius:5px;margin:5px 0;white-space:pre-wrap; }
    .hint { color:#66758b;padding:8px; } .highlight { border-left:3px solid #e8ad32;padding-left:6px; }
    footer { padding:10px;border-top:1px solid #dce3ef;background:white; } .actions { display:flex;gap:8px;flex-wrap:wrap; }
    form label { display:block;margin:9px 0; } input:not([type=checkbox]),select { display:block;width:100%;padding:7px;border:1px solid #bac8dc;border-radius:5px;font:inherit;background:white;color:#233047; }
    details { margin:10px 0; } summary { cursor:pointer;color:#2859a9; } .status { white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;margin:8px 0;color:#885900; }
    [hidden] { display:none!important; }
    .panel { display:flex;flex-direction:column;max-height:calc(100vh - 32px); } header { flex-shrink:0; }
    main { min-height:60px;flex:1; } footer { max-height:60vh;overflow:auto;flex-shrink:0; }
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
  const toggle = el('button', '', '收起');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'true');
  const source = el('div', 'source');
  const main = el('main');
  const footer=el('footer');
  top.append(title, toggle);
  header.append(top, source);
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
        const card = el('section'); card.append(el('h2', '', version.version || version.full));
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
          const group = el('div', 'group' + (server !== '共用' ? ' highlight' : ''));
          group.append(el('div', 'label', server), linkRow(groupLinks)); card.append(group);
        }
        main.append(card);
      }
      if (!main.querySelector('section')) main.append(el('div', 'hint', '暂无适用于当前专服的链接。'));
    }
    renderAdd(selection);
    host.style.display = 'block'; clampPosition();
  }

  const runtime=globalThis.chrome?.runtime;
  async function send(message){if(!runtime?.id)throw Error('请先加载扩展并刷新后台页面');const result=await runtime.sendMessage(message);if(!result?.ok)throw Error(result?.error||'扩展连接已失效，请刷新后台页面');return result;}
  function renderAdd(){
    footer.replaceChildren();
    const actions=el('div','actions'),add=el('button','','＋新增链接'),manage=el('button','','数据管理'),update=el('button','',updateStatus?.available?`有新版 ${updateStatus.version}`:'更新');
    add.type=manage.type=update.type='button';actions.append(add,manage,update);footer.append(actions);
    const status=el('p','status');status.setAttribute('role','status');footer.append(status);
    const state=feishuStatus?.state;
    status.textContent=state==='ready'?'飞书已同步；新增或修改请直接编辑飞书表格。':state==='loading'?'正在读取飞书，暂用本机已有数据。':state==='error'?'飞书读取失败；有本机缓存时继续使用，请打开数据管理查看。':'请打开数据管理配置并读取飞书；扩展不内置业务链接。';
    add.onclick=()=>send({type:'links:openSource'}).then(()=>{status.textContent='已打开飞书，请在“链接库”新增一行；保存后可在数据管理立即刷新。';}).catch(error=>{status.textContent=error.message;});
    manage.onclick=()=>send({type:'links:manager'}).catch(error=>{status.textContent=error.message;});
    update.onclick=()=>send({type:'updates:open'}).catch(error=>{status.textContent=error.message;});
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
