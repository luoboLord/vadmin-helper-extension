(() => {
  'use strict';
  const calc = globalThis.WorkToolCrown, api = globalThis.WorkToolCrownFetch;
  if (!calc || !api || !/^\/(?:order\/ls|game\/playerinfo)\/?$/.test(location.pathname)) return;
  const storage = globalThis.chrome?.storage?.local;

  const host = document.createElement('div');
  host.id = 'work-tool-crown';
  host.style.cssText = 'all:initial;position:fixed;left:20px;top:60px;z-index:2147483646;display:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { color-scheme:light; } * { box-sizing:border-box; }
    .panel { width:min(620px,calc(100vw - 40px));max-height:calc(100vh - 80px);display:flex;flex-direction:column;border:1px solid #dce3ef;border-radius:12px;
      background:#f4f7fc;color:#233047;font:13px/1.5 "Microsoft YaHei",sans-serif;box-shadow:0 8px 32px #172b4d30;overflow:hidden; }
    header { display:flex;align-items:center;gap:8px;padding:10px 12px;background:white;border-bottom:1px solid #e4eaf3; } strong { flex:1;font-size:15px; }
    main { padding:10px;overflow:auto;overscroll-behavior:contain;flex:1; }
    section { background:white;border-radius:8px;padding:10px;margin-bottom:8px; } h2 { font-size:13px;margin:0 0 8px; }
    button { font:inherit;border:0;border-radius:6px;background:#e9effa;color:#2859a9;padding:4px 10px;cursor:pointer; } button:hover { background:#dbe8ff; }
    button.primary { background:#2859a9;color:white; } button:disabled { opacity:.5;cursor:default; }
    input,select { font:inherit;padding:5px 7px;border:1px solid #bac8dc;border-radius:5px;background:white;color:#233047; }
    label { margin-right:10px;white-space:nowrap; } .row { display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0; }
    .muted { color:#66758b;font-size:12px; } .warn { background:#fff5dd;color:#885900;padding:6px 8px;border-radius:5px;margin:6px 0;white-space:pre-wrap; }
    .bad { background:#ffe9e7;color:#a12b1f;padding:6px 8px;border-radius:5px;margin:6px 0;white-space:pre-wrap; }
    .ok { background:#e7f6ec;color:#1d6b38;padding:6px 8px;border-radius:5px;margin:6px 0; }
    .winner { border-left:3px solid #e8ad32;padding-left:8px;margin:8px 0; } .big { font-size:15px;font-weight:bold; }
    table { border-collapse:collapse;width:100%;font-size:12px;margin-top:6px; } th,td { border:1px solid #e4eaf3;padding:3px 5px;text-align:left;overflow-wrap:anywhere; }
    th { background:#f4f7fc; } td.num { text-align:right; } details { margin-top:6px; } summary { cursor:pointer;color:#2859a9; }
    .matches { max-height:160px;overflow:auto;border:1px solid #e4eaf3;border-radius:5px;margin-top:4px; } .matches div { padding:3px 6px;display:flex;gap:6px;align-items:center; }
    .reach-time { font-weight:bold; }
    [hidden] { display:none!important; }
  `;
  const el = (tag, className, textValue) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue != null) node.textContent = textValue;
    return node;
  };
  const button = (label, onclick, className = '') => { const b = el('button', className, label); b.type = 'button'; b.onclick = onclick; return b; };
  const panel = el('aside', 'panel'), header = el('header'), title = el('strong', '', '查冠名权'), main = el('main');
  panel.setAttribute('aria-label', '查冠名权');
  // 关闭只隐藏面板；查询进行中再次打开可继续查看进度。
  header.append(title, button('关闭', () => { host.style.display = 'none'; }));
  panel.append(header, main); shadow.append(style, panel); document.documentElement.append(host);

  const gameName = gid => {
    const option = [...(document.querySelector('select#form_gid')?.options || [])].find(o => o.value === String(gid));
    return option ? option.textContent.trim() : String(gid);
  };
  const yuan = cents => calc.yuan(cents) + ' 元';
  function table(headers, rows) {
    const t = el('table'), head = el('tr');
    for (const h of headers) head.append(el('th', '', h));
    t.append(head);
    for (const row of rows) {
      const tr = el('tr');
      for (const cell of row) {
        if (cell instanceof Node) { const td = el('td'); td.append(cell); tr.append(td); }
        else tr.append(el('td', typeof cell === 'number' ? 'num' : '', String(cell)));
      }
      t.append(tr);
    }
    return t;
  }
  function reachLine(w) {
    const line = el('div');
    line.append('首次达标：', el('span', 'reach-time', `${w.date} ${w.time.slice(11)}`), ` · 达标时累计 ${yuan(w.reachedCents)} · 当天总额 ${yuan(w.dayTotalCents)}`);
    return line;
  }

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
    host.style.display = 'block';
    if (task) return;
    main.replaceChildren(el('div', 'muted', '正在读取当前查询结果…'));
    let info;
    try { info = await readTargets(); } catch (error) { info = { error: error.message }; }
    main.replaceChildren();
    if (info.error) { main.append(el('div', 'warn', info.error)); return; }
    serverCache.set(info.gid, Promise.resolve(info.servers));
    const saved = await loadConfig(info.gid);
    const config = { games: (saved?.games || []).map(g => ({ ...g, map: { ...(g.map || {}) } })) };

    const setup = el('section');
    setup.append(el('h2', '', '查询设置'));
    const targetRow = el('div', 'row'), targetSelect = el('select');
    targetSelect.setAttribute('aria-label', '目标区服');
    for (const t of info.targets) targetSelect.append(new Option(`${t.name}（${t.psid}）`, t.psid));
    targetRow.append(el('span', '', '目标：' + gameName(info.gid) + ' · 区服'), targetSelect);
    if (info.unknown.length) setup.append(el('div', 'warn', `未能识别的区服：${info.unknown.join('、')}`));

    const thresholdRow = el('div', 'row'), custom = el('input');
    custom.type = 'text'; custom.inputMode = 'decimal'; custom.placeholder = '自定义金额'; custom.size = 10; custom.setAttribute('aria-label', '自定义门槛金额');
    thresholdRow.append(el('span', '', '真实扣款门槛：'));
    let thresholdValue = '500';
    for (const value of ['500', '2000', '5000']) {
      const label = el('label'), radio = el('input');
      radio.type = 'radio'; radio.name = 'crown-threshold'; radio.value = value; radio.checked = value === '500';
      radio.onchange = () => { thresholdValue = value; custom.value = ''; };
      label.append(radio, document.createTextNode(' ' + value + ' 元')); thresholdRow.append(label);
    }
    custom.oninput = () => { for (const r of thresholdRow.querySelectorAll('input[type=radio]')) r.checked = false; thresholdValue = custom.value.trim(); };
    thresholdRow.append(custom, el('span', 'muted', '元'));

    const scanRow = el('div', 'row'), full = el('input'), fullLabel = el('label');
    full.type = 'checkbox'; fullLabel.append(full, document.createTextNode(' 完整扫描（不按累充金额排除角色，列出全部达标排名，较慢）'));
    scanRow.append(fullLabel);
    setup.append(targetRow, thresholdRow, scanRow);

    // 共服：选择需要一起统计的游戏ID，并为目标区服填写对应区服ID（编号一致时可勾选共用编号）。
    const shared = el('section');
    const sharedList = el('div'), searchBox = el('input'), matches = el('div', 'matches');
    searchBox.placeholder = '搜索游戏ID或名称，添加共服游戏'; searchBox.style.width = '100%'; searchBox.setAttribute('aria-label', '搜索共服游戏');
    matches.hidden = true;
    shared.append(el('h2', '', '共服范围'), el('div', 'muted', saved ? '已带出上次保存的共服设置，可修改。' : '首次查询该游戏：如有共服游戏请添加；没有则直接开始查询，设置会被保存。'), sharedList, searchBox, matches);
    function renderShared() {
      sharedList.replaceChildren();
      if (!config.games.length) sharedList.append(el('div', 'muted', '仅统计当前游戏。'));
      for (const game of config.games) {
        const row = el('div', 'row'), input = el('input'), same = el('input'), sameLabel = el('label'), hint = el('span', 'muted');
        input.size = 14; input.placeholder = '对应区服ID'; input.setAttribute('aria-label', `${game.gid} 对应区服ID`);
        same.type = 'checkbox'; same.checked = !!game.sameIds; sameLabel.append(same, document.createTextNode(' 编号一致'));
        const psid = targetSelect.value;
        input.value = game.sameIds ? psid : (game.map[psid] || '');
        input.disabled = same.checked;
        const check = async () => {
          const value = same.checked ? targetSelect.value : input.value.trim();
          if (!same.checked) { if (value) game.map[targetSelect.value] = value; else delete game.map[targetSelect.value]; }
          if (!value) { hint.textContent = '请填写对应区服ID'; return; }
          try { const hit = (await serversOf(game.gid)).find(s => s.psid === value); hint.textContent = hit ? '✓ ' + hit.name : '该游戏没有这个区服ID'; }
          catch (error) { hint.textContent = error.message; }
        };
        input.onchange = check; same.onchange = () => { game.sameIds = same.checked; renderShared(); };
        row.append(el('span', '', gameName(game.gid)), input, sameLabel, button('移除', () => { config.games = config.games.filter(g => g !== game); renderShared(); }), hint);
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

    const actions = el('div', 'row'), start = button('开始查询', null, 'primary'), status = el('div');
    actions.append(start, el('span', 'muted', '查询期间请不要刷新页面；不会改变订单页当前的查询条件。'));
    const progress = el('section'); progress.hidden = true;
    const results = el('div');
    main.append(setup, shared, actions, status, progress, results);

    start.onclick = async () => {
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
      run({ scope, thresholdCents, fullScan: full.checked, start, progress, results, setup, shared, done: renderShared });
    };
  }

  async function run({ scope, thresholdCents, fullScan, start, progress, results, setup, shared, done }) {
    const controller = new AbortController();
    task = controller;
    const lock = pending => { for (const node of [...setup.querySelectorAll('input,select,button'), ...shared.querySelectorAll('input,select,button')]) node.disabled = pending; start.disabled = pending; };
    lock(true);
    const line = el('div'), cancel = button('取消', () => controller.abort(Error('已取消')));
    progress.replaceChildren(el('h2', '', '查询进度'), line, cancel); progress.hidden = false;
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
    const summary = el('section');
    summary.append(el('h2', '', `结果 · 门槛 ${yuan(thresholdCents)}`));
    if (complete) summary.append(el('div', 'ok', '查询完整。'));
    else summary.append(el('div', 'bad', '查询不完整，不能作为冠名权结论。' + (fatal ? '\n' + fatal : '') +
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
        box.append(el('div', 'big', `${w.roleName || '(无角色名)'} · ${w.roleId}`),
          el('div', '', `${gameName(w.gameId)} · ${server?.name || ''}（区服ID ${w.serverId}）`),
          // 活动常限定达标后几天内申请，达标时间加粗便于核对是否过期。
          reachLine(w),
          table(['订单号', '创建时间', '真实扣款'], w.orders.map(o => [o.orderId, o.createdAt, calc.yuan(o.amountCents)])));
        if (globalThis.WorkToolRoleCopy && w.roleName && server?.name) {
          const name = el('span','',w.roleName);
          globalThis.WorkToolRoleCopy.bindName(name,() => ({roleId: w.roleId, roleName: w.roleName, serverName: server.name}));
          box.firstChild.replaceChildren(name,document.createTextNode(` · ${w.roleId}`));
        }
        best.append(box);
      }
      results.append(best);
      const others = result.ranking.filter(r => r.place > 1);
      const rank = el('section');
      rank.append(el('h2', '', '其他达标角色'));
      if (result.stoppedEarly) rank.append(el('div', 'muted', '已提前结束：只列出最早达标当天及之前核查到的角色。需要完整排名请勾选“完整扫描”。'));
      if (others.length) rank.append(table(['名次', '角色', '角色ID', '区服ID', '达标时间', '达标时累计'], others.map(r => [r.place + (r.tied ? '（并列）' : ''), r.roleName, r.roleId, r.serverId, el('span', 'reach-time', r.time), calc.yuan(r.reachedCents)])));
      else rank.append(el('div', 'muted', '无。'));
      results.append(rank);
      const audit = el('section'), auditDetails = el('details');
      auditDetails.append(el('summary', '', `逐角色订单核对（${result.checks.length} 名，可排查未达标原因）`),
        table(['角色 / ID', '订单查询日期', '返回订单 / 计入已支付', '最高单日真实扣款', '说明'], result.checks.map(c => [
          `${c.role.roleName || ''} / ${c.role.roleId}`,
          c.from ? `${c.from} 至 ${c.to}` : '未查询',
          c.from ? `${c.returned} / ${c.paid}` : '-',
          c.peakDate ? `${c.peakDate}：${yuan(c.peakCents)}` : '-', c.reason
        ])));
      audit.append(auditDetails); results.append(audit);
    }
    const list = el('section'), details = el('details');
    const sorted = players.slice().sort((a, b) => (b.totalCents || 0) - (a.totalCents || 0));
    details.append(el('summary', '', `所查区服的玩家和累充金额（${players.length} 名，按金额排序）`),
      table(['角色', '角色ID', '区服ID', '创建时间', '累充金额'], sorted.slice(0, 500).map(p => [p.roleName, p.roleId, p.serverId, p.createdAt, p.totalCents == null ? '-' : calc.yuan(p.totalCents)])));
    if (sorted.length > 500) details.append(el('div', 'muted', '只显示前 500 名。'));
    list.append(details); results.append(list);
    const coverage = el('section');
    coverage.append(el('h2', '', '覆盖范围'),
      el('div', '', scope.map(s => `${gameName(s.gid)} · ${s.name}（${s.psid}）`).join('\n')),
      el('div', 'muted', `读取时间 ${startedAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}` +
        (result ? ` · 核查订单 ${result.checked} 名角色，按累充金额排除 ${result.skippedByTotal} 名` : '')));
    coverage.lastChild.style.whiteSpace = 'pre-wrap';
    results.append(coverage);
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
