// Upper bound for the whole injection; the page scripts themselves wait at
// most about 4s for the tab bar plus 1.5s for the switch to be confirmed.
const DEFAULT_SWITCH_TIMEOUT_MS = 8000;

// This function is serialized and injected into the Feishu page by
// chrome.scripting.executeScript in the page's MAIN world. It must stay fully
// self-contained: it cannot reference any module-scope binding, because only
// its own source is injected. It returns a Promise resolving to
// { ok, strategy?, reason?, diagnostics? }.
//
// Feishu renders each worksheet tab as div[data-e2e="tab-sheet-item"] without
// exposing the sheet id in the DOM. The id only lives in the tab's React props
// (props.sheet._id_), which are page JavaScript objects and therefore only
// readable from the MAIN world. Clicking that tab switches the worksheet
// in-app and updates the `sheet` query parameter without reloading the page.
export function injectedSwitchFeishuSheet(targetSheetId, timing) {
  var options = timing || {};
  var FIND_TIMEOUT_MS = options.findTimeoutMs || 4000;
  var SWITCH_TIMEOUT_MS = options.switchTimeoutMs || 1500;
  var POLL_INTERVAL_MS = options.pollIntervalMs || 100;
  var MAX_FIBER_DEPTH = 5;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function currentSheetId() {
    try {
      return new URL(window.location.href).searchParams.get("sheet");
    } catch (error) {
      return null;
    }
  }

  function getTabElements() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-e2e="tab-sheet-item"]'));
  }

  function getReactNode(element) {
    var keys = Object.keys(element);
    for (var i = 0; i < keys.length; i += 1) {
      if (keys[i].indexOf("__reactInternalInstance$") === 0 || keys[i].indexOf("__reactFiber$") === 0) {
        return element[keys[i]];
      }
    }
    return null;
  }

  // Walks up from the tab's DOM fiber to the component that receives the
  // worksheet model, without hard-coding how many levels that is.
  function getSheetProps(element) {
    var node = getReactNode(element);
    for (var depth = 0; node && depth <= MAX_FIBER_DEPTH; depth += 1) {
      var props = node.memoizedProps;
      if (props && typeof props === "object" && props.sheet && typeof props.sheet._id_ === "string") {
        return props;
      }
      node = node.return;
    }
    return null;
  }

  function scanTabs() {
    var elements = getTabElements();
    var result = { tabCount: elements.length, resolvedCount: 0, element: null, props: null };
    for (var i = 0; i < elements.length; i += 1) {
      var props = getSheetProps(elements[i]);
      if (!props) {
        continue;
      }
      result.resolvedCount += 1;
      if (props.sheet._id_ === targetSheetId) {
        result.element = elements[i];
        result.props = props;
        return result;
      }
    }
    return result;
  }

  function clickElement(element) {
    var rect = element.getBoundingClientRect();
    var init = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    element.dispatchEvent(new MouseEvent("mousedown", init));
    element.dispatchEvent(new MouseEvent("mouseup", init));
    element.dispatchEvent(new MouseEvent("click", init));
  }

  async function waitForUrlSheet() {
    var deadline = Date.now() + SWITCH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (currentSheetId() === targetSheetId) {
        return true;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return currentSheetId() === targetSheetId;
  }

  return (async function () {
    if (currentSheetId() === targetSheetId) {
      return { ok: true, strategy: "already-active", diagnostics: {} };
    }

    // The existing tab may still be loading, so wait for the tab bar to
    // render and expose the target worksheet.
    var deadline = Date.now() + FIND_TIMEOUT_MS;
    var scan = scanTabs();
    while (!scan.element && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      scan = scanTabs();
    }

    var diagnostics = { tabCount: scan.tabCount, resolvedCount: scan.resolvedCount };
    if (!scan.element) {
      var reason = "sheet-not-found";
      if (scan.tabCount === 0) {
        reason = "tab-bar-not-ready";
      } else if (scan.resolvedCount === 0) {
        reason = "sheet-model-unavailable";
      }
      return { ok: false, reason: reason, diagnostics: diagnostics };
    }
    if (scan.props.visible === false) {
      return { ok: false, reason: "sheet-hidden", diagnostics: diagnostics };
    }

    try {
      clickElement(scan.element);
    } catch (error) {
      diagnostics.error = String((error && error.message) || error);
      return { ok: false, reason: "click-failed", diagnostics: diagnostics };
    }

    if (await waitForUrlSheet()) {
      return { ok: true, strategy: "tab-click", diagnostics: diagnostics };
    }
    return { ok: false, reason: "click-did-not-switch", diagnostics: diagnostics };
  })();
}

// Tencent Docs counterpart of injectedSwitchFeishuSheet, with the same
// self-contained and result rules. Each worksheet tab is a .tab-bar-item that
// carries its id in data-tab-id, so the DOM alone is enough and the script runs
// in the extension's isolated world. Clicking the tab switches the worksheet
// in-app and updates the `tab` query parameter without reloading the page.
export function injectedSwitchTencentSheet(targetTabId, timing) {
  var options = timing || {};
  var FIND_TIMEOUT_MS = options.findTimeoutMs || 4000;
  var SWITCH_TIMEOUT_MS = options.switchTimeoutMs || 1500;
  var POLL_INTERVAL_MS = options.pollIntervalMs || 100;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function currentTabId() {
    try {
      return new URL(window.location.href).searchParams.get("tab");
    } catch (error) {
      return null;
    }
  }

  // Compares attribute values instead of building a selector from the id.
  function scanTabs() {
    var elements = document.querySelectorAll(".tab-bar-item[data-tab-id]");
    for (var i = 0; i < elements.length; i += 1) {
      if (elements[i].getAttribute("data-tab-id") === targetTabId) {
        return { tabCount: elements.length, element: elements[i] };
      }
    }
    return { tabCount: elements.length, element: null };
  }

  // A document opened without `tab` shows its first worksheet with no tab in
  // the URL, so the selected state counts as switched too.
  function isActive(element) {
    return currentTabId() === targetTabId || element.getAttribute("aria-selected") === "true";
  }

  return (async function () {
    if (currentTabId() === targetTabId) {
      return { ok: true, strategy: "already-active", diagnostics: {} };
    }

    var deadline = Date.now() + FIND_TIMEOUT_MS;
    var scan = scanTabs();
    while (!scan.element && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      scan = scanTabs();
    }

    var diagnostics = { tabCount: scan.tabCount };
    if (!scan.element) {
      return { ok: false, reason: scan.tabCount === 0 ? "tab-bar-not-ready" : "sheet-not-found", diagnostics: diagnostics };
    }
    if (scan.element.getAttribute("aria-selected") === "true") {
      return { ok: true, strategy: "already-active", diagnostics: diagnostics };
    }

    try {
      scan.element.click();
    } catch (error) {
      diagnostics.error = String((error && error.message) || error);
      return { ok: false, reason: "click-failed", diagnostics: diagnostics };
    }

    var switchDeadline = Date.now() + SWITCH_TIMEOUT_MS;
    while (Date.now() < switchDeadline) {
      if (isActive(scan.element)) {
        return { ok: true, strategy: "tab-click", diagnostics: diagnostics };
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return isActive(scan.element)
      ? { ok: true, strategy: "tab-click", diagnostics: diagnostics }
      : { ok: false, reason: "click-did-not-switch", diagnostics: diagnostics };
  })();
}

const PAGE_SWITCHERS = Object.freeze({
  feishu: { func: injectedSwitchFeishuSheet, world: "MAIN" },
  tencent: { func: injectedSwitchTencentSheet, world: "ISOLATED" },
});

export function createSheetSwitcher(chromeApi, logger = console, options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_SWITCH_TIMEOUT_MS;

  async function switchSheet(tabId, sheetId, provider = "feishu") {
    if (!chromeApi || !chromeApi.scripting || typeof chromeApi.scripting.executeScript !== "function") {
      return { ok: false, reason: "scripting-unavailable", diagnostics: {} };
    }
    const pageSwitcher = Object.hasOwn(PAGE_SWITCHERS, provider) ? PAGE_SWITCHERS[provider] : null;
    if (!pageSwitcher) {
      return { ok: false, reason: "unsupported-provider", diagnostics: {} };
    }

    let injectionResults;
    let timeoutHandle = null;
    try {
      const execution = chromeApi.scripting.executeScript({
        target: { tabId },
        world: pageSwitcher.world,
        func: pageSwitcher.func,
        args: [sheetId],
      });
      const timeout = new Promise((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ __timedOut: true }), timeoutMs);
      });
      const raced = await Promise.race([execution, timeout]);
      if (raced && raced.__timedOut) {
        logger.warn?.(`Sheet switch timed out after ${timeoutMs}ms.`);
        return { ok: false, reason: "timeout", diagnostics: {} };
      }
      injectionResults = raced;
    } catch (error) {
      logger.warn?.("Failed to inject the sheet switch script.", error);
      return {
        ok: false,
        reason: "injection-failed",
        diagnostics: { error: String((error && error.message) || error) },
      };
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    }

    const pageResult = Array.isArray(injectionResults) ? injectionResults[0]?.result : null;
    if (!pageResult || typeof pageResult !== "object" || pageResult.ok !== true) {
      const reason = pageResult && typeof pageResult === "object" && typeof pageResult.reason === "string"
        ? pageResult.reason
        : "no-result";
      logger.warn?.(`In-app sheet switch failed: ${reason}.`, pageResult?.diagnostics);
      return {
        ok: false,
        reason,
        diagnostics: pageResult && typeof pageResult.diagnostics === "object" ? pageResult.diagnostics : {},
      };
    }

    return {
      ok: true,
      strategy: typeof pageResult.strategy === "string" ? pageResult.strategy : "unknown",
      diagnostics: typeof pageResult.diagnostics === "object" ? pageResult.diagnostics : {},
    };
  }

  return { switchSheet };
}
