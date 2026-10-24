(function (root) {
  'use strict';
  // 后台读取适配：只用页面自己的只读查询（订单列表、玩家信息、区服列表），参数与真实页面一致，
  // 详见 reports/crown-backend-check.md。所有请求串行，取消后不再发出后续请求。
  const calc = root.WorkToolCrown || (typeof require === 'function' ? require('./crown-calc.js') : null);
  const ORDER_PAGE = 1000, PLAYER_PAGE = 250, RETRIES = 3;

  class LoginError extends Error {}
  class QueryError extends Error {}
  const text = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').trim();
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason || Error('已取消')); }, { once: true });
  });

  // 登录失效时后台通常重定向到登录页并返回 200 的 HTML，因此不能只看状态码。
  async function post(path, params, { signal, fetchImpl = root.fetch.bind(root) } = {}) {
    let lastError;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      if (signal?.aborted) throw signal.reason || Error('已取消');
      let response;
      try {
        response = await fetchImpl(path, { method: 'POST', body: new URLSearchParams(params), credentials: 'same-origin', signal,
          headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
        lastError = Error('网络请求失败：' + error.message);
        await sleep(1000 * (attempt + 1), signal); continue;
      }
      if (response.status >= 500) { lastError = Error(`后台返回 ${response.status}`); await sleep(1000 * (attempt + 1), signal); continue; }
      const body = await response.text();
      let json;
      try { json = JSON.parse(body); } catch { json = null; }
      if (response.redirected || response.status === 401 || response.status === 403 || json === null) throw new LoginError('登录失效或后台返回异常，请刷新后台页面重新登录后再查');
      // 新订单接口可能把筛选错误与空 data 一同返回，不能把这种响应判成“没有订单”。
      if (json && (json.error || (json.errno != null && Number(json.errno) !== 0))) {
        throw new QueryError('后台查询失败：' + text(json.errmsg || json.error || json.message || json.errno));
      }
      if (response.status >= 400) throw Error(`后台查询失败：HTTP ${response.status}`);
      return json;
    }
    throw lastError;
  }

  async function servers(gid, options) {
    const json = await post('/order/getgidpsid', { gid }, options);
    const list = Array.isArray(json) ? json : Object.values(json || {});
    return list.map(s => ({ gid: String(s.gid ?? gid), psid: String(s.psid), name: text(s.psname) })).filter(s => s.psid);
  }

  function parsePlayer(row, gid) {
    // 玩家页取“累充金额”作候选预筛选及展示；最终达标仍只累计订单real_amount。
    return { gameId: String(gid), serverId: text(row._psid), roleId: text(row.roleid_pre), roleName: text(row.role_name),
      createdAt: text(row.create_time), totalCents: calc.toCents(text(row.pay_money)) };
  }
  // 玩家信息按创建时间正序翻完全部分页；新角色只会追加到末尾，翻页不会错位。
  async function players({ gid, psid }, { signal, onPage, fetchImpl } = {}) {
    const list = [];
    let total = null;
    for (let start = 0; total === null || start < total; start += PLAYER_PAGE) {
      const json = await post('/game/playerinfo', { draw: '1', 'search[start]': String(start), 'search[length]': String(PLAYER_PAGE),
        'order[create_time]': 'asc', gid, ps_id: psid, role_id: '', role_name: '', uid: '', puid: '', pfid: '0', pfid_channel: '', showdemo: '1' },
        { signal, fetchImpl });
      const count = Number(json.recordsFiltered);
      if (!Number.isSafeInteger(count) || !Array.isArray(json.data)) return { players: list, complete: false, reason: '玩家信息缺少分页字段' };
      if (total !== null && count !== total) return { players: list, complete: false, reason: '读取期间玩家数量发生变化，请重新查询' };
      total = count;
      if (json.data.length !== Math.min(PLAYER_PAGE, total - start)) return { players: list, complete: false, reason: `玩家信息第 ${start / PLAYER_PAGE + 1} 页条数不足` };
      list.push(...json.data.map(row => parsePlayer(row, gid)));
      onPage?.({ read: list.length, total });
    }
    const bad = list.filter(p => p.serverId !== String(psid) || !p.roleId);
    if (bad.length) return { players: list, complete: false, reason: `${bad.length} 名玩家的区服或角色ID与查询不符` };
    return { players: list, complete: true };
  }

  // 订单行：只统计 pay_status=1（已支付）的真实扣款金额；row.psid 是区服名称，区服ID取查询条件。
  function parseOrder(row, { gid, psid }) {
    const pay = String(row.pay_status ?? '');
    if (pay !== '0' && pay !== '1') return { error: '订单缺少可识别的支付状态' };
    if (pay === '0') return { unpaid: true };
    const order = { orderId: text(row.orderno), gameId: text(row.gid_ ?? gid), serverId: String(psid), roleId: text(row.role_id),
      roleName: text(row.role_name), createdAt: calc.normTime(text(row.add_time)), amountCents: calc.toCents(text(row.real_amount)) };
    if (!order.orderId || !order.createdAt || order.amountCents === null) return { error: `已支付订单 ${order.orderId || '(无订单号)'} 缺少订单号、创建时间或真实扣款金额` };
    return { order };
  }
  // 订单按创建时间倒序返回；读取期间若有新订单插入导致总数变化，整段重读（最多 3 次）。
  async function readOrders(role, startDate, endDate, { signal, fetchImpl, queryServerId = role.serverId, serverName = null } = {}) {
    for (let round = 0; round < 3; round++) {
      const seen = new Map();
      let total = null, changed = false, otherServerCount = 0;
      for (let start = 0; total === null || start < total; start += ORDER_PAGE) {
        // 与当前 order-filter.js 的 OrderFilter.normalize 输出及 jQuery 数组序列化一致。
        const json = await post('/order/ls', { draw: '1', start: String(start), length: String(ORDER_PAGE), 'game_ids[]': role.gameId, pfid: '0',
          psid: String(queryServerId), status: '-1', role_name: '', role_id: role.roleId, orderno: '', pf_orderno: '', product_id: '', product_name: '',
          date: `${startDate} ~ ${endDate}`, stat_search_timetype: 'add_time' }, { signal, fetchImpl });
        const count = Number(json.recordsFiltered);
        if (!Number.isSafeInteger(count) || !Array.isArray(json.data)) return { orders: [], complete: false, reason: '订单列表缺少分页字段' };
        if (total !== null && count !== total) { changed = true; break; }
        total = count;
        if (json.data.length !== Math.min(ORDER_PAGE, total - start)) return { orders: [], complete: false, reason: `订单第 ${start / ORDER_PAGE + 1} 页条数不足` };
        for (const row of json.data) {
          if (serverName !== null) {
            if (text(row.gid_ ?? role.gameId) !== role.gameId || text(row.role_id) !== role.roleId) {
              return { orders: [], complete: false, reason: '按角色查询返回了其他游戏或角色的订单，无法核对区服' };
            }
            const name = text(row.psid);
            if (!name) return { orders: [], complete: false, reason: '订单缺少区服名称，无法核对目标区服' };
            if (name !== serverName) { otherServerCount++; continue; }
          }
          const parsed = parseOrder(row, { gid: role.gameId, psid: role.serverId });
          if (parsed.error) return { orders: [], complete: false, reason: parsed.error };
          if (parsed.order) seen.set(parsed.order.orderId, parsed.order);
        }
      }
      if (!changed) return { orders: [...seen.values()], orderCount: total, otherServerCount, complete: true };
    }
    return { orders: [], complete: false, reason: '读取期间订单数量持续变化，请稍后重试' };
  }

  // ID始终作为文本传递，绝不转为32位整数或截断。部分后台的订单筛选仍拒绝大区服ID，
  // 只在明确报psid无效时改用“单游戏＋角色”查询，并用唯一的区服名称逐行核对。
  async function orders(role, startDate, endDate, options = {}) {
    const target = { ...role, gameId: String(role.gameId).trim(), serverId: String(role.serverId).trim(), roleId: String(role.roleId).trim() };
    try { return await readOrders(target, startDate, endDate, options); }
    catch (error) {
      if (!(error instanceof QueryError) || !/\bpsid\b.*(?:无效|invalid)/i.test(error.message)) throw error;
      const list = await servers(target.gameId, options);
      const matches = list.filter(s => s.psid === target.serverId);
      if (matches.length !== 1 || !matches[0].name || list.filter(s => s.name === matches[0].name).length !== 1) {
        throw Error('后台不接受此区服ID，且区服名称无法唯一对应，查询不完整');
      }
      const result = await readOrders(target, startDate, endDate, { ...options, queryServerId: '-1', serverName: matches[0].name });
      return { ...result, scopeNote: `后台拒绝区服ID筛选，已按“${matches[0].name}”严格核对，排除其他区服 ${result.otherServerCount || 0} 笔订单` };
    }
  }

  // 北京时间今天，不依赖电脑时区。
  const beijingToday = (now = Date.now()) => new Date(now + 8 * 3600e3).toISOString().slice(0, 10);

  const api = { LoginError, QueryError, text, post, servers, players, parsePlayer, orders, parseOrder, beijingToday, ORDER_PAGE, PLAYER_PAGE };
  root.WorkToolCrownFetch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
