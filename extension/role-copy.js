(function(root) {
  'use strict';
  const clean = value => String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  const server = (value, playerPage) => playerPage ? clean(value).replace(/^\d+\s*-\s*/, '') : clean(value);
  function format(info, playerPage = false) {
    const roleId = clean(info.roleId), roleName = clean(info.roleName);
    const serverName = server(info.serverName, playerPage);
    if (!roleId || !roleName || !serverName) throw Error('该行缺少角色ID、角色名或区服名称');
    return `${roleId}\t${roleName}\t${serverName}`;
  }
  async function write(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const active = document.activeElement, selection = document.getSelection();
      const ranges = selection ? Array.from({length: selection.rangeCount}, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
      const input = document.createElement('textarea');
      input.value = text; input.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.append(input);
      try { input.select(); if (!document.execCommand('copy')) throw Error('复制失败，请重试'); }
      finally {
        input.remove(); active?.focus({preventScroll: true});
        if (selection) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range); }
      }
    }
  }
  function button(read) {
    const host = document.createElement('span');
    host.dataset.workToolRoleCopy = '';
    const shadow = host.attachShadow({mode: 'open'});
    const style = document.createElement('style');
    style.textContent = 'button{font:12px/1.5 "Microsoft YaHei",sans-serif;margin-left:6px;padding:2px 6px;border:0;border-radius:4px;color:#2859a9;background:#edf3ff;cursor:pointer;white-space:nowrap}button:disabled{opacity:.6}button:focus-visible{outline:2px solid #2859a9}';
    const copy = document.createElement('button');
    copy.type = 'button'; copy.textContent = '复制角色信息';
    copy.title = '复制为一行：角色ID、角色名、区服名称（制表符分隔）';
    copy.setAttribute('aria-live', 'polite');
    let timer;
    copy.addEventListener('click', async event => {
      event.preventDefault(); event.stopPropagation(); clearTimeout(timer); copy.disabled = true;
      try { await write(format(read())); copy.textContent = '已复制'; }
      catch (error) { copy.textContent = '复制失败'; copy.title = error.message; }
      finally { copy.disabled = false; timer = setTimeout(() => { copy.textContent = '复制角色信息'; }, 2000); }
    });
    shadow.append(style, copy);
    return host;
  }
  const api = {format, button};
  root.WorkToolRoleCopy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined' || !/^\/(?:order\/ls|game\/playerinfo)\/?$/.test(location.pathname)) return;
  const playerPage = location.pathname.startsWith('/game/');
  const normalize = node => node.textContent.replace(/\s+/g, '');
  function columns(table) {
    for (const tr of table.querySelectorAll('thead tr')) {
      const headers = [...tr.children].map(normalize);
      const roleId = headers.indexOf('角色ID'), roleName = headers.indexOf('角色名');
      const server = headers.findIndex(h => ['游戏区服ID', '区服ID', '区服名称'].includes(h));
      if (roleId >= 0 && roleName >= 0 && server >= 0) return {roleId, roleName, server};
    }
    return null;
  }
  function read(row, cols) {
    return {roleId: row.children[cols.roleId]?.textContent, roleName: row.children[cols.roleName]?.textContent,
      serverName: server(row.children[cols.server]?.textContent, playerPage)};
  }
  function refresh() {
    const table = document.querySelector('#list_table');
    if (!table) return;
    const cols = columns(table);
    if (!cols) { for (const host of table.querySelectorAll('[data-work-tool-role-copy]')) host.remove(); return; }
    for (const row of table.querySelectorAll('tbody tr')) {
      const existing = row.querySelector('[data-work-tool-role-copy]');
      try { format(read(row, cols)); }
      catch { existing?.remove(); continue; }
      const cell = row.children[cols.roleName];
      if (existing?.parentElement === cell) continue;
      existing?.remove();
      cell.append(button(() => read(row, columns(table) || cols)));
    }
  }
  let pending = false;
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; refresh(); }); } };
  new MutationObserver(schedule).observe(document.documentElement, {subtree: true, childList: true, characterData: true});
  refresh();
})(globalThis);
