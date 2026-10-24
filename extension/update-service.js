(function(root) {
  'use strict';
  const DEFAULT_CONFIG = {url:'https://github.com/luoboLord/vadmin-helper-extension',branch:'HEAD',folder:'extension'};
  function create({chrome, github = root.WorkToolGithub, now = Date.now, defaultConfig = DEFAULT_CONFIG}) {
    const current = () => chrome.runtime.getManifest().version;
    let running;
    async function badge(status) {
      const available = status?.available && root.WorkToolLocalUpdate.compare(status.version,current()) > 0;
      await chrome.action.setBadgeText?.({text:available?'新':''});
      if (available) await chrome.action.setBadgeBackgroundColor?.({color:'#2859a9'});
    }
    async function get() {
      const data = await chrome.storage.local.get(['githubUpdateConfig','githubUpdateStatus']);
      if (data.githubUpdateStatus?.available && root.WorkToolLocalUpdate.compare(data.githubUpdateStatus.version,current()) <= 0) {
        data.githubUpdateStatus = {...data.githubUpdateStatus,available:false,state:'current'};
        await chrome.storage.local.set({githubUpdateStatus:data.githubUpdateStatus});
      }
      return {config:data.githubUpdateConfig === undefined ? (defaultConfig ? github.config(defaultConfig) : null) : data.githubUpdateConfig,status:data.githubUpdateStatus || null};
    }
    async function check(force = false) {
      const {config,status} = await get();
      if (!config) { await badge(null); return {state:'unconfigured',available:false}; }
      const key = github.key(config);
      if (running) { const active = running; await active.promise; if (active.key === key) return (await get()).status; return check(force); }
      if (!force && status?.sourceKey === key && now()-(status.attemptedAt || 0)<6*60*60*1000) { await badge(status); return status; }
      const attemptedAt = now();
      const promise = (async () => {
        let result;
        try { const snapshot = await github.check(config,current()); result = {...snapshot,state:snapshot.available?'available':'current',attemptedAt}; }
        catch (error) { result = {...(status?.sourceKey === key?status:{}),state:'error',sourceKey:key,error:error.message,attemptedAt}; }
        const latest = (await get()).config;
        if (!latest || github.key(latest) !== key) return result;
        await chrome.storage.local.set({githubUpdateStatus:result}); await badge(result); return result;
      })();
      running = {key,promise};
      try { return await promise; } finally { if (running?.promise === promise) running = null; }
    }
    async function configure(input) {
      const config = input?.url?.trim() ? github.config(input) : null;
      await chrome.storage.local.set({githubUpdateConfig:config,githubUpdateStatus:null}); await badge(null);
      return config ? check(true) : {state:'unconfigured',available:false};
    }
    return {get,check,configure};
  }
  root.WorkToolUpdateService = {create,DEFAULT_CONFIG};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.WorkToolUpdateService;
})(globalThis);
