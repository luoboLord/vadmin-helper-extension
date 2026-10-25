// Module entry for the extension service worker. Module workers cannot call
// importScripts, so the link helper's classic scripts are imported here in the
// same order background.js lists them, and background.js then skips its own
// importScripts. Tab reuse is an ES module tree and is imported afterwards.
import './data.js';
import './core.js';
import './entries.js';
import './workbook.js';
import './feishu-library.js';
import './feishu-sheet.js';
import './source-compare.js';
import './local-update.js';
import './github-update.js';
import './update-service.js';
import './background.js';
import './tab-reuse/background/service-worker.js';
