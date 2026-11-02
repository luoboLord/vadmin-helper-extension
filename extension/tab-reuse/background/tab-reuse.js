import {
  applyRequestedHash,
  getReuseGroupKey,
  getSheetInfo,
  getUrlKey,
  parseSupportedUrl,
} from "./url-normalizer.js";
import { getEffectiveTabUrl, selectMostRecentTab } from "./tab-utils.js";
import { createSheetSwitcher } from "./sheet-switch.js";

export function createTabReuseController(
  chromeApi,
  stateStore,
  logger = console,
  sheetSwitcher = createSheetSwitcher(chromeApi, logger),
) {
  const keyQueues = new Map();

  // Picks the tab to reuse for targetUrl among `tabs`, or returns null.
  function planReuse(tabs, targetUrl, groupKey, { excludedTabId = null, incognito }) {
    const groupMatches = tabs.filter((tab) => (
      tab.id !== excludedTabId
      && tab.incognito === incognito
      && getReuseGroupKey(getEffectiveTabUrl(tab)) === groupKey
    ));

    if (groupMatches.length === 0) {
      return null;
    }

    // Prefer a tab showing the exact same URL; only fall back to a tab showing
    // the same sheet document at a different worksheet.
    const exactKey = getUrlKey(targetUrl);
    const exactMatches = groupMatches.filter(
      (tab) => getUrlKey(getEffectiveTabUrl(tab)) === exactKey,
    );
    const isExactMatch = exactMatches.length > 0;
    const existingTab = selectMostRecentTab(isExactMatch ? exactMatches : groupMatches);
    const existingUrl = getEffectiveTabUrl(existingTab);

    const targetSheet = isExactMatch ? null : getSheetInfo(targetUrl);
    const existingSheetId = isExactMatch ? null : (getSheetInfo(existingUrl)?.sheetId || null);
    const needsSheetSwitch = Boolean(targetSheet) && targetSheet.sheetId !== existingSheetId;

    const updateProperties = { active: true };
    if (isExactMatch) {
      const hashNavigationUrl = applyRequestedHash(existingUrl, targetUrl);
      if (hashNavigationUrl) {
        updateProperties.url = hashNavigationUrl;
      }
    }

    return {
      existingTab,
      existingUrl,
      updateProperties,
      targetSheet: needsSheetSwitch ? targetSheet : null,
    };
  }

  // Normalization used for matching deliberately ignores fragments and share
  // parameters. Closing a new tab requires a stronger check: it must still be
  // the exact navigation Chrome created for this request.
  function isRequestedTarget(tab, targetUrl) {
    const currentUrl = parseSupportedUrl(getEffectiveTabUrl(tab))?.href;
    const requestedUrl = parseSupportedUrl(targetUrl)?.href;
    return Boolean(currentUrl && requestedUrl) && currentUrl === requestedUrl;
  }

  // The reuse statistics are informational only, so failing to save them must
  // never stop or undo the tab switch itself.
  async function recordReuse(targetUrl) {
    try {
      await stateStore.recordReuse(targetUrl);
    } catch (error) {
      logger.error?.("Failed to record a reuse; the tab switch itself was not affected.", error);
    }
  }

  // Re-focusing the window the user is already looking at only adds a round
  // trip before the tab switch, so it is skipped in that case.
  async function bringForward(plan, currentWindowId, currentWindowFocused) {
    const { existingTab, updateProperties } = plan;
    if (existingTab.windowId !== currentWindowId || currentWindowFocused !== true) {
      await chromeApi.windows.update(existingTab.windowId, { focused: true });
    }
    await chromeApi.tabs.update(existingTab.id, updateProperties);
  }

  // `reopen` opens targetUrl in a new tab; it is the last resort when the
  // existing tab can no longer show the requested worksheet, so the request
  // is never lost.
  async function finishSheetSwitch(plan, targetUrl, reopen) {
    const { existingTab, existingUrl, targetSheet } = plan;
    if (!targetSheet) {
      return { action: "reused", existingTabId: existingTab.id };
    }

    const switchResult = await sheetSwitcher.switchSheet(existingTab.id, targetSheet.sheetId, targetSheet.provider);
    if (switchResult.ok) {
      return { action: "reused", existingTabId: existingTab.id, switched: "in-app" };
    }

    logger.warn?.(
      `In-app sheet switch failed (${switchResult.reason}); `
        + "navigating the existing tab to the target sheet instead.",
      switchResult.diagnostics,
    );

    // The switch can take seconds, so look at the tab again before replacing
    // its page: the user may have navigated it, or closed it, meanwhile.
    let currentTab;
    try {
      currentTab = await chromeApi.tabs.get(existingTab.id);
    } catch (error) {
      logger.warn?.("The existing tab is gone; opening the target sheet in a new tab.", error);
      await reopen();
      return { action: "opened", reason: "existing-tab-gone" };
    }

    const currentKey = getUrlKey(getEffectiveTabUrl(currentTab));
    if (currentKey === getUrlKey(targetUrl)) {
      // The in-app switch took effect after all, only later than expected.
      return { action: "reused", existingTabId: existingTab.id, switched: "in-app" };
    }
    if (currentKey !== getUrlKey(existingUrl)) {
      // The user navigated the tab themselves; their newer navigation wins.
      // The intercepted target still needs to open instead of disappearing.
      await reopen();
      return { action: "opened", reason: "superseded" };
    }

    try {
      await chromeApi.tabs.update(existingTab.id, { url: targetUrl });
    } catch (error) {
      logger.warn?.("Failed to navigate the existing tab to the target sheet; opening it in a new tab.", error);
      await reopen();
      return { action: "opened", reason: "navigate-failed" };
    }
    return { action: "reused", existingTabId: existingTab.id, switched: "reload" };
  }

  async function reuseExistingTab(details, targetUrl, groupKey) {
    const targetTab = await chromeApi.tabs.get(details.tabId);
    if (typeof targetTab.incognito !== "boolean") {
      return { action: "ignored" };
    }

    const targetWindow = await chromeApi.windows.get(targetTab.windowId);
    if (targetWindow.type !== "normal") {
      return { action: "ignored" };
    }

    // Ctrl-click and middle-click deliberately create background tabs. Keep
    // those native semantics instead of focusing another tab and closing the
    // one the user just asked Chrome to open; new windows are handled below.
    if (targetTab.active === false) {
      return { action: "opened", reason: "background" };
    }
    if (Number.isInteger(details.sourceTabId) && details.sourceTabId >= 0
      && details.sourceTabId !== details.tabId) {
      const sourceTab = await chromeApi.tabs.get(details.sourceTabId);
      if (sourceTab.windowId !== targetTab.windowId) {
        return { action: "opened", reason: "new-window" };
      }
    }
    if (!isRequestedTarget(targetTab, targetUrl)) {
      return { action: "changed" };
    }

    const tabs = await chromeApi.tabs.query({ windowType: "normal" });
    const plan = planReuse(tabs, targetUrl, groupKey, {
      excludedTabId: details.tabId,
      incognito: targetTab.incognito,
    });
    if (!plan) {
      return { action: "opened" };
    }

    // Bring the existing tab forward and close the duplicate immediately, so
    // the freshly created tab never becomes a visible, fully-loading page.
    // The (potentially slower) in-page worksheet switch happens afterwards.
    await bringForward(plan, targetTab.windowId, targetWindow.focused);

    const latestTarget = await chromeApi.tabs.get(details.tabId);
    if (!isRequestedTarget(latestTarget, targetUrl)) {
      return { action: "changed" };
    }

    await chromeApi.tabs.remove(details.tabId);
    const result = await finishSheetSwitch(plan, targetUrl, () => chromeApi.tabs.create({
      url: targetUrl,
      windowId: latestTarget.windowId,
      index: latestTarget.index,
      active: true,
    }));
    if (result.action === "reused") {
      await recordReuse(targetUrl);
    }
    return result;
  }

  // A Feishu page cancelled a link click before Chrome created a tab for it,
  // because it expects the link to be open already. Switch to that tab, or open
  // the link after all if it no longer is, so the click is never lost.
  async function reuseForLinkClick(targetUrl, sourceTab, groupKey) {
    let plan = null;
    try {
      const [sourceWindow, tabs] = await Promise.all([
        chromeApi.windows.get(sourceTab.windowId),
        chromeApi.tabs.query({ windowType: "normal" }),
      ]);
      plan = planReuse(tabs, targetUrl, groupKey, { incognito: sourceTab.incognito });
      if (plan) {
        await bringForward(plan, sourceTab.windowId, sourceWindow.focused);
      }
    } catch (error) {
      // For example the open page was closed between the lookup and switching
      // to it. The page already cancelled its own navigation, so open the link.
      logger.warn?.("Could not switch to the open page; opening the link instead.", error);
      plan = null;
    }
    if (!plan) {
      await openLinkTab(targetUrl, sourceTab);
      return { action: "opened" };
    }

    const result = await finishSheetSwitch(plan, targetUrl, () => openLinkTab(targetUrl, sourceTab));
    if (result.action === "reused") {
      await recordReuse(targetUrl);
    }
    return result;
  }

  function openLinkTab(targetUrl, sourceTab) {
    return chromeApi.tabs.create({
      url: targetUrl,
      windowId: sourceTab.windowId,
      index: sourceTab.index + 1,
      openerTabId: sourceTab.id,
    });
  }

  function enqueue(groupKey, task) {
    const previous = keyQueues.get(groupKey) || Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(task);
    keyQueues.set(groupKey, current);

    return current.finally(() => {
      if (keyQueues.get(groupKey) === current) {
        keyQueues.delete(groupKey);
      }
    });
  }

  async function processCreatedNavigationTarget(details) {
    const state = await stateStore.getState();
    if (!state.enabled) {
      return { action: "disabled" };
    }

    const targetUrl = details.url;
    const groupKey = getReuseGroupKey(targetUrl);
    if (!groupKey || !Number.isInteger(details.tabId)) {
      return { action: "ignored" };
    }

    return enqueue(groupKey, () => reuseExistingTab(details, targetUrl, groupKey));
  }

  async function processLinkClick(targetUrl, sourceTabId) {
    const groupKey = getReuseGroupKey(targetUrl);
    if (!groupKey || !Number.isInteger(sourceTabId)) {
      return { action: "ignored" };
    }

    // The tab may have moved since its page connected, so look it up afresh.
    const sourceTab = await chromeApi.tabs.get(sourceTabId);
    const state = await stateStore.getState();
    if (!state.enabled) {
      await openLinkTab(targetUrl, sourceTab);
      return { action: "disabled" };
    }

    return enqueue(groupKey, () => reuseForLinkClick(targetUrl, sourceTab, groupKey));
  }

  async function openLinkAfterFailure(targetUrl, sourceTabId) {
    // Verify that the source still exists before recovering. If the user has
    // closed it, that newer action wins and no replacement tab is forced open.
    const sourceTab = await chromeApi.tabs.get(sourceTabId);
    return openLinkTab(targetUrl, sourceTab);
  }

  return {
    async handleCreatedNavigationTarget(details) {
      try {
        return await processCreatedNavigationTarget(details);
      } catch (error) {
        logger.error?.("Failed to process a new navigation target.", error);
        return { action: "error", error };
      }
    },

    async handleLinkClick(targetUrl, sourceTabId) {
      try {
        return await processLinkClick(targetUrl, sourceTabId);
      } catch (error) {
        logger.error?.("Failed to reuse a tab for an intercepted link click; opening the target instead.", error);
        try {
          await openLinkAfterFailure(targetUrl, sourceTabId);
          return { action: "opened", reason: "handle-failed" };
        } catch (fallbackError) {
          logger.error?.("Failed to open a target after link reuse failed.", fallbackError);
          return { action: "error", error: fallbackError };
        }
      }
    },

    // Group keys of the pages open in normal windows on one side of the
    // incognito boundary; Feishu pages use them to decide synchronously
    // whether a clicked link can be switched to instead of opened.
    async getOpenGroupKeys(incognito) {
      const state = await stateStore.getState();
      if (!state.enabled) {
        return [];
      }
      const tabs = await chromeApi.tabs.query({ windowType: "normal" });
      const keys = new Set();
      for (const tab of tabs) {
        if (tab.incognito !== incognito) {
          continue;
        }
        const key = getReuseGroupKey(getEffectiveTabUrl(tab));
        if (key) {
          keys.add(key);
        }
      }
      return [...keys];
    },
  };
}
