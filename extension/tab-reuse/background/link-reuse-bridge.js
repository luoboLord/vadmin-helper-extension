import { LINK_REUSE_MESSAGES, LINK_REUSE_PORT } from "../shared/messages.js";

// Keeps every connected Feishu page informed about which pages are already
// open, so the page can cancel a duplicate link click before Chrome creates a
// tab for it, and forwards those cancelled clicks to the reuse controller.
export function createLinkReuseBridge(chromeApi, controller, logger = console) {
  const ports = new Set();
  let refreshTimer = null;

  async function sendOpenKeys(port) {
    const incognito = port.sender?.tab?.incognito === true;
    const keys = await controller.getOpenGroupKeys(incognito);
    if (ports.has(port)) {
      port.postMessage({ type: LINK_REUSE_MESSAGES.OPEN_KEYS, keys });
    }
  }

  function refreshAll() {
    for (const port of ports) {
      sendOpenKeys(port).catch((error) => {
        logger.warn?.("Failed to send open pages to a Feishu page.", error);
      });
    }
  }

  // Tab events arrive in bursts (one click updates a tab several times), so
  // they are coalesced into one refresh.
  function scheduleRefresh() {
    if (refreshTimer !== null || ports.size === 0) {
      return;
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshAll();
    }, 50);
  }

  function handleConnect(port) {
    if (port.name !== LINK_REUSE_PORT || !port.sender?.tab || port.sender.id !== chromeApi.runtime.id) {
      return;
    }

    ports.add(port);
    port.onDisconnect.addListener(() => ports.delete(port));
    port.onMessage.addListener((message) => {
      if (message?.type === LINK_REUSE_MESSAGES.REUSE_LINK && typeof message.url === "string") {
        void controller.handleLinkClick(message.url, port.sender.tab.id);
      }
    });
    sendOpenKeys(port).catch((error) => {
      logger.warn?.("Failed to send open pages to a Feishu page.", error);
    });
  }

  return { handleConnect, scheduleRefresh, refreshAll };
}
