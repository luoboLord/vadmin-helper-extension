(function(root) {
  'use strict';
  const NAME = '客服链接助手 · 游戏联动';
  const decoder = new TextDecoder();
  function version(value) {
    if (!/^\d+(?:\.\d+){0,3}$/.test(String(value))) throw Error('安装包版本号无效');
    const parts = String(value).split('.').map(Number);
    if (parts.some(n => n > 65535)) throw Error('安装包版本号无效');
    return Array.from({length:4}, (_, i) => parts[i] || 0);
  }
  function compare(a, b) {
    const left = version(a), right = version(b);
    for (let i = 0; i < 4; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
    return 0;
  }
  function path(value) {
    if (!value || value.length > 220 || /[\\:\x00-\x1f<>"|?*]/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(p))) throw Error('安装包包含无效文件路径');
    return value;
  }
  function manifest(bytes) {
    let item;
    try { item = JSON.parse(decoder.decode(bytes)); } catch { throw Error('安装包manifest.json格式错误'); }
    if (item.name !== NAME || item.manifest_version !== 3) throw Error('这不是客服链接助手的安装包');
    version(item.version);
    return item;
  }
  function prepare(bytes, currentVersion) {
    if (bytes.byteLength > 5 * 1024 * 1024) throw Error('安装包过大（上限5MB）');
    let count = 0, size = 0;
    const archiveNames = new Set();
    const archive = root.fflate.unzipSync(new Uint8Array(bytes), {filter(entry) {
      if (entry.name.endsWith('/')) return false;
      path(entry.name);
      const key = entry.name.toLowerCase();
      if (archiveNames.has(key)) throw Error('安装包有重复文件路径');
      archiveNames.add(key);
      count++; size += entry.originalSize;
      if (count > 250 || size > 20 * 1024 * 1024 || entry.originalSize > 10 * 1024 * 1024) throw Error('安装包解压大小或文件数量超限');
      return true;
    }});
    const candidates = Object.keys(archive).filter(p => p === 'manifest.json' || /^[^/]+\/manifest\.json$/.test(p));
    if (candidates.length !== 1) throw Error('安装包必须包含唯一的扩展manifest.json');
    const prefix = candidates[0].slice(0, -'manifest.json'.length), files = new Map(), seen = new Set();
    for (const [name, data] of Object.entries(archive)) {
      if (!name.startsWith(prefix)) throw Error('安装包包含扩展目录以外的文件');
      const relative = path(name.slice(prefix.length)), key = relative.toLowerCase();
      if (seen.has(key)) throw Error('安装包有重复文件路径');
      seen.add(key); files.set(relative, data);
    }
    return prepareFiles(files, currentVersion);
  }
  function prepareFiles(files, currentVersion) {
    if (!(files instanceof Map) || !files.size || files.size > 250) throw Error('更新文件数量无效');
    let total = 0;
    const seen = new Set();
    for (const [name, bytes] of files) {
      const key = path(name).toLowerCase();
      if (seen.has(key)) throw Error('更新文件路径重复');
      seen.add(key);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > 10 * 1024 * 1024) throw Error('更新文件大小无效');
      total += bytes.byteLength;
    }
    if (total > 20 * 1024 * 1024) throw Error('更新文件总大小超限');
    const next = manifest(files.get('manifest.json'));
    if (compare(next.version, currentVersion) <= 0) throw Error(`请选择高于当前 ${currentVersion} 的新版安装包`);
    const required = ['background.js', 'manager.html', 'manager.js', 'core.js', 'content.js', 'data.js'];
    if (next.background?.service_worker) required.push(next.background.service_worker);
    if (next.options_page) required.push(next.options_page);
    for (const script of next.content_scripts || []) required.push(...(script.js || []), ...(script.css || []));
    for (const resource of required) if (!files.has(path(resource))) throw Error(`安装包缺少文件：${resource}`);
    return {version: next.version, files};
  }
  async function file(directory, name, create = false) {
    const parts = path(name).split('/');
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, {create});
    return directory.getFileHandle(parts.at(-1), {create});
  }
  async function read(directory, name) {
    try { return new Uint8Array(await (await (await file(directory, name)).getFile()).arrayBuffer()); }
    catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
  }
  async function write(directory, name, bytes) {
    const stream = await (await file(directory, name, true)).createWritable();
    try { await stream.write(bytes); await stream.close(); }
    catch (error) { await stream.abort().catch(() => {}); throw error; }
  }
  const same = (a, b) => a === null || b === null ? a === b : a?.length === b?.length && a.every((v, i) => v === b[i]);
  async function checkDirectory(directory, currentVersion) {
    const bytes = await read(directory, 'manifest.json');
    if (!bytes) throw Error('请选择当前已加载的扩展文件夹，文件夹中应直接包含manifest.json');
    const installed = manifest(bytes);
    if (installed.version !== currentVersion) throw Error(`所选文件夹版本为 ${installed.version}，当前运行版本为 ${currentVersion}，请确认选的是已加载目录`);
    return installed;
  }
  async function remove(directory, name) {
    const parts = path(name).split('/');
    try {
      for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
      await directory.removeEntry(parts.at(-1));
    } catch (error) { if (error.name !== 'NotFoundError') throw error; }
  }
  async function restore(directory, backup) {
    // manifest最后恢复；仅处理更新前已备份的文件，不递归删除目录。
    const entries = backup.entries.slice().sort((a, b) => (a.name === 'manifest.json') - (b.name === 'manifest.json'));
    for (const entry of entries) {
      const current = await read(directory, entry.name);
      if (same(current, entry.before)) continue;
      // 新建文件在打开写流后失败时可能留下空文件，仍属于本次更新可恢复的范围。
      if (!same(current, entry.after) && !(entry.before === null && current?.length === 0)) throw Error(`文件已被其他程序修改，未覆盖：${entry.name}`);
      if (entry.before === null) await remove(directory, entry.name);
      else await write(directory, entry.name, entry.before);
    }
    for (const entry of entries) if (!same(await read(directory, entry.name), entry.before)) throw Error('恢复校验失败，请保留备份并重试');
  }
  async function apply(directory, prepared, currentVersion, saveBackup, progress = () => {}) {
    await checkDirectory(directory, currentVersion);
    const entries = [];
    for (const [name, bytes] of prepared.files) entries.push({name, before: await read(directory, name), after: bytes});
    entries.sort((a, b) => (a.name === 'manifest.json') - (b.name === 'manifest.json'));
    const backup = {entries, from:currentVersion, to:prepared.version, state:'pending', createdAt:Date.now()};
    await saveBackup(backup); // 备份写入成功后才能改安装文件。
    try {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!same(await read(directory, entry.name), entry.before)) throw Error('扩展目录被其他程序修改，请重试');
        progress(i + 1, entries.length);
        await write(directory, entry.name, entry.after);
        if (!same(await read(directory, entry.name), entry.after)) throw Error(`写入校验失败：${entry.name}`);
      }
      await saveBackup({...backup, state:'applied'});
      return {version:prepared.version, files:entries.length};
    } catch (error) {
      // 保留持久备份；即使权限中断导致回退失败，重新打开仍可恢复。
      try { await restore(directory, backup); await saveBackup({...backup, state:'restored'}); }
      catch (rollback) { throw Error(`更新中断：${error.message}；自动恢复未完成：${rollback.message}。请点击“恢复更新前文件”`); }
      throw Error(`更新失败，已恢复原文件：${error.message}`);
    }
  }
  root.WorkToolLocalUpdate = {prepare, prepareFiles, manifest, path, compare, checkDirectory, apply, restore};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.WorkToolLocalUpdate;
})(globalThis);
