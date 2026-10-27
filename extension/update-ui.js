(() => {
  'use strict';
  const $ = id => document.getElementById(id), api = WorkToolLocalUpdate, files = WorkToolFiles;
  const current = chrome.runtime.getManifest().version;
  const DIRECTORY = 'local-update-directory', BACKUP = 'local-update-backup';
  let directory, prepared, backup, githubConfig, githubStatus, busy = true, checking = false, packageSequence = 0;
  $('current-version').textContent = current;
  const notice = text => { $('notice').textContent = text; };
  const seconds = ms => (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' 秒';
  function progress(text, done, total, detail) {
    const meter = $('update-progress'); meter.hidden = false;
    if (total) {
      const percent = Math.round(done / total * 100);
      meter.max = 100; meter.value = percent;
      // 写入时 Chrome 会对每个 .js/.html 做安全浏览检查，访问不到 Google 时每个文件要等约 7 秒，这里说明正在等什么。
      const extra = detail ? ` · 已用 ${seconds(detail.elapsed)}` + (detail.active.length ? `\n正在写入：${detail.active.join('、')}（浏览器正在做安全检查，每个文件最多约 7 秒）` : '') : '';
      notice(`${text}：${done}/${total}（${percent}%），请保持本页打开…${extra}`);
    } else { meter.removeAttribute('value'); notice(text); }
  }
  // 上次更新各文件的写入耗时，用于排查安装慢的原因。
  const timingText = timing => `上次更新写入 ${timing.files.length} 个文件，用时 ${seconds(timing.ms)}` +
    (timing.files.length ? `；最慢：${timing.files.slice(0, 3).map(f => `${f.name} ${seconds(f.ms)}`).join('、')}` : '') + '。';
  function display() {
    $('directory-status').textContent = directory ? `已选择：${directory.name}` : '尚未选择';
    $('apply-update').disabled = busy || !directory || !prepared || backup?.state === 'pending';
    for (const id of ['choose-directory','update-zip','restore-update','repair-update']) $(id).disabled = busy;
    for (const id of ['save-github','github-url','github-branch','github-folder','github-use-proxy']) $(id).disabled = busy;
    $('github-check').disabled = busy || !githubConfig || backup?.state === 'pending';
    $('update-recovery').hidden = backup?.state !== 'pending';
    $('github-status').dataset.available = String(!!githubStatus?.available);
    $('github-status').textContent = !githubConfig ? '尚未配置GitHub更新源' : checking ? '正在检查GitHub更新…' : githubStatus?.state === 'error' ? `检查失败：${githubStatus.error}` :
      githubStatus?.available ? `发现新版 ${githubStatus.version}，` + (busy ? '正在处理，请查看下方进度。' : backup?.state === 'pending' ? '请先修复上次更新，再继续安装。' : '点击“检查并更新”即可安装。') : githubStatus?.state === 'current' ? `当前已是最新版本（仓库版本 ${githubStatus.version}）。` : '尚未检查更新';
    $('restore-section').hidden = !backup || backup.state === 'restored';
    $('backup-status').textContent = backup ? `${backup.from} → ${backup.to}` + (backup.state === 'pending' ? ' · 上次更新中断，请先恢复' : ' · 已保留更新前文件') : '';
  }
  async function permission(target = directory) {
    if (!target) throw Error('请先选择扩展安装文件夹');
    if (await target.requestPermission({mode:'readwrite'}) !== 'granted') throw Error('未获得所选扩展目录的写入权限，文件未修改');
  }
  async function chooseDirectory() {
      if (!window.showDirectoryPicker) throw Error('当前浏览器不支持目录授权，请使用新版桌面Chrome或Edge');
      const selected = await window.showDirectoryPicker({id:'work-tool-extension',mode:'readwrite'});
      // 尚有未恢复的备份时不能悄悄改到另一个目录。
      if (backup?.state === 'pending' && directory && !await selected.isSameEntry(directory)) throw Error('上次更新尚未恢复，请先恢复原安装目录');
      await api.checkDirectory(selected, current);
      await files.state(DIRECTORY, selected); directory = selected; display(); notice('已记住安装位置。');
  }
  $('choose-directory').onclick = async () => {
    try { await chooseDirectory(); } catch (error) { if (error.name !== 'AbortError') notice(error.message); }
  };
  async function send(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw Error(result?.error || '扩展连接已失效，请重新打开本页');
    return result;
  }
  $('save-github').onclick = async () => {
    if (busy) return;
    busy = true; display(); notice('正在保存并检查更新源…');
    try {
      const input = {url:$('github-url').value,branch:$('github-branch').value,folder:$('github-folder').value,accelerated:$('github-use-proxy').checked};
      // 先本地验证，避免无效配置覆盖已使用的更新源。
      if (input.url.trim()) {
        WorkToolGithub.config(input);
        if (input.accelerated && !await chrome.permissions.request({origins:['https://update.cnszxyt.com/*']})) throw Error('未授权加速域名，更新源未修改');
      }
      const result = await send({type:'updates:configure',config:input});
      githubConfig = input.url.trim() ? WorkToolGithub.config(input) : null; githubStatus = result.status;
      notice(githubStatus?.state === 'error' ? githubStatus.error : githubConfig ? '更新源已保存，之后会定时检查。' : '已停用GitHub更新检查。');
    } catch (error) { notice(error.message); }
    finally { busy = false; display(); }
  };
  async function install(next) {
    progress('正在比较并备份需要更新的文件…');
    // 等待安全检查时没有新的进度事件，每秒刷新一次已用时间，避免看起来卡住。
    let last = null;
    const ticker = setInterval(() => { if (last) progress('正在安装', last.done, last.total, {...last.detail, elapsed: last.detail.elapsed + Date.now() - last.at}); }, 1000);
    let result;
    try {
      result = await api.apply(directory, next, current, async value => { const saved = {...value, directory}; await files.state(BACKUP, saved); backup = saved; },
        (done, total, detail) => { last = {done, total, detail, at: Date.now()}; progress('正在安装',done,total,detail); });
    } finally { clearInterval(ticker); }
    notice(`已安装 ${result.version}（更新 ${result.files} 个文件，用时 ${seconds(result.timing.ms)}），正在重新加载扩展。请刷新后台页面。`);
    chrome.runtime.reload();
  }
  $('github-check').onclick = async () => {
    if (busy || !githubConfig || backup?.state === 'pending') return;
    busy = true; display();
    try {
      progress('正在确认安装目录权限…');
      // 目录授权在用户点击时完成，避免网络等待后丢失浏览器的用户手势。
      if (!directory) await chooseDirectory();
      await permission(); progress('正在检查GitHub更新…');
      // 页面打开时显示的是上次定时检查的结果；本次结果一到就刷新，不能在安装过程中继续显示旧的“已是最新”。
      checking = true; display();
      try { githubStatus = (await send({type:'updates:check'})).status; } finally { checking = false; display(); }
      if (githubStatus?.state === 'error') throw Error(githubStatus.error);
      if (!githubStatus?.available) { $('update-progress').hidden = true; notice('当前已是最新版本。'); return; }
      progress(`正在比较本地文件，准备下载 ${githubStatus.version}…`);
      const next = await WorkToolGithub.download(githubStatus, current, {installed:name=>api.read(directory,name),
        onProgress:(done,total,skipped)=>progress(`正在下载 ${githubStatus.version}${skipped?`（${skipped} 个文件未变化，无需下载）`:''}`,done,total)});
      await install(next);
    } catch (error) { $('update-progress').hidden = true; notice(error.name === 'AbortError' ? '已取消更新。' : error.message); }
    finally { busy = false; display(); }
  };
  $('update-zip').onchange = async () => {
    const sequence = ++packageSequence;
    prepared = null; display();
    try {
      const selected = $('update-zip').files[0]; if (!selected) return;
      if (selected.size > 5 * 1024 * 1024) throw Error('安装包过大（上限5MB）');
      const bytes = await selected.arrayBuffer();
      if (sequence !== packageSequence) return;
      prepared = api.prepare(bytes, current);
      $('package-status').textContent = `可更新：${current} → ${prepared.version}（${prepared.files.size} 个文件）`;
      notice('点击“安装更新”后写入已授权的扩展目录。');
    } catch (error) { $('package-status').textContent = '安装包不可用'; notice(error.message); }
    display();
  };
  $('apply-update').onclick = async () => {
    if (busy || !prepared || backup?.state === 'pending') return;
    busy = true; display();
    try {
      await permission();
      await install(prepared);
    } catch (error) { $('update-progress').hidden = true; notice(error.message); }
    finally { busy = false; display(); }
  };
  $('restore-update').onclick = async () => {
    if (busy || !backup) return;
    busy = true; display();
    try {
      const target = backup.directory || directory;
      await permission(target); await api.restore(target, backup);
      backup = {...backup, state:'restored'}; await files.state(BACKUP, backup);
      notice('已恢复更新前文件，正在重新加载扩展。请刷新后台页面。');
      chrome.runtime.reload();
    } catch (error) { notice(error.message); }
    finally { busy = false; display(); }
  };
  $('repair-update').onclick = async () => {
    if (busy || backup?.state !== 'pending') return;
    busy = true; display(); notice('正在核对上次更新的文件…');
    try {
      const target = backup.directory || directory;
      await permission(target);
      let state = await api.inspectBackup(target, backup);
      if (state === 'pending') { await api.restore(target, backup); state = 'restored'; }
      backup = {...backup,state}; await files.state(BACKUP,backup);
      if (state === 'applied') {
        notice('上次更新的文件已完整安装，已修复完成记录。正在重新加载扩展，请刷新后台页面。');
        chrome.runtime.reload();
      } else {
        notice('已恢复更新前文件并解除锁定。请重新打开本页，再点击“检查并更新”。');
        chrome.runtime.reload();
      }
    } catch (error) { notice(`修复未完成：${error.message}。原备份已保留。`); }
    finally { busy = false; display(); }
  };
  (async () => {
    try {
      [directory, backup] = await Promise.all([files.state(DIRECTORY), files.state(BACKUP)]);
      const result = await send({type:'updates:get'}); githubConfig = result.config; githubStatus = result.status;
      if (githubConfig) { $('github-url').value = githubConfig.url; $('github-branch').value = githubConfig.branch === 'HEAD' ? '' : githubConfig.branch; $('github-folder').value = githubConfig.folder;
        $('github-use-proxy').checked = !!githubConfig.accelerated; }
      // manifest落盘时页面可能被浏览器重载，导致最后的完成记录尚未提交。
      // 已有权限且全部文件与正在运行的版本一致时，仅补齐记录，不改安装文件。
      const target = backup?.directory || directory;
      if (backup?.state === 'pending' && target?.queryPermission && await target.queryPermission({mode:'readwrite'}) === 'granted') {
        try {
          const state = await api.inspectBackup(target,backup);
          if ((state === 'applied' && backup.to === current) || (state === 'restored' && backup.from === current)) {
            backup = {...backup,state}; await files.state(BACKUP,backup);
            notice(state === 'applied' ? '已核对上次更新文件完整，更新完成记录已修复。' : '已核对安装文件仍为原版本，可以重新检查更新。');
          }
        } catch (error) { notice(`上次更新需要修复：${error.message}。原备份已保留。`); }
      }
      if (!$('notice').textContent && backup?.state === 'applied' && backup.to === current && backup.timing) notice(timingText(backup.timing));
      display();
    }
    catch (error) { notice(error.message); }
    finally { busy = false; display(); }
  })();
  display();
})();
