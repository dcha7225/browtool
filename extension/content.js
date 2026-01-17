// Records basic user actions: click + type.
// Sends steps to the MV3 background service worker.

let RECORDING_ENABLED = false;
const TYPE_DEBOUNCE_MS = 700;
const pendingTypeByEl = new Map();

function now() {
  return Date.now();
}

function safeTrim(s, maxLen = 120) {
  if (!s) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function getTestId(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
  const attrs = ["data-testid", "data-test", "data-qa", "data-cy"];
  for (const a of attrs) {
    const v = el.getAttribute(a);
    if (v && safeTrim(v, 80)) return safeTrim(v, 80);
  }
  return null;
}

function getLabelText(el) {
  try {
    if (!el) return null;
    // Standard inputs/textarea/select have .labels
    if (el.labels && el.labels.length) {
      const t = safeTrim(el.labels[0]?.innerText || el.labels[0]?.textContent, 120);
      if (t) return t;
    }
    // Wrapped in label
    const wrapping = el.closest?.("label");
    if (wrapping) {
      const t = safeTrim(wrapping.innerText || wrapping.textContent, 120);
      if (t) return t;
    }
  } catch {
    // ignore
  }
  return null;
}

function bestEffortRole(el) {
  const role = el.getAttribute?.("role");
  if (role) return safeTrim(role, 60);
  // Some basic implicit roles (not exhaustive)
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a" && el.getAttribute("href")) return "link";
  if (tag === "input") {
    const t = (el.getAttribute("type") || "text").toLowerCase();
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    if (t === "submit" || t === "button") return "button";
    return "textbox";
  }
  if (tag === "textarea") return "textbox";
  return null;
}

function bestEffortAccessibleName(el) {
  const aria = el.getAttribute?.("aria-label");
  if (aria) return safeTrim(aria, 120);

  const labelledBy = el.getAttribute?.("aria-labelledby");
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    for (const id of ids) {
      const node = document.getElementById(id);
      const t = safeTrim(node?.innerText || node?.textContent, 120);
      if (t) return t;
    }
  }

  const labelText = getLabelText(el);
  if (labelText) return labelText;

  const tag = (el.tagName || "").toLowerCase();
  if (tag === "button" || tag === "a") {
    const t = safeTrim(el.innerText || el.textContent, 120);
    if (t) return t;
  }
  return null;
}

function isTextLikeInput(el) {
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "textarea") return true;
  if (tag !== "input") return false;
  const t = (el.getAttribute("type") || "text").toLowerCase();
  // exclude things that aren't "typed into"
  const excluded = new Set(["button", "submit", "reset", "checkbox", "radio", "file", "color", "range", "date", "datetime-local", "month", "week", "time", "hidden"]);
  return !excluded.has(t);
}

function shouldSkipTyping(el) {
  if (!el) return true;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input") {
    const t = (el.getAttribute("type") || "text").toLowerCase();
    if (t === "password") return true;
  }
  // Skip if readonly/disabled
  if (el.disabled) return true;
  if (el.readOnly) return true;
  return false;
}

function meaningfulTarget(startEl) {
  const el = startEl?.nodeType === Node.ELEMENT_NODE ? startEl : startEl?.parentElement;
  if (!el) return null;
  const candidate = el.closest?.(
    'button,a,input,textarea,select,label,[role],[contenteditable="true"],[contenteditable=""]'
  );
  return candidate || el;
}

function cssEscape(value) {
  // Minimal escape for attribute selector values.
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildCssFallback(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
  const id = el.getAttribute("id");
  if (id && safeTrim(id, 80) && !/\s/.test(id)) return `#${CSS.escape(id)}`;

  const tag = (el.tagName || "").toLowerCase();
  const stableAttrs = [];
  const nameAttr = el.getAttribute("name");
  const typeAttr = el.getAttribute("type");
  const ariaLabel = el.getAttribute("aria-label");
  const placeholder = el.getAttribute("placeholder");
  const testId = getTestId(el);

  if (testId) stableAttrs.push(`[data-testid="${cssEscape(testId)}"]`);
  else if (nameAttr) stableAttrs.push(`[name="${cssEscape(nameAttr)}"]`);
  else if (ariaLabel) stableAttrs.push(`[aria-label="${cssEscape(ariaLabel)}"]`);
  else if (placeholder) stableAttrs.push(`[placeholder="${cssEscape(placeholder)}"]`);
  if (tag === "input" && typeAttr) stableAttrs.push(`[type="${cssEscape(typeAttr)}"]`);

  // Build a short ancestry path (max 4 levels) to reduce collisions.
  const parts = [];
  let cur = el;
  for (let i = 0; i < 4 && cur && cur.nodeType === Node.ELEMENT_NODE; i++) {
    const t = (cur.tagName || "").toLowerCase();
    if (!t) break;
    let part = t;
    const curId = cur.getAttribute("id");
    if (curId && safeTrim(curId, 80) && !/\s/.test(curId)) {
      part += `#${CSS.escape(curId)}`;
      parts.unshift(part);
      break;
    }
    const curTestId = getTestId(cur);
    if (curTestId) part += `[data-testid="${cssEscape(curTestId)}"]`;
    parts.unshift(part);
    cur = cur.parentElement;
  }

  if (stableAttrs.length) return `${tag}${stableAttrs.join("")}`;
  if (parts.length) return parts.join(" > ");
  return tag || null;
}

function buildHints(el) {
  const tag = (el.tagName || "").toLowerCase();
  const id = el.getAttribute?.("id") || null;
  const nameAttr = el.getAttribute?.("name") || null;
  const typeAttr = el.getAttribute?.("type") || null;
  const placeholder = el.getAttribute?.("placeholder") || null;
  const ariaLabel = el.getAttribute?.("aria-label") || null;
  const testId = getTestId(el);
  const role = bestEffortRole(el);
  const accessibleName = bestEffortAccessibleName(el);
  const labelText = getLabelText(el);
  const text = safeTrim(el.innerText || el.textContent, 80) || null;

  return {
    tag,
    id: id ? safeTrim(id, 120) : null,
    nameAttr: nameAttr ? safeTrim(nameAttr, 120) : null,
    typeAttr: typeAttr ? safeTrim(typeAttr, 60) : null,
    testId,
    ariaLabel: ariaLabel ? safeTrim(ariaLabel, 120) : null,
    placeholder: placeholder ? safeTrim(placeholder, 120) : null,
    labelText,
    role,
    accessibleName,
    text,
    css: buildCssFallback(el)
  };
}

function buildBBox(el, clientX, clientY) {
  try {
    const r = el.getBoundingClientRect();
    const relX = typeof clientX === "number" ? clientX - r.left : null;
    const relY = typeof clientY === "number" ? clientY - r.top : null;
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      relX,
      relY
    };
  } catch {
    return null;
  }
}

function sendStep(step) {
  try {
    chrome.runtime.sendMessage({ type: "BT_RECORD_STEP", step });
  } catch {
    // ignore
  }
}

function recordClick(e) {
  if (!RECORDING_ENABLED) return;
  if (!e.isTrusted) return;
  const target = meaningfulTarget(e.target);
  if (!target) return;

  // Ignore clicks on our own extension UI if it ever gets injected (shouldn't).
  if (target.closest?.('[data-browtool-root="true"]')) return;

  const step = {
    t: "click",
    ts: now(),
    url: location.href,
    target: buildHints(target),
    bbox: buildBBox(target, e.clientX, e.clientY),
    modifiers: {
      altKey: !!e.altKey,
      ctrlKey: !!e.ctrlKey,
      metaKey: !!e.metaKey,
      shiftKey: !!e.shiftKey
    }
  };
  sendStep(step);
}

function flushType(el, kind = "fill") {
  const pending = pendingTypeByEl.get(el);
  if (!pending) return;

  const { value } = pending;
  pendingTypeByEl.delete(el);

  const target = meaningfulTarget(el);
  if (!target) return;

  const step = {
    t: "type",
    ts: now(),
    url: location.href,
    target: buildHints(target),
    value,
    kind
  };
  sendStep(step);
}

function scheduleType(el, value) {
  const prev = pendingTypeByEl.get(el);
  if (prev?.timer) clearTimeout(prev.timer);

  const timer = setTimeout(() => flushType(el, "fill"), TYPE_DEBOUNCE_MS);
  pendingTypeByEl.set(el, { value, timer });
}

function recordInput(e) {
  if (!RECORDING_ENABLED) return;
  if (!e.isTrusted) return;
  const el = meaningfulTarget(e.target);
  if (!el) return;

  const isEditable =
    isTextLikeInput(el) ||
    el.isContentEditable ||
    el.getAttribute?.("contenteditable") === "" ||
    el.getAttribute?.("contenteditable") === "true";
  if (!isEditable) return;
  if (shouldSkipTyping(el)) return;

  let value = "";
  if (isTextLikeInput(el) || (el.tagName || "").toLowerCase() === "textarea") {
    value = el.value ?? "";
  } else if (el.isContentEditable) {
    value = el.innerText ?? el.textContent ?? "";
  }

  // Keep it somewhat bounded.
  value = String(value);
  if (value.length > 5000) value = value.slice(0, 5000);

  scheduleType(el, value);
}

function recordChangeOrBlur(e) {
  if (!RECORDING_ENABLED) return;
  if (!e.isTrusted) return;
  const el = meaningfulTarget(e.target);
  if (!el) return;
  if (pendingTypeByEl.has(el)) flushType(el, "fill");
}

// Listen early.
window.addEventListener("click", recordClick, true);
window.addEventListener("input", recordInput, true);
window.addEventListener("change", recordChangeOrBlur, true);
window.addEventListener("blur", recordChangeOrBlur, true);

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg.type !== "string") return;
  if (msg.type === "BT_SET_RECORDING") {
    RECORDING_ENABLED = !!msg.enabled;
  }
});

// Handshake on load to sync state (best-effort).
try {
  chrome.runtime.sendMessage({ type: "BT_CONTENT_HELLO" }, (res) => {
    if (res && res.ok) RECORDING_ENABLED = !!res.recording;
  });
} catch {
  // ignore
}

