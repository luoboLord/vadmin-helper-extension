(function(root) {
  'use strict';
  const local = root.WorkToolLocalUpdate;
  const encode = value => encodeURIComponent(value);
  function config(input) {
    let value = String(input?.url || '').trim();
    if (!value) throw Error('请先填写GitHub仓库地址');
    if (!value.includes('://')) value = 'https://github.com/' + value;
    const url = new URL(value);
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash) throw Error('请填写https://github.com/用户/仓库格式的地址');
    const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    if (parts.length !== 2 || parts.some(v => !/^[A-Za-z0-9_.-]+$/.test(v) || v === '.' || v === '..')) throw Error('仓库地址应只包含用户名和仓库名');
    const [owner, name] = parts, repo = name.replace(/\.git$/, '');
    if (!repo) throw Error('仓库名不能为空');
    const branch = String(input.branch || '').trim() || 'HEAD';
    if (branch.length > 150 || /[\s\\~^:?*\[\x00-\x1f]/.test(branch) || branch.includes('..') || branch.includes('@{')) throw Error('分支名称无效');
    const folder = String(input.folder ?? 'extension').trim().replace(/\/$/, '');
    if (folder) local.path(folder);
    return {url:`https://github.com/${owner}/${repo}`, owner, repo, branch, folder};
  }
  const key = value => { const c = config(value); return `${c.url.toLowerCase()}|${c.branch}|${c.folder}`; };
  async function bytes(url, limit, fetchImpl = root.fetch) {
    const response = await fetchImpl(url, {credentials:'omit', cache:'no-store', redirect:'error', referrerPolicy:'no-referrer', signal:AbortSignal.timeout(30000)});
    if (!response.ok) {
      if (response.status === 404) throw Error('找不到公开仓库、分支或扩展文件，请检查更新源设置');
      if (response.status === 403 || response.status === 429) throw Error('GitHub访问受限或检查过于频繁，请稍后重试');
      throw Error(`GitHub请求失败：HTTP ${response.status}`);
    }
    const result = new Uint8Array(await response.arrayBuffer());
    if (result.byteLength > limit) throw Error('GitHub响应文件超过大小限制');
    return result;
  }
  async function json(url, fetchImpl) {
    try { return JSON.parse(new TextDecoder().decode(await bytes(url,8*1024*1024,fetchImpl))); }
    catch (error) { if (error instanceof SyntaxError) throw Error('GitHub返回内容不是有效JSON'); throw error; }
  }
  const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  function raw(source, commit, name) {
    return `https://raw.githubusercontent.com/${encode(source.owner)}/${encode(source.repo)}/${commit}/${[source.folder,name].filter(Boolean).join('/').split('/').map(encode).join('/')}`;
  }
  async function verify(data, expected) {
    const prefix = new TextEncoder().encode(`blob ${data.byteLength}\0`), blob = new Uint8Array(prefix.length+data.length);
    blob.set(prefix); blob.set(data,prefix.length);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1',blob)),b=>b.toString(16).padStart(2,'0')).join('');
    if (digest !== expected) throw Error('GitHub文件校验失败，更新未写入');
  }
  async function check(input, currentVersion, {fetchImpl} = {}) {
    const source = config(input), base = `https://api.github.com/repos/${encode(source.owner)}/${encode(source.repo)}`;
    const commit = await json(`${base}/commits/${encode(source.branch)}`,fetchImpl);
    if (!sha(commit.sha) || !sha(commit.commit?.tree?.sha)) throw Error('GitHub提交信息不完整');
    const tree = await json(`${base}/git/trees/${commit.commit.tree.sha}?recursive=1`,fetchImpl);
    if (!Array.isArray(tree.tree) || tree.truncated || tree.sha !== commit.commit.tree.sha) throw Error('GitHub文件列表不完整，无法更新');
    const prefix = source.folder ? source.folder+'/' : '', files = [], names = new Set();
    let total = 0;
    for (const item of tree.tree) {
      if (!item.path?.startsWith(prefix) || item.type === 'tree') continue;
      const name = local.path(item.path.slice(prefix.length));
      if (item.type !== 'blob' || !['100644','100755'].includes(item.mode) || !sha(item.sha)) throw Error('扩展目录含不支持的文件或符号链接');
      if (!Number.isSafeInteger(item.size) || item.size < 0 || item.size > 10*1024*1024) throw Error('更新文件大小无效');
      if (names.has(name.toLowerCase())) throw Error('更新文件路径重复');
      names.add(name.toLowerCase()); total += item.size; files.push({name,sha:item.sha,size:item.size});
    }
    if (!files.length || files.length > 250 || total > 20*1024*1024) throw Error('更新文件数量或总大小超限，请仅指定扩展文件目录');
    const entry = files.find(f=>f.name === 'manifest.json');
    if (!entry) throw Error('更新目录中没有manifest.json，请检查扩展目录设置');
    const data = await bytes(raw(source,commit.sha,entry.name),1024*1024,fetchImpl);
    if (data.length !== entry.size) throw Error('版本文件大小不一致，更新未写入');
    await verify(data,entry.sha);
    const manifest = local.manifest(data);
    return {available:local.compare(manifest.version,currentVersion)>0,version:manifest.version,commit:commit.sha,source,sourceKey:key(source),files,checkedAt:Date.now()};
  }
  async function download(snapshot, currentVersion, {fetchImpl,onProgress=()=>{}} = {}) {
    if (!snapshot?.available || !sha(snapshot.commit)) throw Error('请先检查更新');
    const source = config(snapshot.source), files = new Map();
    if (key(source) !== snapshot.sourceKey || !Array.isArray(snapshot.files) || snapshot.files.length > 250) throw Error('更新信息无效，请重新检查');
    for (const entry of snapshot.files) {
      local.path(entry.name);
      const data = await bytes(raw(source,snapshot.commit,entry.name),10*1024*1024,fetchImpl);
      if (data.length !== entry.size) throw Error(`更新文件大小不一致：${entry.name}`);
      await verify(data,entry.sha); files.set(entry.name,data); onProgress(files.size,snapshot.files.length);
    }
    const prepared = local.prepareFiles(files,currentVersion);
    if (prepared.version !== snapshot.version) throw Error('更新版本不一致，请重新检查');
    return prepared;
  }
  root.WorkToolGithub = {config,key,check,download};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.WorkToolGithub;
})(globalThis);
