(function(root) {
  'use strict';
  if (!/^\/gadmin\/jsp\/business\/playerLog\.jsp$/.test(location.pathname)) return;
  const core = root.WorkToolPlayerLogExport;
  if (!core) return;
  let active = null, installed = false;
  function install() {
    if (installed) return;
    if (document.getElementById('work-tool-player-log-export')) { installed = true; return; }
    const $ = root.jQuery, search = document.getElementById('searchBnt');
    if (!search || !$?.fn?.datebox || !$?.fn?.combobox || !$?.fn?.textbox || typeof root.playerLogDesc !== 'function') return;
    if (!['strBegin', 'strEnd', 'logType', 'traceType', 'playerId'].every(id => document.getElementById(id))) return;
    // EasyUI methods require the widgets to have finished parsing the page.
    if (!$('#strBegin').data('datebox') || !$('#strEnd').data('datebox') || !$('#logType').data('combobox') || !$('#traceType').data('combobox') || !$('#playerId').data('textbox')) return;
    installed = true;
    const host = document.createElement('span'); host.id = 'work-tool-player-log-export';
    host.style.cssText = 'display:inline-block;margin-left:6px;vertical-align:middle';
    const shadow = host.attachShadow({mode: 'open'});
    shadow.innerHTML = '<style>:host{font:12px Arial,"Microsoft YaHei",sans-serif}button{font:inherit;padding:4px 9px;border:1px solid #aab4c0;border-radius:3px;background:linear-gradient(#fff,#e9eef4);color:#172c46;cursor:pointer}button:disabled{opacity:.55;cursor:default}button+button{margin-left:5px}span{margin-left:7px;white-space:normal}span[data-error]{color:#b42318}</style><button type="button">查询并导出 CSV</button><button type="button" hidden>取消</button><span role="status" aria-live="polite"></span>';
    search.after(host);
    const [start, cancel] = shadow.querySelectorAll('button'), status = shadow.querySelector('span');
    const notify = (text, error = false) => { status.textContent = text; status.toggleAttribute('data-error', error); };
    cancel.addEventListener('click', () => { active?.abort(); notify('正在取消…'); });
    root.addEventListener('pagehide', () => active?.abort());
    let lastPaint = 0;
    start.addEventListener('click', async event => {
      event.preventDefault(); event.stopPropagation();
      if (active) return;
      let writer, response, committed = false;
      const controller = new AbortController(); active = controller;
      start.disabled = true; cancel.hidden = false; lastPaint = 0;
      try {
        if (typeof root.showSaveFilePicker !== 'function') throw Error('当前浏览器不支持流式保存，请使用桌面版 Chrome / Edge 121 或以上版本');
        const read = (id, widget, method = 'getValue') => String($('#' + id)[widget](method) ?? '').trim();
        const params = core.validate({
          playerId: read('playerId', 'textbox'), logType: read('logType', 'combobox'),
          strBegin: read('strBegin', 'datebox'), strEnd: read('strEnd', 'datebox'),
          playerAccount: '', traceTypeId: read('traceType', 'combobox') || '0'
        });
        const desc = root.playerLogDesc(params.logType);
        if (typeof desc !== 'string' || !desc.trim()) throw Error('当前流水类型没有有效表头，无法导出');
        const details = desc.split('|'), headers = ['时间', ...details];
        const traceIndex = details.indexOf(root.traceTypeDesc || '追踪ID'), traceNames = Object.create(null);
        if (traceIndex >= 0) {
          if (!Array.isArray(root.g_allTraceTypes)) throw Error('追踪类型字典未就绪，请刷新页面后重试');
          for (const item of root.g_allTraceTypes) traceNames[item.id] = String(item.name);
        }
        const label = read('logType', 'combobox', 'getText') || params.logType;
        notify('请选择 CSV 保存位置');
        // Keep the picker in the original user gesture, before any awaited work.
        const handle = await root.showSaveFilePicker({suggestedName: core.filename(params, label), types: [{description: 'CSV 表格', accept: {'text/csv': ['.csv']}}]});
        core.checkAbort(controller.signal);
        writer = await handle.createWritable(); core.checkAbort(controller.signal);
        notify('等待后台响应…');
        response = await root.fetch('/gadminc/playerlog/queryLog.json', {
          method: 'POST', credentials: 'same-origin', signal: controller.signal,
          headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json'},
          body: new URLSearchParams(params).toString()
        });
        const result = await core.writeCsv({response, writable: writer, headers, traceIndex, traceNames, signal: controller.signal,
          onProgress: ({rows, bytes}) => {
            const now = performance.now();
            if (now - lastPaint < 200) return;
            lastPaint = now; notify(`已写入 ${rows.toLocaleString()} 条，已接收 ${(bytes / 1048576).toFixed(1)} MB`);
          }
        });
        core.checkAbort(controller.signal);
        // Once closing begins the atomic file commit cannot be cancelled.
        cancel.disabled = true; notify('正在完成文件保存…');
        await writer.close(); committed = true;
        notify(`导出完成：${result.rows.toLocaleString()} 条${result.rows ? '' : '（没有数据，仅保存表头）'}`);
      } catch (error) {
        controller.abort();
        if (error?.name === 'AbortError') notify('已取消导出');
        else notify(`导出失败：${error?.message || '未知错误'}；未完成的文件未提交，请重试`, true);
      } finally {
        if (!committed && writer) await writer.abort().catch(() => {});
        if (!committed && response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
        active = null; start.disabled = false; cancel.hidden = true; cancel.disabled = false;
      }
    });
  }
  install();
  // Poll only widget readiness; never observe or traverse the large results table.
  const timer = setInterval(() => { install(); if (installed) clearInterval(timer); }, 500);
  root.addEventListener('pagehide', () => clearInterval(timer), {once: true});
})(globalThis);
