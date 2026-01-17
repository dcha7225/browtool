const $ = (id) => document.getElementById(id);

const statusPill = $("statusPill");
const stepsCount = $("stepsCount");
const startUrl = $("startUrl");
const msg = $("msg");

const btnStart = $("btnStart");
const btnStop = $("btnStop");
const btnExport = $("btnExport");
const btnClear = $("btnClear");

function setMsg(text) {
  msg.textContent = text || "";
}

function setRecordingUI(on) {
  statusPill.textContent = on ? "ON" : "OFF";
  statusPill.classList.toggle("pill--on", on);
  statusPill.classList.toggle("pill--off", !on);

  btnStart.disabled = on;
  btnStop.disabled = !on;
}

function setMeta({ steps = 0, url = null } = {}) {
  stepsCount.textContent = String(steps);
  startUrl.textContent = url || "—";
  startUrl.title = url || "";
}

function send(type) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type }, (res) => resolve(res));
  });
}

async function refresh() {
  const res = await send("BT_POPUP_GET_STATUS");
  if (!res?.ok) {
    setMsg(res?.error || "Unable to read status.");
    setRecordingUI(false);
    setMeta({ steps: 0, url: null });
    return;
  }
  setMsg("");
  setRecordingUI(!!res.recording);
  setMeta({ steps: res.stepsCount || 0, url: res.startUrl || null });
}

btnStart.addEventListener("click", async () => {
  setMsg("Starting…");
  const res = await send("BT_POPUP_START");
  setMsg(res?.ok ? "Recording enabled." : res?.error || "Failed to start.");
  await refresh();
});

btnStop.addEventListener("click", async () => {
  setMsg("Stopping…");
  const res = await send("BT_POPUP_STOP");
  setMsg(res?.ok ? "Recording stopped." : res?.error || "Failed to stop.");
  await refresh();
});

btnClear.addEventListener("click", async () => {
  setMsg("Clearing…");
  const res = await send("BT_POPUP_CLEAR");
  setMsg(res?.ok ? "Cleared." : res?.error || "Failed to clear.");
  await refresh();
});

btnExport.addEventListener("click", async () => {
  setMsg("Exporting…");
  const res = await send("BT_POPUP_EXPORT_JSON");
  setMsg(res?.ok ? "Download started." : res?.error || "Failed to export.");
  await refresh();
});

refresh().catch(() => setMsg("Error initializing popup."));

