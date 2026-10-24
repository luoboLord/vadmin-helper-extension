// The link helper's background listener ignores every type with this prefix,
// so these messages are only ever answered by the tab reuse worker.
export const MESSAGE_PREFIX = "tab-reuse:";

export const MESSAGE_TYPES = Object.freeze({
  GET_STATUS: `${MESSAGE_PREFIX}get-status`,
  SET_ENABLED: `${MESSAGE_PREFIX}set-enabled`,
  SCAN_DUPLICATES: `${MESSAGE_PREFIX}scan-duplicates`,
  CLEANUP_DUPLICATES: `${MESSAGE_PREFIX}cleanup-duplicates`,
});

// Long-lived connection between Feishu pages and the service worker.
export const LINK_REUSE_PORT = "feishu-link-reuse";

export const LINK_REUSE_MESSAGES = Object.freeze({
  OPEN_KEYS: "open-keys",
  REUSE_LINK: "reuse-link",
});
