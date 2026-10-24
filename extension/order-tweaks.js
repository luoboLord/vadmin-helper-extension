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
