(function (root) {
  'use strict';
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  // 后台使用【版本】、链接表使用（版本），比较时统一括号。
  const compact = value => normalize(value).replace(/[()[\]【】{}]/g, '');
  const supportedPath = path => /^\/(?:order\/ls|game\/playerinfo)\/?$/.test(path);

  function readSelection(select) {
    if (!select || select.tagName !== 'SELECT') return null;
    const options = Array.from(select.selectedOptions);
    // 按实际选项数量判断；即使两个选项属于同一个游戏也属于多选。
    if (options.length !== 1) return null;
    const option = options[0];
    const label = option.textContent.trim();
    if (!option.value || option.value === '0' || option.value === '-1' || /请选择游戏/.test(label)) return null;
    return { id: option.value, label };
  }

  function uniqueBest(hits) {
    if (!hits.length) return null;
    const score = Math.max(...hits.map(hit => hit.score));
    const best = hits.filter(hit => hit.score === score);
    const keys = new Set(best.map(hit => hit.key));
    return keys.size === 1 ? best[0] : null;
  }

  function match(label, data, gameId) {
    const binding=gameId&&data.gameBindings?.[gameId];
    if(binding){const game=data.games.find(g=>g.name===binding.game);if(game?.versions[binding.version])return {game,version:binding.version};}
    const text = compact(label);
    const hits = [];
    for (const game of data.games) {
      const aliases = game.aliases.map(compact).filter(a => a.length >= 2 && text.includes(a));
      const fulls = Object.keys(game.versions).map(compact).filter(a => text.includes(a));
      if (aliases.length || fulls.length) hits.push({
        key: game.name, game,
        score: (fulls.length ? 10000 : 0) + Math.max(0, ...aliases.map(a => a.length), ...fulls.map(a => a.length))
      });
    }
    let best = uniqueBest(hits);
    if (!best && hits.length) return { ambiguous: true };
    if (!best) {
      // BT 编号可用于已识别游戏内选版本，不能据此推断游戏身份。
      const globalHits = data.globalVersionKeywords.filter(([word]) => !/^bt\d+$/.test(compact(word)) && text.includes(compact(word)))
        .map(([word, name, full]) => ({ key: name + '\n' + full, name, full, score: compact(word).length }));
      const globalBest = uniqueBest(globalHits);
      if (!globalBest) return null;
      return { game: data.games.find(g => g.name === globalBest.name), version: globalBest.full };
    }
    const versionHits = (data.versionKeywords[best.game.name] || [])
      .filter(([word]) => text.includes(compact(word)))
      .map(([word, full]) => ({ key: full, score: compact(word).length }));
    const version = uniqueBest(versionHits);
    return { game: best.game, version: version ? version.key : null };
  }

  const splitServers = value => String(value || '').split('/').map(s => s.trim()).filter(Boolean);
  const isShared = value => !normalize(value) || /^(通用|共用|公共|全部专服(?:通用|共用)?|所有专服(?:通用|共用)?)$/.test(normalize(value));
  function parseServer(value) {
    const raw = String(value || '').trim();
    // 表格中的“渠道2专服2（11）”：括号是后台登录提示，原文仍保留在数据和链接提示中。
    const hint = /^(.*(?:专服|混服)\d*)\s*[（(]\s*(\d+)\s*[）)]$/.exec(raw.normalize('NFKC'));
    return { name: hint ? hint[1].trim() : raw, login: hint ? hint[2] : null };
  }
  const serverKey = value => normalize(parseServer(value).name);

  function selectedServer(label, version) {
    const text = normalize(label);
    // 用完整的括号内容识别专服，避免“部分渠道2专服”误命中“渠道2专服”，
    // 或“渠道1专服2”误命中“渠道1专服”。未收录的专服也不能降级成相似名称。
    const parts = [...text.matchAll(/[([]([^()[\]]+)[)\]]/g)].map(m => m[1]);
    // 后台名称和游戏名称两段可能重复同一个专服，例如“（买量专服）-…（买量专服）”。
    const explicit = [...new Set(parts.filter(s => /专服|混服|渠道|联盟/.test(s)).map(serverKey))];
    if (explicit.length) return explicit.length === 1 ? explicit[0] : null;
    const known = new Set([
      ...version.links.flatMap(link => splitServers(link.server)),
      ...version.notes.flatMap(([server]) => splitServers(server))
    ].filter(s => !isShared(s)).map(serverKey));
    // 兼容未带括号但以分隔符隔开的专服名称，不做子串猜测。
    const tokens = text.split(/[-—:：|,，;；/()[\]【】]+/);
    const hits = [...new Set(tokens.filter(token => known.has(token)))];
    return hits.length === 1 ? hits[0] : null;
  }

  function filterServer(version, label) {
    const server = selectedServer(label, version);
    const applies = scope => isShared(scope) || (server !== null && splitServers(scope).some(s => serverKey(s) === server));
    const scopes = [...version.links.map(link => link.server), ...version.notes.map(([scope]) => scope)];
    const loginHints = [...new Set(scopes.flatMap(splitServers)
      .filter(scope => server !== null && serverKey(scope) === server)
      .map(parseServer).filter(scope => scope.login)
      .map(scope => `登录后台请选择 ${scope.login} 专服（对应${scope.name}）`))];
    return {
      server,
      links: version.links.filter(link => applies(link.server)),
      notes: version.notes.filter(([scope]) => applies(scope)),
      loginHints
    };
  }

  const api = { normalize, compact, supportedPath, readSelection, match, splitServers, isShared, parseServer, serverKey, selectedServer, filterServer };
  root.WorkToolCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
