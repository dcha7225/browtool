// MV3 service worker (module)
// Stores steps per tab and toggles recording state.

const STORAGE_KEY = "browtool:tapeByTab";
const STATE_KEY = "browtool:stateByTab";

async function getFromStorage(key, fallback) {
  const res = await chrome.storage.local.get([key]);
  return res[key] ?? fallback;
}

async function setInStorage(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function getTapeByTab() {
  return await getFromStorage(STORAGE_KEY, {});
}

async function getStateByTab() {
  return await getFromStorage(STATE_KEY, {});
}

async function setRecording(tabId, enabled) {
  const stateByTab = await getStateByTab();
  stateByTab[String(tabId)] = { recording: !!enabled, updatedAt: Date.now() };
  await setInStorage(STATE_KEY, stateByTab);

  // Notify content script (best-effort).
  try {
    await chrome.tabs.sendMessage(tabId, { type: "BT_SET_RECORDING", enabled: !!enabled });
  } catch {
    // Tab may not have content script yet (chrome:// pages, extension pages, etc.)
  }
}

async function ensureTabTape(tabId) {
  const tapeByTab = await getTapeByTab();
  const key = String(tabId);
  if (!tapeByTab[key]) {
    tapeByTab[key] = {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startUrl: null,
      steps: []
    };
    await setInStorage(STORAGE_KEY, tapeByTab);
  }
  return tapeByTab[key];
}

async function appendStep(tabId, step) {
  const tapeByTab = await getTapeByTab();
  const key = String(tabId);
  const tape = tapeByTab[key] ?? {
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startUrl: null,
    steps: []
  };

  if (!tape.startUrl && step?.url) tape.startUrl = step.url;
  tape.steps.push(step);
  tape.updatedAt = Date.now();
  tapeByTab[key] = tape;
  await setInStorage(STORAGE_KEY, tapeByTab);
}

async function clearTape(tabId) {
  const tapeByTab = await getTapeByTab();
  delete tapeByTab[String(tabId)];
  await setInStorage(STORAGE_KEY, tapeByTab);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function downloadFile({ url, filename, saveAs = true }) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs,
        conflictAction: "uniquify"
      },
      (downloadId) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(downloadId);
      }
    );
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || typeof msg.type !== "string") return;

    // Content script handshake: return current recording state for this tab.
    if (msg.type === "BT_CONTENT_HELLO") {
      const tabId = sender?.tab?.id;
      if (typeof tabId !== "number") {
        sendResponse({ ok: false, recording: false });
        return;
      }
      const stateByTab = await getStateByTab();
      const state = stateByTab[String(tabId)] ?? { recording: false };
      sendResponse({ ok: true, recording: !!state.recording });
      return;
    }

    // From content script.
    if (msg.type === "BT_RECORD_STEP") {
      const tabId = sender?.tab?.id;
      if (typeof tabId !== "number") return;

      const stateByTab = await getStateByTab();
      const state = stateByTab[String(tabId)];
      if (!state?.recording) return; // ignore if not recording

      await ensureTabTape(tabId);
      await appendStep(tabId, msg.step);
      return;
    }

    // From popup.
    if (msg.type === "BT_POPUP_GET_STATUS") {
      const tab = await getActiveTab();
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No active tab." });
        return;
      }
      const stateByTab = await getStateByTab();
      const tapeByTab = await getTapeByTab();
      const state = stateByTab[String(tab.id)] ?? { recording: false };
      const tape = tapeByTab[String(tab.id)] ?? null;
      sendResponse({
        ok: true,
        tabId: tab.id,
        recording: !!state.recording,
        stepsCount: tape?.steps?.length ?? 0,
        startUrl: tape?.startUrl ?? null,
        updatedAt: tape?.updatedAt ?? null
      });
      return;
    }

    if (msg.type === "BT_POPUP_START") {
      const tab = await getActiveTab();
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No active tab." });
        return;
      }
      await ensureTabTape(tab.id);
      await setRecording(tab.id, true);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "BT_POPUP_STOP") {
      const tab = await getActiveTab();
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No active tab." });
        return;
      }
      await setRecording(tab.id, false);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "BT_POPUP_CLEAR") {
      const tab = await getActiveTab();
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No active tab." });
        return;
      }
      await clearTape(tab.id);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "BT_POPUP_GET_TAPE") {
      const tab = await getActiveTab();
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No active tab." });
        return;
      }
      const tapeByTab = await getTapeByTab();
      const tape = tapeByTab[String(tab.id)] ?? null;
      sendResponse({ ok: true, tape });
      return;
    }

    if (msg.type === "BT_POPUP_EXPORT_JSON") {
      const tab = await getActiveTab();
      if (!tab?.id) {
        sendResponse({ ok: false, error: "No active tab." });
        return;
      }
      const tapeByTab = await getTapeByTab();
      const tape = tapeByTab[String(tab.id)] ?? null;
      if (!tape) {
        sendResponse({ ok: false, error: "Nothing recorded yet." });
        return;
      }

      // MV3 service workers can be finicky with Blob/object URLs across Chrome versions.
      // A data: URL is more consistently downloadable.
      const json = JSON.stringify(tape, null, 2);
      const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
      const filenameSafe = (tape.startUrl || "tape")
        .replace(/^https?:\/\//, "")
        .replace(/[^a-z0-9._-]+/gi, "_")
        .slice(0, 80);

      await downloadFile({
        url,
        filename: `browtool_${filenameSafe}_${Date.now()}.json`,
        saveAs: true
      });
      sendResponse({ ok: true });
      return;
    }
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err?.message ?? err) });
  });

  // Keep message channel open for async sendResponse.
  return true;
});

// Keep recording state tidy when tabs close.
chrome.tabs.onRemoved.addListener((tabId) => {
  (async () => {
    const stateByTab = await getStateByTab();
    delete stateByTab[String(tabId)];
    await setInStorage(STATE_KEY, stateByTab);
  })().catch(() => {});
});

