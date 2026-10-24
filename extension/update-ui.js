(() => {
  'use strict';
  const $ = id => document.getElementById(id), api = WorkToolLocalUpdate, files = WorkToolFiles;
  const current = chrome.runtime.getManifest().version;
  const DIRECTORY = 'local-update-directory', BACKUP = 'local-update-backup';
  let directory, prepared, backup, githubConfig, githubStatus, busy = true, packageSequence = 0;
  $('current-version').textContent = current;
  const notice = text => { $('notice').textContent = text; };
  function display() {
    $('directory-status').textContent = directory ? `已选择：${directory.name}` : '尚未选择';
    $('apply-update').disabled = busy || !directory || !prepared || backup?.state === 'pending';
    for (const id of ['choose-directory','update-zip','restore-update']) $(id).disabled = busy;
    for (const id of ['save-github','github-url','github-branch','github-folder']) $(id).disabled = busy;
    $('github-check').disabled = busy || !githubConfig || backup?.state === 'pending';
    $('github-status').dataset.available = String(!!githubStatus?.available);
    $('github-status').textContent = !githubConfig ? '尚未配置GitHub更新源' : githubStatus?.state === 'error' ? `检查失败：${githubStatus.error}` :
      githubStatus?.available ? `发现新版 ${githubStatus.version}，点击“检查并更新”即可安装。` : githubStatus?.state === 'current' ? `当前已是最新版本（仓库版本 ${githubStatus.version}）。` : '尚未检查更新';
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
      const input = {url:$('github-url').value,branch:$('github-branch').value,folder:$('github-folder').value};
      // 先本地验证，避免无效配置覆盖已使用的更新源。
      if (input.url.trim()) WorkToolGithub.config(input);
      const result = await send({type:'updates:configure',config:input});
      githubConfig = input.url.trim() ? WorkToolGithub.config(input) : null; githubStatus = result.status;
      notice(githubStatus?.state === 'error' ? githubStatus.error : githubConfig ? '更新源已保存，之后会定时检查。' : '已停用GitHub更新检查。');
    } catch (error) { notice(error.message); }
    finally { busy = false; display(); }
  };
  async function install(next) {
    const result = await api.apply(directory, next, current, async value => { const saved = {...value, directory}; await files.state(BACKUP, saved); backup = saved; },
      (done, total) => notice(`正在安装：${done}/${total}，请保持本页打开…`));
    notice(`已安装 ${result.version}，正在重新加载扩展。请刷新后台页面。`);
    chrome.runtime.reload();
  }
  $('github-check').onclick = async () => {
    if (busy || !githubConfig || backup?.state === 'pending') return;
    busy = true; display();
    try {
      // 目录授权在用户点击时完成，避免网络等待后丢失浏览器的用户手势。
      if (!directory) await chooseDirectory();
      await permission(); notice('正在检查GitHub更新…');
      githubStatus = (await send({type:'updates:check'})).status;
      if (githubStatus?.state === 'error') throw Error(githubStatus.error);
      if (!githubStatus?.available) { notice('当前已是最新版本。'); return; }
      const next = await WorkToolGithub.download(githubStatus, current, {onProgress:(done,total)=>notice(`正在下载 ${githubStatus.version}：${done}/${total}…`)});
      await install(next);
    } catch (error) { if (error.name !== 'AbortError') notice(error.message); }
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
    } catch (error) { notice(error.message); }
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
  (async () => {
    try {
      [directory, backup] = await Promise.all([files.state(DIRECTORY), files.state(BACKUP)]);
      const result = await send({type:'updates:get'}); githubConfig = result.config; githubStatus = result.status;
      if (githubConfig) { $('github-url').value = githubConfig.url; $('github-branch').value = githubConfig.branch === 'HEAD' ? '' : githubConfig.branch; $('github-folder').value = githubConfig.folder; }
      display();
    }
    catch (error) { notice(error.message); }
    finally { busy = false; display(); }
  })();
  display();
})();
