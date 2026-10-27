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
  // 面板可拖动标题栏移动、拖右下角改大小；宽度足够时设置区并排、表格不折行，尽量少占纵向空间。
  style.textContent = `
    :host { color-scheme:light; } * { box-sizing:border-box; }
    .panel { width:min(980px,calc(100vw - 32px));min-width:min(520px,calc(100vw - 16px));min-height:200px;max-height:calc(100vh - 16px);
      display:flex;flex-direction:column;resize:both;overflow:hidden;border:1px solid #d5ddea;border-radius:10px;
      background:#f3f6fb;color:#1f2d42;font:13px/1.45 "Microsoft YaHei","PingFang SC",sans-serif;box-shadow:0 12px 40px #0f1f3a33; }
    header { display:flex;align-items:center;gap:10px;padding:7px 10px 7px 14px;background:#fff;border-bottom:1px solid #e3e9f2;cursor:move;touch-action:none;user-select:none; }
    .title { font-size:14px;font-weight:bold;white-space:nowrap; } .sub { flex:1;min-width:0;color:#5d6b82;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    main { padding:8px;overflow:auto;overscroll-behavior:contain;flex:1;container-type:inline-size; }
    section { background:#fff;border:1px solid #e6ebf3;border-radius:8px;padding:8px 10px;margin-bottom:8px; }
    h2 { display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;margin:0 0 6px;color:#1f2d42; } h2 > :not(:first-child),h2 input { font-weight:normal; }
    button { font:inherit;border:0;border-radius:6px;background:#e8eef9;color:#24539f;padding:3px 10px;cursor:pointer;white-space:nowrap; } button:hover { background:#d9e5fb; }
    button.primary { background:#2859a9;color:#fff;padding:4px 16px; } button.primary:hover { background:#204a8f; } button:disabled { opacity:.5;cursor:default; }
    button.ghost { background:none;color:#5d6b82; } button.ghost:hover { background:#eef2f8;color:#1f2d42; }
    input,select { font:inherit;padding:3px 6px;border:1px solid #c3cfe0;border-radius:5px;background:#fff;color:#1f2d42;min-width:0; }
    input:focus,select:focus { outline:2px solid #9bb8ea;outline-offset:0;border-color:#5c88d6; }
    label { white-space:nowrap; } .row { display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:4px 0; }
    .k { color:#5d6b82;white-space:nowrap; } .muted { color:#6b788c;font-size:12px; }
    .seg { display:inline-flex;border:1px solid #c3cfe0;border-radius:6px;overflow:hidden; }
    .seg label { padding:2px 9px;cursor:pointer;border-left:1px solid #c3cfe0; } .seg label:first-child { border-left:0; }
    .seg input { position:absolute;opacity:0;pointer-events:none; } .seg label:has(input:checked) { background:#2859a9;color:#fff; }
    .seg label:has(input:focus-visible) { outline:2px solid #9bb8ea;outline-offset:-2px; }
    .setup-grid { display:grid;gap:8px;margin-bottom:8px; } .setup-grid section { margin:0; }
    @container (min-width: 760px) { .setup-grid { grid-template-columns:minmax(0,1fr) minmax(0,1fr); } }
    .shared-row { display:flex;align-items:center;gap:6px;padding:3px 0;border-top:1px dashed #e6ebf3; } .shared-row:first-child { border-top:0; }
    .shared-row .name { flex:1;min-width:60px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; } .shared-row input[type=text] { width:96px; }
    .hint { white-space:nowrap;font-size:12px;color:#6b788c; } .hint.good { color:#1d6b38; } .hint.badtext { color:#a12b1f; }
    .search { flex:1;min-width:140px; } .matches { max-height:150px;overflow:auto;border:1px solid #e3e9f2;border-radius:5px;margin-top:4px; }
    .matches div { padding:2px 6px;display:flex;gap:6px;align-items:center;white-space:nowrap; } .matches div:hover { background:#f3f6fb; }
    .actions { display:flex;align-items:center;gap:10px;margin:0 0 8px; }
    .warn,.bad,.ok { padding:5px 8px;border-radius:5px;margin:4px 0;white-space:pre-wrap; }
    .warn { background:#fff6df;color:#7d5300; } .bad { background:#ffebe8;color:#a12b1f; } .ok { background:#e6f5eb;color:#1d6b38; }
    .pill { font-size:12px;font-weight:normal;padding:0 8px;border-radius:10px;background:#e6f5eb;color:#1d6b38; } .pill.no { background:#ffebe8;color:#a12b1f; }
    .progress { display:flex;align-items:center;gap:10px; } .progress .line { flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .winner { border-left:3px solid #e8ad32;padding:2px 0 2px 10px;margin:6px 0; } .winner + .winner { margin-top:10px; }
    .big { font-size:15px;font-weight:bold; } .meta { display:flex;flex-wrap:wrap;gap:2px 16px;margin-top:2px; } .meta > span { white-space:nowrap; }
    .reach-time { font-weight:bold;color:#1f2d42; }
    .tw { overflow:auto;max-height:360px;border:1px solid #e3e9f2;border-radius:6px;margin-top:4px; }
    table { border-collapse:collapse;width:100%;font-size:12px; } th,td { padding:3px 8px;text-align:left;white-space:nowrap;border-bottom:1px solid #edf1f6; }
    th { position:sticky;top:0;background:#f3f6fb;color:#4b5970;font-weight:normal;z-index:1; } tr:last-child td { border-bottom:0; } tbody tr:hover td { background:#f8fafd; }
    td.num,th.num { text-align:right;font-variant-numeric:tabular-nums; } td.wrap { white-space:normal;min-width:180px; }
    details > summary { cursor:pointer;color:#24539f; } details[open] > summary { margin-bottom:2px; }
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
  // 关闭只隐藏面板；查询进行中再次打开可继续查看进度。
  header.append(title, sub, button('关闭', () => { host.style.display = 'none'; }, 'ghost'));
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
  function table(headers, rows, { num = [], wrap = [] } = {}) {
    const box = el('div', 'tw'), t = el('table'), head = el('tr'), body = el('tbody');
    headers.forEach((h, i) => head.append(el('th', num.includes(i) ? 'num' : '', h)));
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

    const setup = el('section');
    setup.append(el('h2', '', '查询设置'));
    const targetRow = el('div', 'row'), targetSelect = el('select');
    targetSelect.setAttribute('aria-label', '目标区服');
    for (const t of info.targets) targetSelect.append(new Option(`${t.name}（${t.psid}）`, t.psid));
    targetRow.append(el('span', 'k', '目标区服'), targetSelect);

    const thresholdRow = el('div', 'row'), seg = el('div', 'seg'), custom = el('input');
    custom.type = 'text'; custom.inputMode = 'decimal'; custom.placeholder = '自定义'; custom.size = 7; custom.setAttribute('aria-label', '自定义门槛金额');
    seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', '真实扣款门槛');
    let thresholdValue = '500';
    for (const value of ['500', '2000', '5000']) {
      const label = el('label'), radio = el('input');
      radio.type = 'radio'; radio.name = 'crown-threshold'; radio.value = value; radio.checked = value === '500';
      radio.onchange = () => { thresholdValue = value; custom.value = ''; };
      label.append(radio, document.createTextNode(value)); seg.append(label);
    }
    custom.oninput = () => { for (const r of seg.querySelectorAll('input[type=radio]')) r.checked = false; thresholdValue = custom.value.trim(); };
    const customLabel = el('label'); customLabel.append(custom, document.createTextNode(' 元'));
    thresholdRow.append(el('span', 'k', '扣款门槛'), seg, customLabel);

    const scanRow = el('div', 'row'), full = el('input'), fullLabel = el('label');
    full.type = 'checkbox'; fullLabel.append(full, document.createTextNode(' 完整扫描'));
    fullLabel.title = '不按累充金额排除角色，列出全部达标排名，较慢';
    scanRow.append(fullLabel, el('span', 'muted', '不按累充排除，列出全部达标排名（较慢）'));
    setup.append(targetRow, thresholdRow, scanRow);
    if (info.unknown.length) setup.append(el('div', 'warn', `未能识别的区服：${info.unknown.join('、')}`));

    // 共服：选择需要一起统计的游戏ID，并为目标区服填写对应区服ID（编号一致时可勾选共用编号）。
    const shared = el('section');
    const sharedList = el('div'), searchBox = el('input', 'search'), matches = el('div', 'matches'), sharedTitle = el('h2', '', '共服范围');
    searchBox.placeholder = '搜索游戏ID或名称，添加共服游戏'; searchBox.setAttribute('aria-label', '搜索共服游戏');
    matches.hidden = true; sharedTitle.append(searchBox);
    shared.append(sharedTitle, matches, sharedList, el('div', 'muted', saved ? '已带出上次保存的共服设置，可修改。' : '首次查询该游戏：如有共服游戏请添加；没有则直接开始查询，设置会被保存。'));
    function renderShared() {
      sharedList.replaceChildren();
      if (!config.games.length) sharedList.append(el('div', 'muted', '仅统计当前游戏。'));
      for (const game of config.games) {
        const row = el('div', 'shared-row'), input = el('input'), same = el('input'), sameLabel = el('label'), hint = el('span', 'hint');
        input.type = 'text'; input.placeholder = '对应区服ID'; input.setAttribute('aria-label', `${game.gid} 对应区服ID`);
        same.type = 'checkbox'; same.checked = !!game.sameIds; sameLabel.append(same, document.createTextNode(' 编号一致'));
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
        const name = el('span', 'name', gameName(game.gid)); name.title = name.textContent;
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
        const row = el('div');
        row.append(button('添加', () => { config.games.push({ gid: o.value, sameIds: false, map: {} }); searchBox.value = ''; matches.hidden = true; renderShared(); }), el('span', '', o.textContent.trim()));
        matches.append(row);
      }
    };
    targetSelect.onchange = renderShared;
    renderShared();

    const grid = el('div', 'setup-grid'), actions = el('div', 'actions'), start = button('开始查询', null, 'primary'), status = el('div');
    grid.append(setup, shared);
    actions.append(start, el('span', 'muted', '查询期间请不要刷新页面；不会改变订单页当前的查询条件。'));
    const progress = el('section', 'progress'); progress.hidden = true;
    const results = el('div');
    main.append(grid, actions, status, progress, results);

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
        run({ scope, thresholdCents, fullScan: full.checked, start, progress, results, setup, shared, done: renderShared });
      } catch (error) {
        status.append(el('div', 'bad', '无法开始查询：' + error.message));
      } finally {
        if (!launched) start.disabled = false;
      }
    };
  }

  async function run({ scope, thresholdCents, fullScan, start, progress, results, setup, shared, done }) {
    const controller = new AbortController();
    task = controller;
    const lock = pending => { for (const node of [...setup.querySelectorAll('input,select,button'), ...shared.querySelectorAll('input,select,button')]) node.disabled = pending; start.disabled = pending; };
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
    const summary = el('section'), heading = el('h2', '', `结果 · 门槛 ${yuan(thresholdCents)}`);
    heading.append(el('span', complete ? 'pill' : 'pill no', complete ? '查询完整' : '查询不完整'),
      el('span', 'muted', `读取时间 ${startedAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}` +
        (result ? ` · 核查订单 ${result.checked} 名角色，按累充金额排除 ${result.skippedByTotal} 名` : '')));
    summary.append(heading);
    // 覆盖范围放在结果标题下一行，不再单独占一个区块。
    const coverage = el('div', 'muted', '覆盖：' + scope.map(s => `${gameName(s.gid)} · ${s.name}（${s.psid}）`).join('；'));
    summary.append(coverage);
    if (!complete) summary.append(el('div', 'bad', '查询不完整，不能作为冠名权结论。' + (fatal ? '\n' + fatal : '') +
      allIssues.slice(0, 20).map(i => `\n· ${i.role?.roleName || i.role?.roleId || ''} ${i.reason}`).join('') + (allIssues.length > 20 ? `\n…共 ${allIssues.length} 条` : '')));
    const queryDetails = [];
    for (const w of result?.warnings || []) {
      if (w.kind === 'query-detail') queryDetails.push(w);
      else summary.append(el('div', 'warn', w.reason));
    }
    if (queryDetails.length) {
      const details = el('details');
      details.append(el('summary', '', `查询说明（${queryDetails.length} 条，点击展开）`));
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
        const orders = el('details'), orderCents = w.orders.reduce((total, o) => total + o.amountCents, 0);
        orders.append(el('summary', '', `订单明细（${w.orders.length} 笔，合计 ${yuan(orderCents)}，点击展开）`),
          table(['订单号', '创建时间', '真实扣款'], w.orders.map(o => [o.orderId, o.createdAt, calc.yuan(o.amountCents)]), { num: [2] }));
        const nameLine = el('div', 'big', `${w.roleName || '(无角色名)'} · ${w.roleId}`), meta = el('div', 'meta');
        // 活动常限定达标后几天内申请，达标时间加粗便于核对是否过期。
        meta.append(kv('首次达标', el('span', 'reach-time', `${w.date} ${w.time.slice(11)}`)), kv('达标时累计', yuan(w.reachedCents)),
          kv('当天总额', yuan(w.dayTotalCents)), kv('区服', `${server?.name || ''}（${w.serverId}）`));
        // 标题栏已显示查询的游戏；达标角色属于共服的其他游戏时才单独标出。
        if (w.gameId !== scope[0].gid) meta.append(kv('游戏', gameName(w.gameId)));
        box.append(nameLine, meta, orders);
        if (globalThis.WorkToolRoleCopy && w.roleName && server?.name) {
          const name = el('span','',w.roleName);
          globalThis.WorkToolRoleCopy.bindName(name,() => ({roleId: w.roleId, roleName: w.roleName, serverName: server.name}));
          nameLine.replaceChildren(name,document.createTextNode(` · ${w.roleId}`));
        }
        best.append(box);
      }
      results.append(best);
      const others = result.ranking.filter(r => r.place > 1);
      const rank = el('section');
      rank.append(el('h2', '', `其他达标角色（${others.length} 名）`));
      if (result.stoppedEarly) rank.append(el('div', 'muted', '已提前结束：只列出最早达标当天及之前核查到的角色。需要完整排名请勾选“完整扫描”。'));
      if (others.length) rank.append(table(['名次', '角色', '角色ID', '区服ID', '达标时间', '达标时累计'], others.map(r => [r.place + (r.tied ? '（并列）' : ''), r.roleName, r.roleId, r.serverId, el('span', 'reach-time', r.time), calc.yuan(r.reachedCents)]), { num: [5] }));
      results.append(rank);
      const audit = el('section'), auditDetails = el('details');
      // 累充不足门槛、未查订单的角色不列出（只计数）；其余按累充金额从高到低排，同额再按最高单日真实扣款。
      const checks = result.checks.filter(c => c.from).sort((a, b) => (b.role.totalCents ?? -1) - (a.role.totalCents ?? -1) || (b.peakCents || 0) - (a.peakCents || 0));
      auditDetails.append(el('summary', '', `逐角色订单核对（${checks.length} 名，按累充金额从高到低` +
        (result.skippedByTotal ? `；另 ${result.skippedByTotal} 名累充不足门槛未查询，不列出` : '') + '）'),
        table(['角色', '角色ID', '累充金额', '订单查询日期', '返回 / 已支付', '最高单日真实扣款', '说明'], checks.map(c => [
          c.role.roleName || '', c.role.roleId,
          c.role.totalCents == null ? '-' : calc.yuan(c.role.totalCents),
          `${c.from} ~ ${c.to}`,
          `${c.returned} / ${c.paid}`,
          c.peakDate ? `${c.peakDate}：${yuan(c.peakCents)}` : '-', c.reason
        ]), { num: [2, 4], wrap: [6] }));
      audit.append(auditDetails); results.append(audit);
    }
    const list = el('section'), details = el('details');
    const sorted = players.slice().sort((a, b) => (b.totalCents || 0) - (a.totalCents || 0));
    details.append(el('summary', '', `所查区服的玩家和累充金额（${players.length} 名，按金额排序）`),
      table(['角色', '角色ID', '区服ID', '创建时间', '累充金额'], sorted.slice(0, 500).map(p => [p.roleName, p.roleId, p.serverId, p.createdAt, p.totalCents == null ? '-' : calc.yuan(p.totalCents)]), { num: [4] }));
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
