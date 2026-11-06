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
  if (!/^\/(?:order\/ls|game\/playerinfo)\/?$/.test(location.pathname)) return;

  const enhancedPickers = new WeakSet();

  // Select2 的 dataAdapter.current 用 $element.find(':selected') 过滤全部 <option>，
  // results.setClasses() 每次检索后都会调用它：选项一多，单次按键就要几十毫秒。
  // 这里改用浏览器原生的 selectedOptions，只遍历真正选中的那几个。
  function fastCurrent(adapter) {
    if (adapter.__workToolFastCurrent) return;
    const base = adapter.current;
    adapter.current = function (callback) {
      const select = this.$element?.[0];
      const chosen = select?.tagName === 'SELECT' && select.multiple && typeof this.item === 'function'
        ? select.selectedOptions : null;
      if (!chosen) return base.call(this, callback);
      const items = [];
      for (let i = 0; i < chosen.length; i++) items.push(this.item(root.jQuery(chosen[i])));
      callback(items);
    };
    adapter.__workToolFastCurrent = true;
  }

  // 中文输入法组词期间不检索，上屏后再让 Select2 查。
  // 不用任何“正在组词”的持久标志：只看浏览器给每个事件带的 isComposing，
  // 因此哪怕输入法漏发 compositionend，也不会把后续输入永久吞掉。
  function waitForChineseInput(picker, search) {
    let lastQuery = '';
    let commitTimer;
    picker.on('query', params => { lastQuery = params?.term ?? ''; });
    search.addEventListener('input', event => {
      // 组词中的 input 不交给 Select2，浏览器仍会把拼音显示在输入框。
      if (event.isComposing) event.stopPropagation();
      else clearTimeout(commitTimer);
    }, true);
    for (const type of ['keydown', 'keyup']) {
      search.addEventListener(type, event => {
        if (event.isComposing || event.keyCode === 229) event.stopPropagation();
      }, true);
    }
    search.addEventListener('compositionend', () => {
      clearTimeout(commitTimer);
      // 等原生 input 先走一遍；若 Select2 没收到这次上屏，再用当前词补一次查询。
      commitTimer = setTimeout(() => {
        commitTimer = undefined;
        if (document.activeElement !== search) return;
        const term = search.value;
        if (term === lastQuery) return;
        search.dispatchEvent(new Event('input', { bubbles: true }));
        // 个别输入法/时序下 Select2 会整条跳过这次 input，再用当前词直接补一次查询。
        if (lastQuery !== term) picker.trigger('query', { term });
      }, 0);
    });
    search.addEventListener('blur', () => clearTimeout(commitTimer));
  }

  // 本地结果按原顺序分批渲染。继续滚动能看到全部选项，远程下拉沿用自身分页。
  function pageResults(picker) {
    const results = picker.results;
    const list = results?.$results?.[0];
    if (!list || typeof results.sort !== 'function' || typeof results.clear !== 'function' ||
        !picker.options?.get || picker.options.get('ajax')) return;
    const select = picker.$element?.[0];
    // 有 optgroup 时结果带层级，交给 Select2 原本的逻辑。
    if (select?.querySelector?.('optgroup')) return;
    const pageSize = 80;
    const baseSort = results.sort;
    const baseClear = results.clear;
    let pending, offset, appending = false, growthQueued = false;
    results.sort = function (items) {
      if (appending) return items;
      const sorted = baseSort.call(this, items);
      if (sorted.length > pageSize) {
        pending = sorted; offset = pageSize; return sorted.slice(0, pageSize);
      }
      pending = undefined; offset = 0; return sorted;
    };
    results.clear = function () {
      pending = undefined; offset = 0; baseClear.call(this);
    };
    picker.on('close', () => { pending = undefined; offset = 0; });
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
    // 自定义模板可能把前一批候选藏起来：下一帧再补，最多补几页，避免同步循环反复触发排版。
    picker.on('results:all', () => {
      if (!pending || growthQueued) return;
      growthQueued = true;
      requestAnimationFrame(() => {
        growthQueued = false;
        for (let i = 0; i < 6 && pending && picker.isOpen() && list.scrollHeight <= list.clientHeight; i++) appendPage();
      });
    });
  }

  function enhanceGamePicker() {
    const select = document.getElementById('form_gid');
    const picker = select && root.jQuery?.(select).data('select2');
    if (!picker || enhancedPickers.has(picker)) return;
    enhancedPickers.add(picker);
    const adapter = picker.dataAdapter;
    if (adapter) fastCurrent(adapter);
    const search = picker.selection?.$search?.[0] || picker.dropdown?.$search?.[0];
    if (search) waitForChineseInput(picker, search);
    pageResults(picker);
  }
  enhanceGamePicker();
  // 后台重建控件时，在 Select2 处理点击或聚焦前接入新实例。
  for (const type of ['pointerdown', 'focusin']) {
    document.addEventListener(type, event => {
      const box = event.target.closest?.('.select2-container');
      if (box?.previousElementSibling?.id === 'form_gid') enhanceGamePicker();
    }, true);
  }

  // 点右侧叉号清空后，Select2 会重绘选择区，焦点可能掉到 body。
  // 只在焦点确实丢了的时候补一次（用户已经点到别处就不抢焦点），并多试一帧。
  document.addEventListener('mousedown', event => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const clear = event.target.closest('.select2-selection__clear');
    if (!clear) return;
    const select = document.getElementById('form_gid');
    const box = select?.nextElementSibling;
    if (!select?.multiple || select.disabled || !select.value ||
        !box?.matches('.select2-container') || !box.contains(clear)) return;
    const before = document.activeElement;
    const restore = () => {
      const current = document.getElementById('form_gid');
      const container = current?.nextElementSibling;
      if (!current?.multiple || current.disabled || !container?.matches('.select2-container')) return;
      // 没真正清空（例如页面二次确认后取消了）就不动焦点。
      if (current.value) return;
      const active = document.activeElement;
      // 用户已经在别的控件里输入时不打扰，只在焦点确实丢了时补。
      if (active && active !== document.body && active !== document.documentElement && !container.contains(active)) return;
      const field = container.querySelector('.select2-search__field');
      if (field && document.activeElement !== field) field.focus({ preventScroll: true });
    };
    setTimeout(restore, 0);
    setTimeout(restore, 80);
  }, true);

  if (!/^\/order\/ls\/?$/.test(location.pathname)) return;

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
