// Background service worker - coordinates recording
chrome.runtime.onInstalled.addListener(() => {
    console.log("Browser Action Recorder extension installed");
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "saveRecording") {
        // Download recording as JSONL (instead of uploading to a backend)
        downloadRecordingAsJsonl(request.recording)
            .then((result) => sendResponse({ success: true, result }))
            .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
        return true; // Keep channel open for async response
    }
});

function sanitizeFilenamePart(input) {
    const s = String(input || "").trim();
    // Keep it simple + cross-platform friendly
    return s
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80);
}

function formatTimestampForFilename(d = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function recordingToJsonl(recording) {
    const createdAt = new Date().toISOString();
    const header = {
        type: "recording",
        createdAt,
        name: recording?.name || "",
        description: recording?.description || "",
        initialUrl: recording?.initialUrl || "",
        actionCount: Array.isArray(recording?.actions) ? recording.actions.length : 0,
    };

    const lines = [JSON.stringify(header)];
    const actions = Array.isArray(recording?.actions) ? recording.actions : [];
    actions.forEach((action, index) => {
        lines.push(
            JSON.stringify({
                type: "action",
                index,
                ...action,
            })
        );
    });
    return lines.join("\n") + "\n";
}

async function downloadRecordingAsJsonl(recording) {
    if (!recording) throw new Error("No recording provided");

    const safeName = sanitizeFilenamePart(recording.name) || "recording";
    const filename = `${safeName}_${formatTimestampForFilename()}.jsonl`;
    const jsonl = recordingToJsonl(recording);

    const url = jsonlToDataUrl(jsonl);

    const downloadId = await chrome.downloads.download({
        url,
        filename,
        saveAs: true,
    });
    return { downloadId, filename };
}

function jsonlToDataUrl(jsonl) {
    const bytes = new TextEncoder().encode(jsonl);
    const base64 = base64FromBytes(bytes);
    return `data:application/jsonl;base64,${base64}`;
}

function base64FromBytes(bytes) {
    // Convert bytes -> binary string in chunks to avoid stack/arg limits.
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}
