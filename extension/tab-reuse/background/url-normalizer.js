const GLOBAL_TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "msclkid",
]);

const FEISHU_TRACKING_PARAMETERS = new Set([
  "docs_banner_login",
  "from",
]);

// Tencent Docs share links carry a timestamp (_t), a sharer id (u) and nlc;
// the page keeps them in its address but they do not change what it shows.
const TENCENT_DOCS_TRACKING_PARAMETERS = new Set([
  "_t",
  "nlc",
  "u",
]);

function isFeishuHost(hostname) {
  return hostname === "feishu.cn" || hostname.endsWith(".feishu.cn");
}

function isTencentDocsHost(hostname) {
  return hostname === "docs.qq.com";
}

function shouldIgnoreParameter(name, hostname) {
  const normalizedName = name.toLowerCase();
  if (normalizedName.startsWith("utm_")) {
    return true;
  }
  if (GLOBAL_TRACKING_PARAMETERS.has(normalizedName)) {
    return true;
  }
  if (isTencentDocsHost(hostname)) {
    return TENCENT_DOCS_TRACKING_PARAMETERS.has(normalizedName);
  }
  return isFeishuHost(hostname) && FEISHU_TRACKING_PARAMETERS.has(normalizedName);
}

export function parseSupportedUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function isFeishuUrl(value) {
  const url = parseSupportedUrl(value);
  return Boolean(url) && isFeishuHost(url.hostname);
}

// Spreadsheet documents whose worksheet is chosen by a query parameter, which
// therefore only identifies an in-document view:
// - Feishu: /sheets/<token>, or a knowledge-base node /wiki/<token> that hosts
//   a sheet, with `sheet`.
// - Tencent Docs: docs.qq.com/sheet/<id>, with `tab`.
// Returns { provider, parameter } or null.
function getSheetDocument(url) {
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    return null;
  }
  if (isFeishuHost(url.hostname) && (segments[0] === "sheets" || segments[0] === "wiki")) {
    return { provider: "feishu", parameter: "sheet" };
  }
  if (isTencentDocsHost(url.hostname) && segments[0] === "sheet") {
    return { provider: "tencent", parameter: "tab" };
  }
  return null;
}

function buildUrlKey(value, { collapseSheet = false } = {}) {
  const url = parseSupportedUrl(value);
  if (!url) {
    return null;
  }

  url.hash = "";
  const sheetParameter = collapseSheet ? getSheetDocument(url)?.parameter : null;

  const retainedParameters = [];
  for (const [name, parameterValue] of url.searchParams) {
    if (shouldIgnoreParameter(name, url.hostname)) {
      continue;
    }
    if (sheetParameter && name.toLowerCase() === sheetParameter) {
      continue;
    }
    retainedParameters.push([name, parameterValue]);
  }

  retainedParameters.sort(([leftName, leftValue], [rightName, rightValue]) => {
    const nameOrder = leftName.localeCompare(rightName);
    return nameOrder !== 0 ? nameOrder : leftValue.localeCompare(rightValue);
  });

  url.search = "";
  for (const [name, parameterValue] of retainedParameters) {
    url.searchParams.append(name, parameterValue);
  }

  return url.href;
}

export function getUrlKey(value) {
  return buildUrlKey(value);
}

// Reuse groups treat the worksheet parameter of sheet documents as an
// in-document location instead of part of the page identity, so links to
// different worksheets of the same document can reuse one tab.
export function getReuseGroupKey(value) {
  return buildUrlKey(value, { collapseSheet: true });
}

// Returns { provider: "feishu" | "tencent", sheetId } or null.
export function getSheetInfo(value) {
  const url = parseSupportedUrl(value);
  const document = url ? getSheetDocument(url) : null;
  if (!document) {
    return null;
  }

  const sheetId = url.searchParams.get(document.parameter);
  if (!sheetId) {
    return null;
  }
  return { provider: document.provider, sheetId };
}

export function applyRequestedHash(existingValue, requestedValue) {
  const existingUrl = parseSupportedUrl(existingValue);
  const requestedUrl = parseSupportedUrl(requestedValue);
  if (!existingUrl || !requestedUrl || existingUrl.hash === requestedUrl.hash) {
    return null;
  }

  existingUrl.hash = requestedUrl.hash;
  return existingUrl.href;
}