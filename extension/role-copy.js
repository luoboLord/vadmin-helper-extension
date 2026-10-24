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
  let toastHost, toastText, toastTimer;
  function notify(message) {
    if (!toastHost?.isConnected) {
      toastHost = document.createElement('div'); toastHost.id = 'work-tool-role-copy-toast';
      toastHost.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;';
      const shadow = toastHost.attachShadow({mode:'open'}), style = document.createElement('style');
      style.textContent = 'div{font:13px/1.6 "Microsoft YaHei",sans-serif;color:white;background:#233047;padding:8px 16px;border-radius:6px;box-shadow:0 3px 12px #0003}';
      toastText = document.createElement('div'); toastText.setAttribute('role','status'); toastText.setAttribute('aria-live','polite');
      shadow.append(style,toastText); document.documentElement.append(toastHost);
    }
    clearTimeout(toastTimer); toastHost.hidden = false; toastText.textContent = message;
    toastTimer = setTimeout(() => { toastHost.hidden = true; }, 2000);
  }
  const bound = new WeakMap();
  function unbindName(target) {
    const state = bound.get(target); if (!state) return;
    target.removeEventListener('click',state.activate,true); target.removeEventListener('keydown',state.activate,true);
    for (const [name,value] of Object.entries(state.attributes)) value === null ? target.removeAttribute(name) : target.setAttribute(name,value);
    target.style.cursor = state.cursor; target.style.color = state.color;
    delete target.dataset.workToolRoleCopy; bound.delete(target);
  }
  function bindName(target, read) {
    const existing = bound.get(target);
    if (existing) { existing.read = read; target.setAttribute('aria-label',`${clean(read().roleName)}，点击复制角色信息`); return target; }
    const state = {read,busy:false,cursor:target.style.cursor,color:target.style.color,attributes:{}};
    for (const name of ['title','role','tabindex','aria-label']) state.attributes[name] = target.getAttribute(name);
    target.dataset.workToolRoleCopy = ''; target.style.cursor = 'copy'; target.style.color = '#2859a9';
    target.title = '点击角色名复制：角色ID、角色名、区服名称';
    target.setAttribute('role','button'); target.setAttribute('tabindex','0');
    target.setAttribute('aria-label',`${clean(read().roleName)}，点击复制角色信息`);
    state.activate = async event => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.type === 'keydown' && !['Enter',' '].includes(event.key)) return;
      if (event.type === 'click' && event.button !== 0) return;
      if (event.target.closest?.('input,textarea,select,button')) return;
      const selection = document.getSelection();
      if (event.type === 'click' && selection && !selection.isCollapsed && selection.containsNode(target,true)) { event.preventDefault(); return; }
      event.preventDefault(); event.stopPropagation();
      if (state.busy) return;
      state.busy = true;
      try { const info = state.read(); await write(format(info)); notify(`已复制「${clean(info.roleName)}」的角色信息`); }
      catch { notify('复制失败，请重试'); }
      finally { state.busy = false; }
    };
    target.addEventListener('click',state.activate,true); target.addEventListener('keydown',state.activate,true);
    bound.set(target,state); return target;
  }
  const api = {format, bindName};
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
    if (!cols) { for (const target of table.querySelectorAll('[data-work-tool-role-copy]')) unbindName(target); return; }
    for (const row of table.querySelectorAll('tbody tr')) {
      const existing = row.querySelector('[data-work-tool-role-copy]');
      try { format(read(row, cols)); }
      catch { if (existing) unbindName(existing); continue; }
      const cell = row.children[cols.roleName];
      if (existing && existing !== cell) unbindName(existing);
      bindName(cell,() => read(row, columns(table) || cols));
    }
  }
  let pending = false;
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; refresh(); }); } };
  new MutationObserver(schedule).observe(document.documentElement, {subtree: true, childList: true, characterData: true});
  refresh();
})(globalThis);
