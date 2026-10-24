(function (root) {
  'use strict';
  // 后台时间是不带时区的北京时间文本；统一成“YYYY-MM-DD HH:mm:ss”后直接按字符串比较，
  // 不经过 Date，避免在非 UTC+8 的电脑上跨日。
  function normTime(value) {
    const m = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(String(value ?? ''));
    if (!m) return null;
    const [, y, mo, d, h, mi, s = '0'] = m, pad = v => String(v).padStart(2, '0');
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59 || +s > 59) return null;
    return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;
  }
  // 金额一律转成整数分，最多两位小数；无法识别时返回 null，由调用方标记为不完整。
  function toCents(value) {
    if (typeof value === 'number') value = String(value);
    const m = /^\s*[¥￥]?\s*(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(?:元)?\s*$/.exec(String(value ?? ''));
    if (!m) return null;
    const cents = Number(m[2].replace(/,/g, '')) * 100 + Number((m[3] || '').padEnd(2, '0'));
    return Number.isSafeInteger(cents) ? (m[1] ? -cents : cents) : null;
  }
  const yuan = cents => (cents / 100).toFixed(2);
  // 同一角色按游戏ID＋区服ID＋角色ID认定；角色名只用于展示。
  const roleKey = r => [r.gameId, r.serverId, r.roleId].map(v => String(v ?? '').trim()).join('|');
  const byTime = (a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : String(a.orderId).localeCompare(String(b.orderId));

  // 以订单号去重；同一订单号内容不一致时记为冲突，不静默取其中一条。
  function dedupe(orders) {
    const seen = new Map(), conflicts = [];
    for (const order of orders) {
      const old = seen.get(order.orderId);
      if (!old) seen.set(order.orderId, order);
      else if (old.createdAt !== order.createdAt || old.amountCents !== order.amountCents || roleKey(old) !== roleKey(order)) conflicts.push(order.orderId);
    }
    return { orders: [...seen.values()], conflicts: [...new Set(conflicts)] };
  }

  // 单个角色：按创建时间逐日累计，返回第一次累计达到门槛的那一笔，以及当天总额和构成达标金额的订单。
  function firstReach(orders, thresholdCents) {
    const sorted = orders.slice().sort(byTime);
    for (let i = 0; i < sorted.length;) {
      const date = sorted[i].createdAt.slice(0, 10);
      let j = i;
      while (j < sorted.length && sorted[j].createdAt.slice(0, 10) === date) j++;
      const day = sorted.slice(i, j);
      let sum = 0;
      for (let k = 0; k < day.length; k++) {
        sum += day[k].amountCents;
        if (sum >= thresholdCents) {
          return { date, time: day[k].createdAt, reachedCents: sum,
            dayTotalCents: day.reduce((total, o) => total + o.amountCents, 0), orders: day.slice(0, k + 1) };
        }
      }
      i = j;
    }
    return null;
  }

  // 达标角色按达标时刻排序；时刻相同的列为并列，不强行区分。
  function rank(reached) {
    const sorted = reached.slice().sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
    let place = 0, last = null;
    return sorted.map((item, index) => {
      if (item.time !== last) { place = index + 1; last = item.time; }
      return { ...item, place, tied: sorted.filter(other => other.time === item.time).length > 1 };
    });
  }

  // 排查全部候选角色。fetchOrders(角色, 开始日期, 结束日期) 返回 { orders, complete, reason }。
  // 候选按创建时间从早到晚处理：已有最早达标时刻 best 时，后续角色只查到 best 当天；
  // 角色创建时间晚于 best 就不可能更早达标，排序后可直接结束（fullScan 时关闭提前结束）。
  async function search({ candidates, thresholdCents, excludeByTotal = false, fullScan = false, today, fetchOrders, onProgress, signal }) {
    if (!Number.isSafeInteger(thresholdCents) || thresholdCents <= 0) throw Error('充值门槛必须大于0');
    const issues = [], warnings = [], reached = [], checks = [], names = new Map();
    const valid = [];
    for (const c of candidates) {
      const createdAt = normTime(c.createdAt);
      if (!createdAt) issues.push({ role: c, reason: '缺少角色创建时间' });
      else valid.push({ ...c, createdAt });
    }
    valid.sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
    let best = null, checked = 0, skippedByTotal = 0, stoppedEarly = false;
    for (let index = 0; index < valid.length; index++) {
      if (signal?.aborted) throw signal.reason || Error('已取消');
      const c = valid[index], key = roleKey(c);
      onProgress?.({ index, total: valid.length, role: c, best });
      if (excludeByTotal && !fullScan && Number.isSafeInteger(c.totalCents) && c.totalCents < thresholdCents) {
        skippedByTotal++;
        checks.push({ role: c, reason: '累充金额低于门槛，未查询订单' });
        continue;
      }
      if (!fullScan && best && c.createdAt > best) { stoppedEarly = true; break; }
      const end = !fullScan && best ? best.slice(0, 10) : today;
      const result = await fetchOrders(c, c.createdAt.slice(0, 10), end);
      checked++;
      if (!result.complete) issues.push({ role: c, reason: result.reason || '订单读取不完整' });
      if (result.scopeNote) warnings.push({ role: c, kind: 'query-detail', reason: `${c.roleName || c.roleId}：${result.scopeNote}` });
      const own = result.orders.filter(o => roleKey(o) === key);
      const foreign = result.orders.filter(o => roleKey(o) !== key);
      if (foreign.length) issues.push({ role: c, reason: `${foreign.length} 笔已支付订单的游戏、区服或角色ID与查询不符：` +
        [...new Set(foreign.map(o => `游戏 ${o.gameId} / 区服 ${o.serverId} / 角色 ${o.roleId}`))].slice(0, 5).join('；') });
      const { orders, conflicts } = dedupe(own);
      if (conflicts.length) issues.push({ role: c, reason: `订单号重复但内容不一致：${conflicts.join('、')}` });
      for (const o of orders) {
        if (o.roleName && c.roleName && o.roleName !== c.roleName && !names.has(key)) {
          names.set(key, true); warnings.push({ role: c, reason: `订单中的角色名“${o.roleName}”与玩家信息“${c.roleName}”不同，请核对` });
        }
      }
      // 玩家累充仅作保守上界，不替代订单实付计算，也不要求二者相等。
      const paidCents = orders.reduce((total, o) => total + o.amountCents, 0);
      if (end === today && Number.isSafeInteger(c.totalCents) && paidCents > c.totalCents) {
        issues.push({ role: c, reason: `订单实付合计 ${yuan(paidCents)} 元高于累充金额 ${yuan(c.totalCents)} 元，总额口径不可靠` });
      }
      const hit = firstReach(orders, thresholdCents);
      const days = new Map();
      for (const o of orders) { const date = o.createdAt.slice(0, 10); days.set(date, (days.get(date) || 0) + o.amountCents); }
      const peak = [...days].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      checks.push({ role: c, from: c.createdAt.slice(0, 10), to: end, returned: result.orderCount ?? result.orders.length,
        paid: orders.length, peakDate: peak?.[0], peakCents: peak?.[1] ?? 0,
        reason: !result.complete ? (result.reason || '订单读取不完整') : foreign.length ? '订单身份不匹配，查询不完整' :
          conflicts.length ? '重复订单内容冲突，查询不完整' :
            (hit ? `已达标：${hit.time}` : orders.length ? '单日真实扣款未达门槛' : '未读到该角色的已支付订单') +
              (result.scopeNote ? `；${result.scopeNote}` : '') });
      if (hit) {
        reached.push({ ...c, key, ...hit });
        if (!best || hit.time < best) best = hit.time;
      }
    }
    const ranking = rank(reached);
    return {
      complete: issues.length === 0,
      winners: ranking.filter(item => item.place === 1),
      ranking, issues, warnings, checks, checked, skippedByTotal, stoppedEarly,
      candidates: candidates.length, thresholdCents
    };
  }

  // 共服设置双向保存：在主游戏 base 保存 next 后，同步更新每个共服游戏自己的设置，
  // 让从任一游戏打开都能带出同组其他游戏。configs 为 {游戏ID: {games:[{gid, sameIds, map:{本游戏区服ID: 对方区服ID}}]}}。
  // 只改与本组相关的条目，各游戏另外的共服设置保持不变；从 base 移除的游戏也会删掉它指回 base 的条目。
  function linkShared(configs, base, next) {
    const copy = config => ({ games: (config?.games || []).map(g => ({ gid: String(g.gid), sameIds: !!g.sameIds, map: { ...(g.map || {}) } })) });
    const out = {};
    for (const [gid, config] of Object.entries(configs)) out[gid] = copy(config);
    out[base] = copy(next);
    const members = out[base].games;
    for (const old of configs[base]?.games || []) {
      if (!members.some(g => g.gid === String(old.gid))) {
        const config = out[old.gid] || copy(null);
        config.games = config.games.filter(g => g.gid !== String(base));
        out[old.gid] = config;
      }
    }
    // 以 base 的区服为桥，换算出成员 a 到成员 b 的区服对应；两边都编号一致时直接共用编号。
    const relation = (a, b) => {
      if (a.sameIds && b.sameIds) return { sameIds: true, map: {} };
      const map = {};
      for (const psid of new Set([...Object.keys(a.map), ...Object.keys(b.map)])) {
        const from = a.sameIds ? psid : a.map[psid], to = b.sameIds ? psid : b.map[psid];
        if (from && to) map[from] = to;
      }
      return { sameIds: false, map };
    };
    const baseSelf = { gid: String(base), sameIds: true, map: {} };
    for (const member of members) {
      const config = out[member.gid] || copy(null);
      for (const other of [baseSelf, ...members]) {
        if (other.gid === member.gid) continue;
        const link = relation(member, other);
        let entry = config.games.find(g => g.gid === other.gid);
        if (!entry) { entry = { gid: other.gid, sameIds: false, map: {} }; config.games.push(entry); }
        entry.sameIds = link.sameIds;
        Object.assign(entry.map, link.map);
      }
      out[member.gid] = config;
    }
    return out;
  }

  const api = { normTime, toCents, yuan, roleKey, dedupe, firstReach, rank, search, linkShared };
  root.WorkToolCrown = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
