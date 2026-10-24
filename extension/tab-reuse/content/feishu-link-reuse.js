// Runs in the extension's isolated world on Feishu pages. When a link that is
// about to open in a new tab points to a page that is already open, the click
// is cancelled here, before Chrome creates (and paints) a new tab, and the
// service worker switches to the existing tab instead. Links that are not open
// yet are left completely untouched.
//
// Clicks on links attached to the page are handled here. Links the page opens
// from code (window.open, or a detached link element as Feishu sheets use for
// cell hyperlinks) are forwarded by feishu-open-hook.js through OPEN_EVENT.
//
// Only the address of the link being opened is looked at; nothing on the page
// itself is read. The list of open pages stays
// in this isolated world, which the Feishu page's own scripts cannot access.
//
// The page's own scripts can dispatch OPEN_EVENT and synthetic clicks too, and
// learn from the cancellation whether a URL is open, without opening anything
// when it is not. Opens that do not come from a real user click are therefore
// only handled for Feishu pages; other sites then open, and are reused, like
// links from any other website.
(() => {
  // Must match OPEN_EVENT in feishu-open-hook.js, which runs in the page's
  // main world and cannot import extension modules.
  const OPEN_EVENT = "web-page-reuse:window-open";

  let getReuseGroupKey = null;
  let isFeishuUrl = null;
  let messages = null;
  let port = null;
  let openKeys = new Set();

  function connect() {
    if (port || !messages || !chrome.runtime?.id) {
      return;
    }
    port = chrome.runtime.connect({ name: messages.LINK_REUSE_PORT });
    port.onMessage.addListener((message) => {
      if (message?.type === messages.LINK_REUSE_MESSAGES.OPEN_KEYS && Array.isArray(message.keys)) {
        openKeys = new Set(message.keys);
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
      openKeys = new Set();
      // The service worker restarted; reconnect unless the extension itself
      // was removed or reloaded (then chrome.runtime.id is gone).
      setTimeout(connect, 1000);
    });
  }

  // Returns true when the link was handed to the service worker, in which case
  // the caller must cancel the browser's own navigation.
  function reuseIfOpen(href) {
    if (!port || !getReuseGroupKey || !navigator.userActivation?.isActive) {
      return false;
    }
    const key = getReuseGroupKey(href);
    if (!key || !openKeys.has(key)) {
      return false;
    }
    try {
      port.postMessage({ type: messages.LINK_REUSE_MESSAGES.REUSE_LINK, url: href });
    } catch {
      // The connection dropped just now; let the browser open the link.
      return false;
    }
    return true;
  }

  function opensInNewTab(anchor) {
    const target = anchor.getAttribute("target") ?? document.querySelector("base[target]")?.getAttribute("target") ?? "";
    return target.toLowerCase() === "_blank";
  }

  window.addEventListener("click", (event) => {
    // Modified clicks open background tabs or windows, which never flash.
    if (event.defaultPrevented || event.button !== 0
      || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    const anchor = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
    if (!anchor || !anchor.href || anchor.hasAttribute("download") || !opensInNewTab(anchor)) {
      return;
    }
    if (!event.isTrusted && !isFeishuUrl?.(anchor.href)) {
      return;
    }
    if (reuseIfOpen(anchor.href)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener(OPEN_EVENT, (event) => {
    if (typeof event.detail === "string" && isFeishuUrl?.(event.detail) && reuseIfOpen(event.detail)) {
      event.preventDefault();
    }
  });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      connect();
    }
  });

  Promise.all([
    import(chrome.runtime.getURL("tab-reuse/background/url-normalizer.js")),
    import(chrome.runtime.getURL("tab-reuse/shared/messages.js")),
  ]).then(([normalizer, sharedMessages]) => {
    getReuseGroupKey = normalizer.getReuseGroupKey;
    isFeishuUrl = normalizer.isFeishuUrl;
    messages = sharedMessages;
    connect();
  }).catch((error) => {
    console.warn("[客服链接助手·标签复用] Failed to start link reuse; links open as usual.", error);
  });
})();
