export const DEFAULT_STATE = Object.freeze({
  enabled: true,
  reuseCount: 0,
  lastReuse: null,
});

// chrome.storage.local is shared with the link helper, so the reuse state is
// kept under one key of its own.
export const STORAGE_KEY = "tabReuseState";

export function createStateStore(storageArea) {
  let updateQueue = Promise.resolve();
  // Every write goes through this store, so after the first read the state is
  // kept in memory. This saves a storage round trip on each new tab, which
  // otherwise delays switching away from the duplicate tab.
  let cachedState = null;

  async function getState() {
    if (!cachedState) {
      const result = await storageArea.get({ [STORAGE_KEY]: DEFAULT_STATE });
      const stored = result[STORAGE_KEY] && typeof result[STORAGE_KEY] === "object" ? result[STORAGE_KEY] : DEFAULT_STATE;
      cachedState = {
        enabled: stored.enabled !== false,
        reuseCount: Number.isSafeInteger(stored.reuseCount) && stored.reuseCount >= 0
          ? stored.reuseCount
          : 0,
        lastReuse: stored.lastReuse && typeof stored.lastReuse === "object"
          ? stored.lastReuse
          : null,
      };
    }
    return { ...cachedState };
  }

  function updateState(updater) {
    const operation = updateQueue.then(async () => {
      const current = await getState();
      const next = updater(current);
      await storageArea.set({ [STORAGE_KEY]: next });
      cachedState = next;
      return { ...next };
    });
    updateQueue = operation.catch(() => undefined);
    return operation;
  }

  return {
    getState,

    setEnabled(enabled) {
      return updateState((current) => ({ ...current, enabled: Boolean(enabled) }));
    },

    recordReuse(urlValue, now = Date.now()) {
      let hostname = "";
      try {
        hostname = new URL(urlValue).hostname;
      } catch {
        // A successful reuse always has a valid HTTP(S) URL; keep storage safe if that changes.
      }

      return updateState((current) => ({
        ...current,
        reuseCount: current.reuseCount + 1,
        lastReuse: { hostname, timestamp: now },
      }));
    },
  };
}

