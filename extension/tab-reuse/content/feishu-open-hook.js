// Runs in the Feishu page's main world, because only there can the page's own
// ways of opening a new tab be wrapped. Before the page opens a URL in a new
// tab, it asks the extension's isolated-world script (feishu-link-reuse.js)
// through a synchronous DOM event whether that page is already open. If the
// event is cancelled, the extension switches to the existing tab and the new
// tab is never created. Only the URL being opened is looked at; nothing on the
// page is read.
//
// Covered here:
// - window.open(url): returns null when switched, which is also what it returns
//   for "noopener" windows.
// - Clicking a link element that is not attached to the page, from code
//   (anchor.click() or dispatchEvent). Feishu sheets open cell hyperlinks this
//   way. Such clicks never reach the window, so the click listener in
//   feishu-link-reuse.js cannot see them. Links attached to the page are left
//   to that listener.
(() => {
  // Must match OPEN_EVENT in feishu-link-reuse.js.
  const OPEN_EVENT = "web-page-reuse:window-open";
  const TAB_FEATURES = new Set(["noopener", "noreferrer"]);
  const originalOpen = window.open;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  const originalDispatchEvent = EventTarget.prototype.dispatchEvent;

  // Returns true when the extension switched to an already open tab instead.
  function reusedExistingTab(href) {
    return !originalDispatchEvent.call(
      document,
      new CustomEvent(OPEN_EVENT, { detail: href, cancelable: true }),
    );
  }

  // Any feature other than noopener/noreferrer (popup, width, ...) asks for a
  // separate window rather than a tab, which never needs reuse.
  function windowOpensInNewTab(target, features) {
    const targetName = target === undefined || target === null ? "_blank" : String(target);
    if (targetName !== "" && targetName.toLowerCase() !== "_blank") {
      return false;
    }
    const tokens = String(features ?? "").split(/[\s,]+/).filter(Boolean);
    return tokens.every((token) => TAB_FEATURES.has(token.split("=")[0].toLowerCase()));
  }

  function resolveUrl(url) {
    if (url === undefined || url === null || String(url) === "") {
      return null;
    }
    try {
      return new URL(String(url), document.baseURI).href;
    } catch {
      return null;
    }
  }

  // The href of a detached link that would open in a new tab, or null.
  function detachedNewTabHref(anchor) {
    if (!(anchor instanceof HTMLAnchorElement) || anchor.isConnected || anchor.hasAttribute("download")) {
      return null;
    }
    const target = anchor.getAttribute("target")
      ?? document.querySelector("base[target]")?.getAttribute("target")
      ?? "";
    return target.toLowerCase() === "_blank" ? resolveUrl(anchor.href) : null;
  }

  window.open = function open(url, target, features) {
    const href = windowOpensInNewTab(target, features) ? resolveUrl(url) : null;
    if (href && reusedExistingTab(href)) {
      return null;
    }
    return originalOpen.apply(this, arguments);
  };

  HTMLAnchorElement.prototype.click = function click() {
    const href = detachedNewTabHref(this);
    if (href && reusedExistingTab(href)) {
      return undefined;
    }
    return originalAnchorClick.apply(this, arguments);
  };

  EventTarget.prototype.dispatchEvent = function dispatchEvent(event) {
    // Modified clicks open background tabs or windows, which never flash.
    if (event instanceof MouseEvent && event.type === "click" && event.button === 0
      && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
      && this instanceof Element) {
      const href = detachedNewTabHref(this instanceof HTMLAnchorElement ? this : this.closest("a"));
      if (href && reusedExistingTab(href)) {
        // Report the click as cancelled, like a link whose default was prevented.
        return false;
      }
    }
    return originalDispatchEvent.apply(this, arguments);
  };
})();
