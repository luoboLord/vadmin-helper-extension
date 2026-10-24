import { getUrlKey } from "./url-normalizer.js";
import { getEffectiveTabUrl, selectMostRecentTab } from "./tab-utils.js";

function buildCleanupPlan(tabs) {
  const windowTabCounts = new Map();
  const groups = new Map();

  for (const tab of tabs) {
    windowTabCounts.set(tab.windowId, (windowTabCounts.get(tab.windowId) || 0) + 1);
    const key = getUrlKey(getEffectiveTabUrl(tab));
    if (!key || !Number.isInteger(tab.id)) {
      continue;
    }

    const privacyKey = tab.incognito ? "incognito" : "normal";
    const groupKey = `${privacyKey}\n${key}`;
    const group = groups.get(groupKey) || [];
    group.push(tab);
    groups.set(groupKey, group);
  }

  const closeIds = [];
  let groupCount = 0;
  let skippedCount = 0;

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    groupCount += 1;

    const protectedTabs = group.filter((tab) => (
      tab.pinned
      || tab.audible
      || windowTabCounts.get(tab.windowId) === 1
    ));

    if (protectedTabs.length > 0) {
      const protectedIds = new Set(protectedTabs.map((tab) => tab.id));
      closeIds.push(...group.filter((tab) => !protectedIds.has(tab.id)).map((tab) => tab.id));
      skippedCount += Math.max(0, protectedTabs.length - 1);
      continue;
    }

    const keeper = selectMostRecentTab(group);
    closeIds.push(...group.filter((tab) => tab.id !== keeper.id).map((tab) => tab.id));
  }

  const closeIdSet = new Set(closeIds);
  const closeTabsByWindow = new Map();
  for (const tab of tabs) {
    if (!closeIdSet.has(tab.id)) {
      continue;
    }
    const windowTabs = closeTabsByWindow.get(tab.windowId) || [];
    windowTabs.push(tab);
    closeTabsByWindow.set(tab.windowId, windowTabs);
  }

  for (const [windowId, windowTabs] of closeTabsByWindow) {
    if (windowTabs.length < windowTabCounts.get(windowId)) {
      continue;
    }
    const windowKeeper = selectMostRecentTab(windowTabs);
    closeIdSet.delete(windowKeeper.id);
    skippedCount += 1;
  }

  const safeCloseIds = [...closeIdSet];
  return {
    closeIds: safeCloseIds,
    closeCount: safeCloseIds.length,
    groupCount,
    skippedCount,
  };
}

export function createDuplicateCleanup(chromeApi, logger = console) {
  async function createCurrentPlan() {
    const tabs = await chromeApi.tabs.query({ windowType: "normal" });
    return buildCleanupPlan(tabs);
  }

  return {
    // closeIds lets the popup confirm exactly these tabs; see cleanup().
    async scan() {
      return createCurrentPlan();
    },

    // Closes only tabs the user confirmed. Tabs can change while earlier ones
    // are being closed, so each one is checked against a fresh plan right
    // before closing it, and new candidates wait for a new confirmation.
    async cleanup(confirmedTabIds) {
      if (!Array.isArray(confirmedTabIds) || !confirmedTabIds.every(Number.isInteger)) {
        throw new Error("No confirmed duplicate tabs to close.");
      }

      let skippedCount = null;
      let closedCount = 0;
      let changedCount = 0;

      for (const tabId of new Set(confirmedTabIds)) {
        const plan = await createCurrentPlan();
        skippedCount ??= plan.skippedCount;
        if (!plan.closeIds.includes(tabId)) {
          changedCount += 1;
          continue;
        }
        try {
          await chromeApi.tabs.remove(tabId);
          closedCount += 1;
        } catch (error) {
          logger.warn(`Could not close duplicate tab ${tabId}.`, error);
        }
      }

      const remaining = await createCurrentPlan();
      return {
        closedCount,
        changedCount,
        skippedCount: skippedCount ?? remaining.skippedCount,
        remainingCloseCount: remaining.closeCount,
      };
    },
  };
}

export { buildCleanupPlan };
