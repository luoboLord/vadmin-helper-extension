export function getEffectiveTabUrl(tab) {
  return tab.pendingUrl || tab.url || "";
}

export function selectMostRecentTab(tabs) {
  return [...tabs].sort((left, right) => {
    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }
    const accessOrder = (right.lastAccessed || 0) - (left.lastAccessed || 0);
    return accessOrder !== 0 ? accessOrder : (left.id || 0) - (right.id || 0);
  })[0];
}

