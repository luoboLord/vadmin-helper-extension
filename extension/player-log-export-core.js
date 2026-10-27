(function(root) {
  'use strict';
  const SLICE = 64 * 1024, RECORD_LIMIT = 8 * 1024 * 1024, BATCH = 256 * 1024;
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  const whitespace = c => c === ' ' || c === '\r' || c === '\n' || c === '\t';
  function checkAbort(signal) { if (signal?.aborted) throw new DOMException('已取消导出', 'AbortError'); }
  function businessError(value) {
    if (value?.success === true) return Error('此功能未开放');
    const message = String(value?.msg || value?.message || '后台未返回日志数组').slice(0, 500);
    return Error(`后台查询失败：${message}${value?.code != null ? `（代码 ${String(value.code).slice(0, 50)}）` : ''}`);
  }
  async function* textChunks(body, {signal, onBytes = () => {}, yieldTask = pause} = {}) {
    if (!body?.getReader) throw Error('浏览器未提供响应流，无法安全导出大文件');
    const reader = body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true});
    let ended = false, bytes = 0;
    const cancel = () => { reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', cancel, {once: true});
    try {
      while (true) {
        checkAbort(signal);
        const {value, done} = await reader.read();
        checkAbort(signal);
        if (done) { ended = true; const tail = decoder.decode(); if (tail) yield tail; return; }
        for (let offset = 0; offset < value.length; offset += SLICE) {
          checkAbort(signal);
          const chunk = value.subarray(offset, offset + SLICE);
          bytes += chunk.length; onBytes(bytes);
          const text = decoder.decode(chunk, {stream: true});
          if (text) yield text;
          await yieldTask();
        }
      }
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (!ended) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  // Only one array member is buffered. JSON.parse handles that member's escapes
  // and nested values, never the complete response. Delimiters are validated too.
  async function* records(body, options = {}) {
    let state = 'start', parts = [], length = 0, depth = 0, quoted = false, escaped = false, errorObject = false;
    for await (const text of textChunks(body, options)) {
      let start = state === 'record' ? 0 : -1;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (state === 'record') {
          if (++length > (errorObject ? SLICE : RECORD_LIMIT)) throw Error('单条日志或错误响应过大，已停止导出');
          if (quoted) {
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') quoted = false;
          } else if (c === '"') quoted = true;
          else if (c === '{' || c === '[') depth++;
          else if (c === '}' || c === ']') depth--;
          if (depth === 0) {
            parts.push(text.slice(start, i + 1)); start = -1;
            let value;
            try { value = JSON.parse(parts.join('')); }
            catch { throw Error('日志 JSON 格式错误，已停止导出'); }
            parts = []; length = 0;
            if (errorObject) throw businessError(value);
            if (!value || typeof value.opTime !== 'string' || typeof value.detail !== 'string') throw Error('日志缺少有效的 opTime 或 detail 字段');
            state = 'after';
            yield value;
          }
          continue;
        }
        if (whitespace(c)) continue;
        if (state === 'start') {
          if (c === '[') { state = 'first'; continue; }
          if (c !== '{') throw Error('后台未返回日志 JSON，可能登录已失效，请重新登录');
          errorObject = true;
        } else if (state === 'first' && c === ']') { state = 'done'; continue; }
        else if (state === 'after') {
          if (c === ',') { state = 'next'; continue; }
          if (c === ']') { state = 'done'; continue; }
          throw Error('日志数组分隔符错误');
        } else if (state === 'done') throw Error('日志数组后出现额外内容');
        if (c !== '{') throw Error('日志数组包含无效记录');
        state = 'record'; start = i; length = 1; depth = 1; quoted = false; escaped = false;
      }
      if (state === 'record' && start >= 0) parts.push(text.slice(start));
    }
    if (state !== 'done') throw Error('日志响应不完整或已截断，请缩短时间范围后重试');
  }
  function cell(value) {
    const text = String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }
  const line = values => values.map(cell).join(',') + '\r\n';
  async function writeCsv({response, writable, headers, signal, traceIndex = -1, traceNames = {}, onProgress = () => {}, yieldTask}) {
    checkAbort(signal);
    if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? '登录已失效或无查询权限，请重新登录' : `查询失败：HTTP ${response.status}`);
    if (response.redirected || /text\/html/i.test(response.headers.get('content-type') || '')) throw Error('查询返回了网页，可能登录已失效，请重新登录');
    if (!Array.isArray(headers) || headers.length < 2) throw Error('无法取得当前流水类型的表头');
    let rows = 0, bytes = 0, pending = [], size = 0, bufferedRows = 0, maxBufferedChars = 0;
    const progress = () => onProgress({rows, bytes});
    const flush = async () => {
      if (!pending.length) return;
      checkAbort(signal);
      await writable.write(pending.join(''));
      rows += bufferedRows; pending = []; size = 0; bufferedRows = 0;
      checkAbort(signal); progress();
    };
    await writable.write('\uFEFF' + line(headers));
    for await (const record of records(response.body, {signal, yieldTask, onBytes: n => { bytes = n; progress(); }})) {
      checkAbort(signal);
      const details = record.detail.split('|');
      if (details.length !== headers.length - 1) throw Error(`第 ${rows + bufferedRows + 1} 条日志列数与表头不一致，已停止导出`);
      if (traceIndex >= 0) {
        const id = details[traceIndex];
        details[traceIndex] = `${Object.hasOwn(traceNames, id) ? traceNames[id] : '未知'}[${id}]`;
      }
      const csv = line([record.opTime, ...details]);
      pending.push(csv); size += csv.length; bufferedRows++;
      maxBufferedChars = Math.max(maxBufferedChars, size);
      if (size >= BATCH || bufferedRows >= 500) await flush();
    }
    await flush(); checkAbort(signal);
    return {rows, bytes, maxBufferedChars};
  }
  function validate(params) {
    for (const key of ['strBegin', 'strEnd']) {
      const value = params[key];
      const date = new Date(value + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw Error('请选择有效的起始和结束日期');
    }
    if (params.strBegin > params.strEnd) throw Error('起始日期不能晚于结束日期');
    if (!params.logType) throw Error('请选择流水类型');
    if (!/^\d{5,10}$/.test(params.playerId)) throw Error('请输入正确的角色ID（5至10位数字）');
    return params;
  }
  const filename = (params, label) => `玩家日志_${params.playerId}_${label}_${params.strBegin}_${params.strEnd}.csv`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180).replace(/(?:\.csv)?$/, '.csv');
  const api = {records, writeCsv, validate, filename, cell, checkAbort};
  root.WorkToolPlayerLogExport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
