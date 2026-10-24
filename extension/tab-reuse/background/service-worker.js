import { createDuplicateCleanup } from "./duplicate-cleanup.js";
import { createLinkReuseBridge } from "./link-reuse-bridge.js";
import { createStateStore } from "./state-store.js";
import { createTabReuseController } from "./tab-reuse.js";
import { MESSAGE_PREFIX, MESSAGE_TYPES } from "../shared/messages.js";

const stateStore = createStateStore(chrome.storage.local);
const tabReuseController = createTabReuseController(chrome, stateStore);
const duplicateCleanup = createDuplicateCleanup(chrome);
const linkReuseBridge = createLinkReuseBridge(chrome, tabReuseController);

// The toolbar badge belongs to the link helper's update notice, so the paused
// state is shown on the data management page instead.
async function handleMessage(message) {
  switch (message.type) {
    case MESSAGE_TYPES.GET_STATUS:
      return stateStore.getState();
    case MESSAGE_TYPES.SET_ENABLED: {
      const state = await stateStore.setEnabled(message.enabled);
      linkReuseBridge.refreshAll();
      return state;
    }
    case MESSAGE_TYPES.SCAN_DUPLICATES:
      return duplicateCleanup.scan();
    case MESSAGE_TYPES.CLEANUP_DUPLICATES:
      return duplicateCleanup.cleanup(message.tabIds);
    default:
      throw new Error("Unsupported tab reuse message.");
  }
}

// Chrome stops an idle extension service worker after 30 seconds. The next
// link click then waits for the worker to restart before the duplicate tab
// can be closed, and that delay shows up as a visible flash. Since Chrome 110
// every extension API call resets the idle timer, so a cheap periodic call
// keeps the worker ready to react within the same frame.
const KEEP_ALIVE_INTERVAL_MS = 20_000;
setInterval(() => {
  void chrome.runtime.getPlatformInfo();
}, KEEP_ALIVE_INTERVAL_MS);

// Registering onStartup makes Chrome start the worker together with the
// browser, so even the first link click after launch finds it running.
chrome.runtime.onStartup.addListener(() => {});

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  void tabReuseController.handleCreatedNavigationTarget(details);
});

// Feishu pages cancel duplicate link clicks before a tab is created (see
// content/feishu-link-reuse.js); they need an up-to-date list of open pages.
chrome.runtime.onConnect.addListener((port) => linkReuseBridge.handleConnect(port));
chrome.tabs.onCreated.addListener(() => linkReuseBridge.scheduleRefresh());
chrome.tabs.onRemoved.addListener(() => linkReuseBridge.scheduleRefresh());
chrome.tabs.onReplaced.addListener(() => linkReuseBridge.scheduleRefresh());
chrome.tabs.onAttached.addListener(() => linkReuseBridge.scheduleRefresh());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status) {
    linkReuseBridge.scheduleRefresh();
  }
});

// Other messages belong to the link helper and are left to its own listener.
// Only the data management page may read or change the reuse settings; content
// scripts on Feishu and backend pages run in the same extension and must not.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (typeof message?.type !== "string" || !message.type.startsWith(MESSAGE_PREFIX)) {
    return false;
  }
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("manager.html")) {
    sendResponse({ ok: false, error: "Rejected message sender." });
    return false;
  }

  handleMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      console.error("Failed to handle a tab reuse message.", error);
      sendResponse({ ok: false, error: error.message || "Unknown extension error." });
    });
  return true;
});
