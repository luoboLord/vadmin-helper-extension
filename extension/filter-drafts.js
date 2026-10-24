(function (root) {
  'use strict';
  const FILTERS = 'input[id^="form_"],textarea[id^="form_"],select[id^="form_"],input#s_rdate';
  const TEXT_TYPES = new Set(['text', 'search', 'number', 'tel', 'email', 'url', 'date', 'datetime-local']);

  function keepFilterDrafts(doc, getJQuery) {
    const drafts = new Map(), servers = new Map();
    let bound = false, queued = false;
    const gameKey = () => [...(doc.querySelector('#form_gid')?.selectedOptions || [])]
      .map(o => String(o.value)).filter(v => v && v !== '0').sort().join('|');
    let game = gameKey(), desiredServer = doc.querySelector('#form_psid')?.value;
    const managed = node => node && node.id !== 'form_gid' &&
      (node.id === 's_rdate' || node.id?.startsWith('form_')) &&
      (node.tagName === 'SELECT' || node.tagName === 'TEXTAREA' ||
        (node.tagName === 'INPUT' && (TEXT_TYPES.has(node.type) || ['checkbox', 'radio'].includes(node.type))));
    const fields = () => [...doc.querySelectorAll(FILTERS)].filter(managed);
    const read = field => field.tagName === 'SELECT' && field.multiple ? [...field.selectedOptions].map(o => String(o.value)) :
      ['checkbox', 'radio'].includes(field.type) ? field.checked : field.value;
    function remember(field) {
      if (!managed(field)) return;
      if (field.id === 'form_psid') {
        desiredServer = String(field.value);
        if (game && !game.includes('|')) servers.set(game, desiredServer);
      } else drafts.set(field.id, read(field));
    }
    const capture = () => { for (const field of fields()) remember(field); };
    function write(field, value) {
      if (field.tagName === 'SELECT') {
        const values = Array.isArray(value) ? value : [String(value)];
        if (!values.every(v => [...field.options].some(o => o.value === v))) return;
        if (JSON.stringify(read(field)) === JSON.stringify(value)) return;
        if (field.multiple) for (const option of field.options) option.selected = values.includes(option.value);
        else field.value = String(value);
        // 只更新Select2显示，不触发后台的change清空/联动查询逻辑。
        const $ = getJQuery(); if ($) $(field).trigger('change.select2');
      } else if (['checkbox', 'radio'].includes(field.type)) field.checked = value;
      else if (field.value !== value) field.value = value;
    }
    function refresh() {
      for (const field of fields()) {
        // 输入草稿不依赖游戏是否已选；提交查询仍由后台自己的规则校验。
        if (field.tagName === 'TEXTAREA' || (field.tagName === 'INPUT' && TEXT_TYPES.has(field.type))) {
          if (field.disabled) field.disabled = false;
        }
        if (field.id === 'form_psid') {
          if (game && !game.includes('|') && !field.disabled && desiredServer != null) write(field, desiredServer);
        } else if (drafts.has(field.id)) write(field, drafts.get(field.id));
      }
    }
    function schedule() {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; refresh(); });
    }
    function afterGameChange() {
      const next = gameKey();
      if (next !== game) {
        game = next;
        if (servers.has(game)) desiredServer = servers.get(game);
      }
      refresh(); schedule();
    }
    // 原生change捕获在页面目标节点处理之前，保存尚未被清空的条件。
    doc.addEventListener('change', event => {
      if (event.target?.id === 'form_gid') capture();
      else remember(event.target);
    }, true);
    doc.addEventListener('input', event => remember(event.target), true);
    doc.addEventListener('change', event => { if (event.target?.id === 'form_gid') afterGameChange(); });
    const beforeGameGesture = event => {
      const select = doc.querySelector('#form_gid'), container = select?.nextElementSibling;
      if (event.target === select || (container?.classList?.contains('select2-container') && container.contains(event.target))) capture();
    };
    doc.addEventListener('pointerdown', beforeGameGesture, true);
    doc.addEventListener('keydown', beforeGameGesture, true);
    doc.addEventListener('reset', event => {
      const owned = fields().filter(field => event.target?.contains?.(field));
      for (const field of owned) {
        drafts.delete(field.id);
        if (field.id === 'form_psid') { servers.clear(); desiredServer = null; }
      }
      queueMicrotask(() => {
        game = gameKey();
        for (const field of owned) remember(field);
        refresh();
      });
    }, true);
    function bind() {
      const $ = getJQuery();
      if (!$ || bound) return;
      const $doc = $(doc);
      $doc.on('select2:selecting.workToolFilterDrafts select2:unselecting.workToolFilterDrafts', '#form_gid', capture);
      $doc.on('change.workToolFilterDrafts', '#form_gid', afterGameChange);
      $doc.on('change.workToolFilterDrafts', FILTERS, event => remember(event.target));
      $doc.on('apply.daterangepicker.workToolFilterDrafts', '#s_rdate', event => remember(event.target));
      bound = true;
    }
    function mutations(records) {
      if (records.some(record => managed(record.target) || [...(record.addedNodes || [])].some(node =>
        managed(node) || node.querySelector?.(FILTERS)))) schedule();
    }
    capture(); bind(); refresh();
    return { bind, refresh, capture, mutations };
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { keepFilterDrafts }; return; }
  if (!/^\/(?:order\/ls|game\/playerinfo)\/?$/.test(location.pathname)) return;
  const drafts = keepFilterDrafts(document, () => root.jQuery);
  const observer = new MutationObserver(drafts.mutations);
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] });
  let tries = 0;
  const timer = setInterval(() => { drafts.bind(); if (root.jQuery || ++tries >= 50) clearInterval(timer); }, 100);
})(globalThis);
