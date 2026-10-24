import { MESSAGE_TYPES } from "./shared/messages.js";

const enabledToggle = document.querySelector("#tab-reuse-enabled");
const statusDescription = document.querySelector("#tab-reuse-status");
const reuseCount = document.querySelector("#tab-reuse-count");
const lastReuse = document.querySelector("#tab-reuse-last");
const cleanupSummary = document.querySelector("#tab-reuse-cleanup-summary");
const cleanupButton = document.querySelector("#tab-reuse-cleanup");
const feedback = document.querySelector("#tab-reuse-feedback");

// The tabs the confirm button names; only these are closed on confirmation.
let confirmedTabIds = null;
let confirmationTimer = null;

async function sendMessage(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) {
    throw new Error(response?.error || "扩展暂时无法响应。");
  }
  return response.data;
}

function showFeedback(message, isError = false) {
  feedback.textContent = message;
  feedback.classList.toggle("error", isError);
}

function renderStatus(state) {
  enabledToggle.checked = state.enabled;
  enabledToggle.disabled = false;
  statusDescription.textContent = state.enabled
    ? "重复打开同一网页时，自动切回已有标签"
    : "已暂停，新打开的标签按Chrome原有方式打开";
  reuseCount.textContent = new Intl.NumberFormat("zh-CN").format(state.reuseCount);

  if (!state.lastReuse?.timestamp) {
    lastReuse.textContent = "尚无记录";
    return;
  }

  const time = new Date(state.lastReuse.timestamp).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  lastReuse.textContent = state.lastReuse.hostname
    ? `${time} · ${state.lastReuse.hostname}`
    : time;
}

function resetConfirmation() {
  confirmedTabIds = null;
  if (confirmationTimer) {
    clearTimeout(confirmationTimer);
    confirmationTimer = null;
  }
  cleanupButton.classList.remove("confirming");
  cleanupButton.classList.add("secondary");
  cleanupButton.textContent = "一键整理";
}

function renderScan(summary) {
  resetConfirmation();
  cleanupButton.disabled = summary.closeCount === 0;

  if (summary.closeCount === 0) {
    cleanupSummary.textContent = summary.skippedCount > 0
      ? `没有可安全关闭的重复标签，已保护 ${summary.skippedCount} 个`
      : "当前没有可整理的重复标签";
    return;
  }

  cleanupSummary.textContent = `发现 ${summary.groupCount} 组重复页，可安全关闭 ${summary.closeCount} 个标签`;
}

async function refreshScan() {
  cleanupButton.disabled = true;
  cleanupSummary.textContent = "正在扫描…";
  const summary = await sendMessage(MESSAGE_TYPES.SCAN_DUPLICATES);
  renderScan(summary);
  return summary;
}

enabledToggle.addEventListener("change", async () => {
  enabledToggle.disabled = true;
  showFeedback("");
  try {
    const state = await sendMessage(MESSAGE_TYPES.SET_ENABLED, {
      enabled: enabledToggle.checked,
    });
    renderStatus(state);
    showFeedback(state.enabled ? "标签复用已开启" : "标签复用已暂停");
  } catch (error) {
    enabledToggle.checked = !enabledToggle.checked;
    enabledToggle.disabled = false;
    showFeedback(error.message, true);
  }
});

cleanupButton.addEventListener("click", async () => {
  showFeedback("");

  if (!confirmedTabIds) {
    try {
      const summary = await refreshScan();
      if (summary.closeIds.length === 0) {
        return;
      }
      confirmedTabIds = summary.closeIds;
      cleanupButton.classList.remove("secondary");
      cleanupButton.classList.add("confirming");
      cleanupButton.textContent = `确认关闭 ${confirmedTabIds.length} 个标签`;
      confirmationTimer = setTimeout(resetConfirmation, 6000);
    } catch (error) {
      showFeedback(error.message, true);
    }
    return;
  }

  cleanupButton.disabled = true;
  try {
    const result = await sendMessage(MESSAGE_TYPES.CLEANUP_DUPLICATES, {
      tabIds: confirmedTabIds,
    });
    resetConfirmation();
    const skippedText = result.skippedCount > 0
      ? `，另有 ${result.skippedCount} 个受保护标签未关闭`
      : "";
    const changedText = result.changedCount > 0
      ? `，${result.changedCount} 个标签状态已变化，未关闭`
      : "";
    showFeedback(`已关闭 ${result.closedCount} 个重复标签${skippedText}${changedText}`);
    await refreshScan();
  } catch (error) {
    resetConfirmation();
    showFeedback(error.message, true);
    try {
      await refreshScan();
    } catch {
      cleanupButton.disabled = true;
    }
  }
});

Promise.all([
  sendMessage(MESSAGE_TYPES.GET_STATUS),
  sendMessage(MESSAGE_TYPES.SCAN_DUPLICATES),
])
  .then(([state, summary]) => {
    renderStatus(state);
    renderScan(summary);
  })
  .catch((error) => {
    enabledToggle.disabled = true;
    cleanupButton.disabled = true;
    statusDescription.textContent = "无法读取标签复用状态";
    cleanupSummary.textContent = "扫描失败";
    showFeedback(error.message, true);
  });
