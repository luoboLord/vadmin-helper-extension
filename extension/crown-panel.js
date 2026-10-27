(() => {
  'use strict';
  const calc = globalThis.WorkToolCrown, api = globalThis.WorkToolCrownFetch;
  if (!calc || !api || !/^\/(?:order\/ls|game\/playerinfo)\/?$/.test(location.pathname)) return;
  const storage = globalThis.chrome?.storage?.local;

  const host = document.createElement('div');
  host.id = 'work-tool-crown';
  host.style.cssText = 'all:initial;position:fixed;left:16px;top:56px;z-index:2147483647;display:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  // 小窗口内尽量提高信息密度：默认 560 像素宽，可拖动标题栏移动、拖右下角改大小、收起成标题栏；
  // 表格不折行，日期省略当年年份，开始查询后设置区折叠成一行摘要。
  style.textContent = `
    :host { color-scheme:light; } * { box-sizing:border-box; }
    .panel { width:min(560px,calc(100vw - 32px));min-width:min(380px,calc(100vw - 16px));max-height:calc(100vh - 16px);
      display:flex;flex-direction:column;resize:both;overflow:hidden;border:1px solid #d3dbe8;border-radius:8px;
      background:#f4f6fa;color:#1f2d42;font:12px/1.5 "Microsoft YaHei","PingFang SC",sans-serif;box-shadow:0 8px 28px #0f1f3a2e; }
    .panel.collapsed { resize:none;height:auto!important;min-height:0; } .panel.collapsed main { display:none; }
    header { display:flex;align-items:center;gap:8px;padding:5px 6px 5px 10px;background:#fff;border-bottom:1px solid #e3e9f2;cursor:move;touch-action:none;user-select:none; }
    .title { font-size:13px;font-weight:bold;white-space:nowrap; } .sub { flex:1;min-width:0;color:#6b788c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    main { padding:6px;overflow:auto;overscroll-behavior:contain;flex:1; }
    section,details.setup { background:#fff;border:1px solid #e6ebf3;border-radius:6px;padding:5px 8px;margin-bottom:6px; }
    h2 { display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;font-size:12px;margin:0 0 3px;color:#1f2d42; } h2 > * { font-weight:normal; }
    button { font:inherit;border:0;border-radius:4px;background:#e8eef9;color:#24539f;padding:1px 8px;cursor:pointer;white-space:nowrap; } button:hover { background:#d9e5fb; }
    button.primary { background:#2859a9;color:#fff;padding:2px 14px; } button.primary:hover { background:#204a8f; } button:disabled { opacity:.5;cursor:default; }
    button.ghost { background:none;color:#5d6b82;padding:1px 6px; } button.ghost:hover { background:#eef2f8;color:#1f2d42; }
    input,select { font:inherit;font-weight:normal;height:22px;padding:0 5px;border:1px solid #c3cfe0;border-radius:4px;background:#fff;color:#1f2d42;min-width:0; }
    input[type=checkbox],input[type=radio] { height:auto;margin:0 3px 0 0;vertical-align:-2px; }
    input:focus,select:focus { outline:2px solid #9bb8ea;outline-offset:-1px; }
    label { white-space:nowrap; } .row { display:flex;align-items:center;gap:4px 8px;margin:3px 0;flex-wrap:wrap; }
    .k { color:#6b788c;white-space:nowrap; } .muted { color:#6b788c; } .sep { color:#c3cfe0; }
    .seg { display:inline-flex;height:22px;border:1px solid #c3cfe0;border-radius:4px;overflow:hidden; }
    .seg label { display:flex;align-items:center;padding:0 8px;cursor:pointer;border-left:1px solid #c3cfe0; } .seg label:first-child { border-left:0; }
    .seg input { position:absolute;opacity:0;pointer-events:none; } .seg label:has(input:checked) { background:#2859a9;color:#fff; }
    .seg label:has(input:focus-visible) { outline:2px solid #9bb8ea;outline-offset:-2px; }
    details.setup > summary { display:flex;align-items:center;gap:6px;cursor:pointer;list-style:none;font-weight:bold;white-space:nowrap; }
    details.setup > summary::-webkit-details-marker { display:none; } details.setup > summary::before { content:'▸';color:#6b788c;font-weight:normal; }
    details.setup[open] > summary::before { content:'▾'; } details.setup[open] > summary .brief { display:none; }
    .brief { min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:normal;color:#4b5970; }
    .search { flex:1;min-width:120px; }
    .shared-row { display:flex;align-items:center;gap:6px;padding:1px 0 1px 12px; }
    .shared-row .name { flex:1;min-width:40px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; } .shared-row input[type=text] { width:80px; }
    .hint { white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis; } .hint.good { color:#1d6b38; } .hint.badtext { color:#a12b1f; }
    .matches { max-height:140px;overflow:auto;border:1px solid #e3e9f2;border-radius:4px;margin:2px 0; }
    .matches div { padding:1px 6px;display:flex;gap:6px;align-items:center;white-space:nowrap;overflow:hidden; } .matches div:hover { background:#f4f6fa; }
    .warn,.bad,.ok { padding:3px 7px;border-radius:4px;margin:3px 0;white-space:pre-wrap; }
    .warn { background:#fff6df;color:#7d5300; } .bad { background:#ffebe8;color:#a12b1f; } .ok { background:#e6f5eb;color:#1d6b38; }
    .pill { padding:0 6px;border-radius:8px;background:#e6f5eb;color:#1d6b38; } .pill.no { background:#ffebe8;color:#a12b1f; }
    .progress { display:flex;align-items:center;gap:8px; } .progress .line { flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .line1 { white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .winner { border-left:3px solid #e8ad32;padding:0 0 0 8px;margin:3px 0; } .winner + .winner { margin-top:6px; }
    .big { font-size:14px;font-weight:bold; } .big .id { font-size:12px;font-weight:normal;color:#4b5970;margin-left:6px; }
    .meta { display:flex;flex-wrap:wrap;gap:0 12px; } .meta > span { white-space:nowrap; }
    .reach-time { font-weight:bold;color:#1f2d42; }
    .tw { overflow:auto;max-height:300px;border:1px solid #e9eef5;border-radius:4px;margin-top:3px; }
    table { border-collapse:collapse;width:100%; } th,td { padding:1px 6px;text-align:left;white-space:nowrap;border-bottom:1px solid #eef2f7; }
    th { position:sticky;top:0;background:#f4f6fa;color:#5d6b82;font-weight:normal;z-index:1; } tr:last-child td { border-bottom:0; } tbody tr:hover td { background:#f7f9fc; }
    td.num,th.num { text-align:right;font-variant-numeric:tabular-nums; } td.wrap { white-space:normal;min-width:9em; } .cut { display:inline-block;max-width:7em;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom; }
    details.more > summary { cursor:pointer;color:#24539f; }
    [hidden] { display:none!important; }
  `;
  const el = (tag, className, textValue) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue != null) node.textContent = textValue;
    return node;
  };
  const button = (label, onclick, className = '') => { const b = el('button', className, label); b.type = 'button'; b.onclick = onclick; return b; };
  const panel = el('aside', 'panel'), header = el('header'), title = el('span', 'title', '查冠名权'), sub = el('span', 'sub'), main = el('main');
  panel.setAttribute('aria-label', '查冠名权');
  // 收起只留标题栏，方便查看下面的后台信息；关闭只隐藏面板，查询进行中再次打开可继续查看进度。
  const fold = button('收起', () => { const on = panel.classList.toggle('collapsed'); fold.textContent = on ? '展开' : '收起'; clampPosition(); }, 'ghost');
  header.append(title, sub, fold, button('关闭', () => { host.style.display = 'none'; }, 'ghost'));
  panel.append(header, main); shadow.append(style, panel); document.documentElement.append(host);

  // 位置和大小记在本页（后台域名）的 localStorage，下次打开沿用；读写失败时用默认值。
  const LAYOUT_KEY = 'workToolCrownLayout';
  function clampPosition() {
    if (host.style.display === 'none') return;
    const left = Math.max(8, Math.min(parseFloat(host.style.left) || 16, innerWidth - Math.min(host.offsetWidth, innerWidth - 16) - 8));
    const top = Math.max(8, Math.min(parseFloat(host.style.top) || 56, innerHeight - 120));
    host.style.left = left + 'px'; host.style.top = top + 'px';
    panel.style.maxHeight = (innerHeight - top - 8) + 'px';
    panel.style.maxWidth = (innerWidth - left - 8) + 'px';
  }
  function saveLayout() {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ left: host.style.left, top: host.style.top, width: panel.style.width, height: panel.style.height })); } catch {}
  }
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    if (saved) { host.style.left = saved.left; host.style.top = saved.top; if (saved.width) panel.style.width = saved.width; if (saved.height) panel.style.height = saved.height; }
  } catch {}
  let drag = null;
  header.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const rect = host.getBoundingClientRect();
    drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    header.setPointerCapture(event.pointerId); event.preventDefault();
  });
  header.addEventListener('pointermove', event => {
    if (!drag) return;
    host.style.left = (event.clientX - drag.x) + 'px'; host.style.top = (event.clientY - drag.y) + 'px'; clampPosition();
  });
  const endDrag = () => { if (drag) { drag = null; saveLayout(); } };
  header.addEventListener('pointerup', endDrag); header.addEventListener('lostpointercapture', endDrag);
  window.addEventListener('resize', clampPosition);
  // 拖右下角改大小后浏览器写入 width/height 内联样式，停下后保存。
  let resizeTimer;
  new ResizeObserver(() => { if (!panel.style.width && !panel.style.height) return; clearTimeout(resizeTimer); resizeTimer = setTimeout(saveLayout, 300); }).observe(panel);

  const gameName = gid => {
    const option = [...(document.querySelector('select#form_gid')?.options || [])].find(o => o.value === String(gid));
    return option ? option.textContent.trim() : String(gid);
  };
  const yuan = cents => calc.yuan(cents) + ' 元';
  // 表格默认不折行，放在可横向滚动的框里；num 列右对齐，wrap 列允许折行（说明类长文字）。
  function table(headers, rows, { num = [], wrap = [], tips = {} } = {}) {
    const box = el('div', 'tw'), t = el('table'), head = el('tr'), body = el('tbody');
    headers.forEach((h, i) => { const th = el('th', num.includes(i) ? 'num' : '', h); if (tips[h]) th.title = tips[h]; head.append(th); });
    const thead = el('thead'); thead.append(head); t.append(thead, body);
    for (const row of rows) {
      const tr = el('tr');
      row.forEach((cell, i) => {
        const td = el('td', num.includes(i) ? 'num' : wrap.includes(i) ? 'wrap' : '');
        if (cell instanceof Node) td.append(cell); else td.textContent = String(cell);
        tr.append(td);
      });
      body.append(tr);
    }
    box.append(t);
    return box;
  }
  const kv = (key, value) => { const span = el('span'); span.append(el('span', 'k', key + ' '), value instanceof Node ? value : String(value)); return span; };
  // 日期时间在当年时省略年份，表格列更窄；跨年的仍显示完整日期。
  const thisYear = String(new Date().getFullYear());
  const short = value => { const text = String(value ?? ''); return text.startsWith(thisYear + '-') ? text.slice(5) : text; };
  const cut = text => { const span = el('span', 'cut', text); span.title = text; return span; };

  // 从当前已查询的结果读取游戏和区服：游戏取筛选框；区服取结果表的区服列及筛选框。
  // 订单页“游戏区服ID”列是区服名称，玩家信息页“区服ID”列是“区服ID-名称”。只在点击按钮时读一次表格。
  const SERVER_COLUMNS = ['游戏区服ID', '区服ID'];
  async function readTargets() {
    // 玩家信息页的游戏框可多选，必须恰好选中一个游戏。
    const chosen = [...(document.querySelector('select#form_gid')?.selectedOptions || [])].filter(o => o.value && o.value !== '0');
    if (chosen.length > 1) return { error: '请只选择一个游戏后再查冠名权。' };
    const gid = chosen[0]?.value;
    if (!gid) return { error: '请先选择游戏并查询玩家。' };
    const tableNode = document.querySelector('#list_table');
    // DataTables 可能在表头放多行（含空白的尺寸行），取包含列名的那一行定位列号。
    const isServer = th => SERVER_COLUMNS.includes(th.textContent.trim());
    const headRow = [...(tableNode?.querySelectorAll('thead tr') || [])].find(tr => [...tr.children].some(isServer));
    const column = headRow ? [...headRow.children].findIndex(isServer) : -1;
    const cells = new Set();
    for (const tr of column < 0 ? [] : tableNode.querySelectorAll('tbody tr')) {
      const cell = tr.children[column];
      if (cell && cell.textContent.trim() && !tr.querySelector('.dataTables_empty')) cells.add(cell.textContent.trim());
    }
    const list = await api.servers(gid);
    const picked = document.querySelector('select#form_psid')?.value;
    const targets = [], unknown = [];
    for (const value of cells) {
      const byId = /^(\d+)-/.exec(value), idHit = byId && list.find(s => s.psid === byId[1]);
      const hits = idHit ? [idHit] : list.filter(s => s.name === value);
      if (hits.length !== 1) unknown.push(value);
      else if (!targets.includes(hits[0])) targets.push(hits[0]);
    }
    if (picked && picked !== '-1' && picked !== '0' && !targets.some(t => t.psid === picked)) {
      const hit = list.find(s => s.psid === picked);
      if (hit) targets.push(hit);
    }
    if (!targets.length) return { error: unknown.length ? `结果中的区服“${unknown.join('、')}”无法唯一对应区服ID，请在筛选框选择区服后重新查询。` : '尚无可识别的充值结果，请先查询玩家。' };
    return { gid, targets, unknown, servers: list };
  }

  const configKey = gid => 'crown:shared:' + gid;
  async function loadConfig(gid) {
    if (!storage) return { games: [] };
    return (await storage.get(configKey(gid)))[configKey(gid)] || null;
  }
  // 双向保存：同时更新本组每个共服游戏自己的设置（含从本组移除的游戏）。
  async function saveConfig(gid, config) {
    if (!storage) return;
    const old = await loadConfig(gid);
    const ids = [...new Set([gid, ...(old?.games || []).map(g => g.gid), ...config.games.map(g => g.gid)].map(String))];
    const stored = await storage.get(ids.map(configKey)), configs = {};
    for (const id of ids) if (stored[configKey(id)]) configs[id] = stored[configKey(id)];
    const linked = calc.linkShared(configs, gid, config), savedAt = Date.now(), items = {};
    for (const [id, value] of Object.entries(linked)) items[configKey(id)] = { ...value, savedAt };
    await storage.set(items);
  }

  let task = null;
  const serverCache = new Map();
  const serversOf = gid => { if (!serverCache.has(gid)) serverCache.set(gid, api.servers(gid).catch(error => { serverCache.delete(gid); throw error; })); return serverCache.get(gid); };

  async function open() {
    host.style.display = 'block'; clampPosition();
    if (task) return;
    main.replaceChildren(el('div', 'muted', '正在读取当前查询结果…'));
    let info;
    try { info = await readTargets(); } catch (error) { info = { error: error.message }; }
    main.replaceChildren();
    if (info.error) { sub.textContent = ''; main.append(el('div', 'warn', info.error)); return; }
    sub.textContent = sub.title = gameName(info.gid);
    serverCache.set(info.gid, Promise.resolve(info.servers));
    const saved = await loadConfig(info.gid);
    const config = { games: (saved?.games || []).map(g => ({ ...g, map: { ...(g.map || {}) } })) };

    // 设置区：第一行区服和门槛，第二行完整扫描和共服搜索；开始查询后折叠成一行摘要。
    const setup = el('details', 'setup'), setupHead = el('summary'), brief = el('span', 'brief');
    setup.open = true; setupHead.append('查询设置', brief); setup.append(setupHead);
    const targetSelect = el('select');
    targetSelect.setAttribute('aria-label', '目标区服');
    for (const t of info.targets) targetSelect.append(new Option(`${t.name}（${t.psid}）`, t.psid));

    const seg = el('div', 'seg'), custom = el('input');
    custom.type = 'text'; custom.inputMode = 'decimal'; custom.placeholder = '自定义'; custom.size = 6; custom.setAttribute('aria-label', '自定义门槛金额');
    seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', '真实扣款门槛');
    let thresholdValue = '500';
    for (const value of ['500', '2000', '5000']) {
      const label = el('label'), radio = el('input');
      radio.type = 'radio'; radio.name = 'crown-threshold'; radio.value = value; radio.checked = value === '500';
      radio.onchange = () => { thresholdValue = value; custom.value = ''; };
      label.append(radio, document.createTextNode(value)); seg.append(label);
    }
    custom.oninput = () => { for (const r of seg.querySelectorAll('input[type=radio]')) r.checked = false; thresholdValue = custom.value.trim(); };
    const firstRow = el('div', 'row');
    firstRow.append(el('span', 'k', '区服'), targetSelect, el('span', 'k', '真实扣款门槛'), seg, custom, el('span', 'muted', '元'));

    const full = el('input'), fullLabel = el('label');
    full.type = 'checkbox'; fullLabel.append(full, document.createTextNode('完整扫描'));
    fullLabel.title = '不按累充金额排除角色，列出全部达标排名，较慢';

    // 共服：选择需要一起统计的游戏ID，并为目标区服填写对应区服ID（编号一致时可勾选共用编号）。
    const sharedList = el('div'), searchBox = el('input', 'search'), matches = el('div', 'matches');
    searchBox.placeholder = saved ? '共服：搜索游戏ID或名称添加' : '共服：搜索添加（没有共服可不填）';
    searchBox.title = saved ? '已带出上次保存的共服设置，可修改。' : '首次查询该游戏：如有共服游戏请添加；没有则直接开始查询，设置会被保存。';
    searchBox.setAttribute('aria-label', '搜索共服游戏');
    matches.hidden = true;
    const secondRow = el('div', 'row');
    secondRow.append(fullLabel, el('span', 'sep', '|'), searchBox);
    setup.append(firstRow, secondRow, matches, sharedList);
    if (info.unknown.length) setup.append(el('div', 'warn', `未能识别的区服：${info.unknown.join('、')}`));
    function renderShared() {
      sharedList.replaceChildren();
      for (const game of config.games) {
        const row = el('div', 'shared-row'), input = el('input'), same = el('input'), sameLabel = el('label'), hint = el('span', 'hint');
        input.type = 'text'; input.placeholder = '对应区服ID'; input.setAttribute('aria-label', `${game.gid} 对应区服ID`);
        same.type = 'checkbox'; same.checked = !!game.sameIds; sameLabel.append(same, document.createTextNode('编号一致'));
        const psid = targetSelect.value;
        input.value = game.sameIds ? psid : (game.map[psid] || '');
        input.disabled = same.checked;
        const check = async () => {
          const value = same.checked ? targetSelect.value : input.value.trim();
          if (!same.checked) { if (value) game.map[targetSelect.value] = value; else delete game.map[targetSelect.value]; }
          const show = (text, ok) => { hint.textContent = hint.title = text; hint.className = 'hint ' + (ok ? 'good' : 'badtext'); };
          if (!value) { show('请填写对应区服ID', false); return; }
          try { const hit = (await serversOf(game.gid)).find(s => s.psid === value); show(hit ? '✓ ' + hit.name : '该游戏没有这个区服ID', !!hit); }
          catch (error) { show(error.message, false); }
        };
        input.onchange = check; same.onchange = () => { game.sameIds = same.checked; renderShared(); };
        const name = el('span', 'name', '共服 · ' + gameName(game.gid)); name.title = gameName(game.gid);
        row.append(name, input, sameLabel, hint, button('移除', () => { config.games = config.games.filter(g => g !== game); renderShared(); }, 'ghost'));
        sharedList.append(row); check();
      }
    }
    searchBox.oninput = () => {
      const query = searchBox.value.trim();
      matches.replaceChildren(); matches.hidden = !query;
      if (!query) return;
      const hits = [...document.querySelector('select#form_gid').options]
        .filter(o => +o.value > 0 && o.value !== info.gid && !config.games.some(g => g.gid === o.value) && o.textContent.includes(query)).slice(0, 30);
      if (!hits.length) matches.append(el('div', 'muted', '没有匹配的游戏'));
      for (const o of hits) {
        const row = el('div'), name = el('span', '', o.textContent.trim()); name.title = name.textContent;
        row.append(button('添加', () => { config.games.push({ gid: o.value, sameIds: false, map: {} }); searchBox.value = ''; matches.hidden = true; renderShared(); }), name);
        matches.append(row);
      }
    };
    targetSelect.onchange = renderShared;
    renderShared();

    const actions = el('div', 'row'), start = button('开始查询', null, 'primary'), status = el('div');
    actions.append(start, el('span', 'muted', '查询期间请勿刷新页面，不改变当前查询条件'));
    setup.append(actions);
    const progress = el('section', 'progress'); progress.hidden = true;
    const results = el('div');
    main.append(setup, status, progress, results);

    start.onclick = async () => {
      // 核对共服区服和保存设置需要等待，点击后立即禁用，避免连点同时启动两轮扫描。
      if (start.disabled || task) return;
      start.disabled = true;
      let launched = false;
      try {
        status.replaceChildren(); results.replaceChildren();
        const thresholdCents = calc.toCents(thresholdValue);
        if (!thresholdCents || thresholdCents <= 0) { status.append(el('div', 'bad', '请填写大于 0 的充值门槛，最多两位小数。')); return; }
        const base = info.targets.find(t => t.psid === targetSelect.value);
        const scope = [{ gid: info.gid, psid: base.psid, name: base.name }];
        for (const game of config.games) {
          const psid = game.sameIds ? base.psid : game.map[base.psid];
          const hit = psid && (await serversOf(game.gid).catch(() => [])).find(s => s.psid === psid);
          if (!hit) { status.append(el('div', 'bad', `请为共服游戏 ${gameName(game.gid)} 填写有效的对应区服ID。`)); return; }
          scope.push({ gid: game.gid, psid, name: hit.name });
        }
        await saveConfig(info.gid, config);
        launched = true;
        brief.textContent = brief.title = `${base.name}（${base.psid}） · 门槛 ${yuan(thresholdCents)}` + (config.games.length ? ` · 共服 ${config.games.length} 款` : '') + (full.checked ? ' · 完整扫描' : '');
        setup.open = false;
        run({ scope, thresholdCents, fullScan: full.checked, start, progress, results, setup, done: renderShared });
      } catch (error) {
        status.append(el('div', 'bad', '无法开始查询：' + error.message));
      } finally {
        if (!launched) start.disabled = false;
      }
    };
  }

  async function run({ scope, thresholdCents, fullScan, start, progress, results, setup, done }) {
    const controller = new AbortController();
    task = controller;
    const lock = pending => { for (const node of setup.querySelectorAll('input,select,button')) node.disabled = pending; start.disabled = pending; };
    lock(true);
    const line = el('span', 'line', '准备中…'), cancel = button('取消', () => controller.abort(Error('已取消')));
    progress.replaceChildren(el('strong', '', '查询中'), line, cancel); progress.hidden = false;
    const startedAt = new Date();
    const players = [], issues = [];
    let result = null, fatal = null;
    try {
      for (const [index, target] of scope.entries()) {
        const read = await api.players(target, { signal: controller.signal,
          onPage: p => { line.textContent = `读取玩家：${gameName(target.gid)} · ${target.name}（${index + 1}/${scope.length}）${p.read}/${p.total}`; } });
        players.push(...read.players);
        if (!read.complete) issues.push({ role: target, reason: `${gameName(target.gid)} · ${target.name}：${read.reason}` });
      }
      const today = api.beijingToday();
      result = await calc.search({ candidates: players, thresholdCents, excludeByTotal: true, fullScan, today, signal: controller.signal,
        fetchOrders: (role, from, to) => api.orders(role, from, to, { signal: controller.signal }),
        onProgress: p => { line.textContent = `核查订单：${p.index + 1}/${p.total} · ${p.role.roleName || p.role.roleId}` + (p.best ? ` · 当前最早达标 ${p.best}` : ''); } });
    } catch (error) {
      fatal = controller.signal.aborted ? '已取消，查询结果不完整。' : error.message;
    } finally {
      task = null; lock(false); done(); progress.hidden = true;
    }
    render({ result, fatal, issues, players, scope, thresholdCents, startedAt, results });
  }

  function render({ result, fatal, issues, players, scope, thresholdCents, startedAt, results }) {
    results.replaceChildren();
    const allIssues = [...issues, ...(result?.issues || [])];
    const complete = !fatal && result && allIssues.length === 0;
    // 只查一个区服时省掉“区服ID”列；共服时才列出。
    const multi = scope.length > 1;
    const summary = el('section'), heading = el('h2', '', `结果 · 门槛 ${yuan(thresholdCents)}`);
    const readAt = startedAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    heading.append(el('span', complete ? 'pill' : 'pill no', complete ? '查询完整' : '查询不完整'),
      el('span', 'muted', result ? `核查 ${result.checked} 名 · 累充不足排除 ${result.skippedByTotal} 名` : ''));
    // 覆盖范围和读取时间压成一行，完整内容在悬停提示。
    const coverage = el('div', 'muted line1', `${readAt} · ` + scope.map(s => `${gameName(s.gid)} · ${s.name}（${s.psid}）`).join('；'));
    coverage.title = `读取时间 ${readAt}\n覆盖范围：\n` + scope.map(s => `${gameName(s.gid)} · ${s.name}（${s.psid}）`).join('\n');
    summary.append(heading, coverage);
    if (!complete) summary.append(el('div', 'bad', '查询不完整，不能作为冠名权结论。' + (fatal ? '\n' + fatal : '') +
      allIssues.slice(0, 20).map(i => `\n· ${i.role?.roleName || i.role?.roleId || ''} ${i.reason}`).join('') + (allIssues.length > 20 ? `\n…共 ${allIssues.length} 条` : '')));
    const queryDetails = [];
    for (const w of result?.warnings || []) {
      if (w.kind === 'query-detail') queryDetails.push(w);
      else summary.append(el('div', 'warn', w.reason));
    }
    if (queryDetails.length) {
      const details = el('details', 'more');
      details.append(el('summary', '', `查询说明（${queryDetails.length} 条）`));
      for (const w of queryDetails) details.append(el('div', 'warn', w.reason));
      summary.append(details);
    }
    results.append(summary);
    if (result) {
      const best = el('section');
      best.append(el('h2', '', complete ? '最早达标角色' : '最早达标角色（暂定，仅供核对）'));
      if (!result.winners.length) best.append(el('div', 'muted', `所查范围内没有角色单日充值达到 ${yuan(thresholdCents)}。`));
      if (result.winners.length > 1) best.append(el('div', 'warn', `${result.winners.length} 名角色在同一时刻达标，列为并列。`));
      for (const w of result.winners) {
        const box = el('div', 'winner'), server = scope.find(s => s.gid === w.gameId && s.psid === w.serverId);
        // 达标订单默认折叠，需要核对时再展开。
        const orders = el('details', 'more'), orderCents = w.orders.reduce((total, o) => total + o.amountCents, 0);
        orders.append(el('summary', '', `订单明细 ${w.orders.length} 笔 · 合计 ${yuan(orderCents)}`),
          table(['订单号', '创建时间', '真实扣款'], w.orders.map(o => [o.orderId, o.createdAt, calc.yuan(o.amountCents)]), { num: [2] }));
        const nameLine = el('div', 'big'), roleName = el('span', '', w.roleName || '(无角色名)');
        nameLine.append(roleName, el('span', 'id', w.roleId), el('span', 'id', `${server?.name || ''}（${w.serverId}）`));
        if (w.gameId !== scope[0].gid) nameLine.append(el('span', 'id', gameName(w.gameId)));
        const meta = el('div', 'meta');
        // 活动常限定达标后几天内申请，达标时间加粗、保留完整日期，便于核对是否过期。
        meta.append(kv('首次达标', el('span', 'reach-time', `${w.date} ${w.time.slice(11)}`)), kv('达标时累计', yuan(w.reachedCents)), kv('当天总额', yuan(w.dayTotalCents)));
        box.append(nameLine, meta, orders);
        if (globalThis.WorkToolRoleCopy && w.roleName && server?.name) {
          globalThis.WorkToolRoleCopy.bindName(roleName,() => ({roleId: w.roleId, roleName: w.roleName, serverName: server.name}));
        }
        best.append(box);
      }
      results.append(best);
      const others = result.ranking.filter(r => r.place > 1);
      if (others.length || result.stoppedEarly) {
        const rank = el('section'), rankHead = el('h2', '', `其他达标角色 ${others.length} 名`);
        if (result.stoppedEarly) { const note = el('span', 'muted', '已提前结束，需完整排名请勾选“完整扫描”'); note.title = '只列出最早达标当天及之前核查到的角色。'; rankHead.append(note); }
        rank.append(rankHead);
        if (others.length) rank.append(table(['名次', '角色', '角色ID', ...(multi ? ['区服ID'] : []), '达标时间', '达标时累计'],
          others.map(r => [r.place + (r.tied ? ' 并列' : ''), cut(r.roleName), r.roleId, ...(multi ? [r.serverId] : []), el('span', 'reach-time', short(r.time)), calc.yuan(r.reachedCents)]),
          { num: [multi ? 5 : 4] }));
        results.append(rank);
      }
      const audit = el('section'), auditDetails = el('details', 'more');
      // 累充不足门槛、未查订单的角色不列出（只计数）；其余按累充金额从高到低排，同额再按最高单日真实扣款。
      const checks = result.checks.filter(c => c.from).sort((a, b) => (b.role.totalCents ?? -1) - (a.role.totalCents ?? -1) || (b.peakCents || 0) - (a.peakCents || 0));
      const auditTitle = el('summary', '', `逐角色订单核对 ${checks.length} 名（按累充从高到低）`);
      if (result.skippedByTotal) auditTitle.title = `另 ${result.skippedByTotal} 名累充不足门槛未查询，不列出`;
      auditDetails.append(auditTitle,
        table(['角色', '角色ID', '累充', '查询日期', '订单', '单日最高', '说明'], checks.map(c => [
          cut(c.role.roleName || ''), c.role.roleId,
          c.role.totalCents == null ? '-' : calc.yuan(c.role.totalCents),
          `${short(c.from)} ~ ${short(c.to)}`,
          `${c.returned} / ${c.paid}`,
          c.peakDate ? `${short(c.peakDate)} ${calc.yuan(c.peakCents)}` : '-',
          c.reason.replace(/^已达标：(\S+ \S+)/, (_, time) => '达标 ' + short(time))
        ]), { num: [2, 4], wrap: [6], tips: { 查询日期: '订单查询日期范围', 订单: '返回订单数 / 计入的已支付订单数', 单日最高: '最高单日真实扣款' } }));
      audit.append(auditDetails); results.append(audit);
    }
    const list = el('section'), details = el('details', 'more');
    const sorted = players.slice().sort((a, b) => (b.totalCents || 0) - (a.totalCents || 0));
    details.append(el('summary', '', `所查区服玩家 ${players.length} 名（按累充排序）`),
      table(['角色', '角色ID', ...(multi ? ['区服ID'] : []), '创建时间', '累充金额'],
        sorted.slice(0, 500).map(p => [cut(p.roleName), p.roleId, ...(multi ? [p.serverId] : []), short(p.createdAt), p.totalCents == null ? '-' : calc.yuan(p.totalCents)]),
        { num: [multi ? 4 : 3] }));
    if (sorted.length > 500) details.append(el('div', 'muted', '只显示前 500 名。'));
    list.append(details); results.append(list);
  }

  // 在原“查询”按钮后插入入口；表单被页面重建时重新插入。
  function ensureButton() {
    const search = document.querySelector('#form_search');
    if (!search || document.querySelector('#work-tool-crown-btn')) return;
    const entry = document.createElement('button');
    entry.id = 'work-tool-crown-btn'; entry.type = 'button'; entry.className = search.className;
    const icon = document.createElement('i');
    icon.className = 'fa fa-trophy';
    entry.append(' ', icon, ' 查冠名权 ');
    // 页面按 id 给“查询”单独设了边距和偏移（玩家信息页 margin-top:10px），照抄其计算样式才能与相邻按钮对齐。
    const computed = getComputedStyle(search);
    for (const key of ['marginTop', 'marginBottom', 'verticalAlign', 'position', 'top']) entry.style[key] = computed[key];
    entry.style.marginLeft = '6px';
    entry.addEventListener('click', event => { event.preventDefault(); open(); });
    search.after(entry);
  }
  ensureButton();
  setInterval(ensureButton, 1000);
})();
