(function (root) {
  'use strict';
  // 左边日历只改开始日，右边只改结束日；越过另一端时两端合并为同一天。
  function nextRange(side, date, start, end) {
    if (side === 'left') {
      start = date.clone().startOf('day');
      if (start.isAfter(end)) end = date.clone().endOf('day');
    } else {
      end = date.clone().endOf('day');
      if (end.isBefore(start)) start = date.clone().startOf('day');
    }
    return { start, end };
  }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { nextRange }; return; }
  if (!/^\/order\/ls\/?$/.test(location.pathname)) return;

  const enhancedPickers = new WeakSet();
  function enhanceGamePicker() {
    const select = document.getElementById('form_gid');
    const $ = root.jQuery;
    const picker = $ && select?.multiple && $(select).data('select2');
    const search = picker?.selection?.$search?.[0];
    if (!search || enhancedPickers.has(picker)) return;
    enhancedPickers.add(picker);

    // 拼音组词期间保留浏览器输入法行为，等上屏后再让 Select2 处理 input。
    let composing = false;
    let commitTimer;
    search.addEventListener('compositionstart', () => {
      clearTimeout(commitTimer);
      commitTimer = undefined;
      composing = true;
    });
    search.addEventListener('compositionend', () => {
      composing = false;
      // 有些输入法在 compositionend 之前发送最后一个 input，需要补查一次。
      commitTimer = setTimeout(() => {
        commitTimer = undefined;
        if (document.activeElement === search) search.dispatchEvent(new Event('input', { bubbles: true }));
      }, 0);
    });
    search.addEventListener('input', event => {
      if (composing || event.isComposing) { event.stopPropagation(); return; }
      clearTimeout(commitTimer);
      commitTimer = undefined;
    });
    for (const type of ['keydown', 'keyup']) {
      search.addEventListener(type, event => {
        if (composing || event.isComposing || event.keyCode === 229 ||
            (type === 'keyup' && commitTimer !== undefined)) event.stopPropagation();
      });
    }

    // 本地结果按原顺序分批渲染。继续滚动能看到全部选项，远程下拉沿用自身分页。
    const results = picker.results;
    const list = results?.$results?.[0];
    if (!list || typeof results.sort !== 'function' || typeof results.clear !== 'function' ||
        !picker.options?.get || picker.options.get('ajax')) return;
    const pageSize = 80;
    const sort = results.sort;
    const clear = results.clear;
    let pending;
    let offset;
    let appending = false;
    results.sort = function (items) {
      if (appending) return items;
      const sorted = sort.call(this, items);
      pending = sorted.length > pageSize && sorted.every(item => !item.children) ? sorted : undefined;
      offset = pageSize;
      return pending ? sorted.slice(0, offset) : sorted;
    };
    results.clear = function () {
      pending = undefined;
      clear.call(this);
    };
    picker.on('close', () => { pending = undefined; });
    function appendPage() {
      if (!pending || !picker.isOpen()) return;
      const items = pending.slice(offset, offset + pageSize);
      offset += items.length;
      if (offset >= pending.length) pending = undefined;
      appending = true;
      try { picker.trigger('results:append', { data: { results: items } }); }
      finally { appending = false; }
    }
    list.addEventListener('scroll', () => {
      if (pending && list.scrollHeight - list.scrollTop - list.clientHeight < 48) appendPage();
    }, { passive: true });
    // 如果自定义模板隐藏了前一批候选，补到列表可滚动或结果已全部显示。
    picker.on('results:all', () => {
      while (pending && picker.isOpen() && list.scrollHeight <= list.clientHeight) appendPage();
    });
  }
  enhanceGamePicker();
  // 后台重建控件时，在 Select2 处理点击或聚焦前接入新实例。
  for (const type of ['pointerdown', 'focusin']) {
    document.addEventListener(type, event => {
      const box = event.target.closest?.('.select2-container');
      if (box?.previousElementSibling?.id === 'form_gid') enhanceGamePicker();
    }, true);
  }

  // Select2 在 mousedown 清空并重绘选择区。等本次联动结束，再聚焦当前的搜索框。
  document.addEventListener('mousedown', event => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const clear = event.target.closest('.select2-selection__clear');
    if (!clear) return;
    const select = document.getElementById('form_gid');
    const container = select?.nextElementSibling;
    if (!select?.multiple || select.disabled || !select.value ||
        !container?.matches('.select2-container') || !container.contains(clear)) return;
    const previousFocus = document.activeElement;
    setTimeout(() => {
      const current = document.getElementById('form_gid');
      const box = current?.nextElementSibling;
      if (!current?.multiple || current.disabled || !box?.matches('.select2-container')) return;
      if (Array.from(current.selectedOptions).some(option => option.value && !['0', '-1'].includes(option.value))) return;
      const active = document.activeElement;
      if (active !== document.body && active !== previousFocus && !box.contains(active)) return;
      // 聚焦搜索框的同时显式打开下拉列表，否则 Select2 在 dropdown 未打开时会忽略
      // input 事件，导致叉掉游戏后立即键入的文字不触发检索。
      const searchField = box.querySelector('.select2-search__field');
      if (!searchField) return;
      const $current = root.jQuery?.(current);
      const s2 = $current?.data('select2');
      if (s2 && !s2.isOpen()) {
        $current.trigger('select2:open');
      }
      searchField.focus({ preventScroll: true });
    }, 0);
  }, true);

  // 复用查询按钮，保留页面原有的校验和查询逻辑，避免原生表单重复提交。
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (!(target instanceof Element) ||
        target.closest('textarea, select, button, a, [data-work-tool-role-copy], [contenteditable]:not([contenteditable="false"]), [role="combobox"], .select2-container, .select2-dropdown, .daterangepicker')) return;
    const button = document.querySelector('#form_search');
    const form = button && button.closest('form');
    if (!form || (!form.contains(target) && target !== document.body && target !== document.documentElement)) return;
    if (button.disabled || !button.getClientRects().length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    // 先提交输入框的 change/blur，日期等筛选值也会同步后再查询。
    if (target instanceof HTMLInputElement) target.blur();
    // 程序 click 不会触发插件监听的外部 mousedown，需显式关闭日期弹层。
    const $ = root.jQuery;
    if ($) {
      for (const input of form.querySelectorAll('input')) {
        const picker = $(input).data('daterangepicker');
        if (picker && picker.isShowing) picker.hide();
      }
    }
    button.click();
  }, true);

  // 运行在页面 MAIN world，才能拿到页面自己的 jQuery、Select2 和 daterangepicker 1.3 实例。
  let tries = 0;
  const waitStatus = setInterval(() => {
    const $ = root.jQuery;
    const select = $ && $('#form_notify_stat');
    if (select && select.length && select.data('select2')) {
      clearInterval(waitStatus);
      // 只设置一次初始值；用户之后改成其他状态不再干预。
      if (select.val() === '-1') select.val('1').trigger('change');
    } else if (++tries > 50) clearInterval(waitStatus);
  }, 100);

  function pickerOf(node) {
    const $ = root.jQuery;
    if (!$) return null;
    for (const input of document.querySelectorAll('input')) {
      const picker = $(input).data('daterangepicker');
      if (picker && picker.container[0].contains(node)) return picker;
    }
    return null;
  }
  function apply(picker) {
    picker.updateInputText();
    // 同步旧值，之后点外部收起时不会再按“未应用”处理。
    picker.oldStartDate = picker.startDate.clone();
    picker.oldEndDate = picker.endDate.clone();
    picker.element.trigger('apply.daterangepicker', picker);
  }

  // 捕获阶段先于插件的委托事件执行，替换原生 clickDate；日历保持打开，可继续点另一边。
  document.addEventListener('click', event => {
    const cell = event.target instanceof Element && event.target.closest('.daterangepicker .calendar td.available');
    if (!cell) return;
    const picker = pickerOf(cell);
    const match = /^r(\d)c(\d)$/.exec(cell.getAttribute('data-title') || '');
    const side = cell.closest('.calendar.left') ? 'left' : cell.closest('.calendar.right') ? 'right' : null;
    if (!picker || !match || !side || picker.singleDatePicker || picker.timePicker) return;
    const date = picker[side + 'Calendar'].calendar[match[1]][match[2]];
    if (!date) return;
    event.stopPropagation();
    const range = nextRange(side, date, picker.startDate, picker.endDate);
    picker.startDate = range.start;
    picker.endDate = range.end;
    picker.chosenLabel = picker.locale.customRangeLabel;
    picker.updateView();
    picker.updateCalendars();
    apply(picker);
  }, true);
})(globalThis);
