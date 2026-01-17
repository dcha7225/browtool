// Content script that captures DOM events
(function () {
    "use strict";

    let isRecording = false;
    let recordedActions = [];
    let initialUrl = null;
    let expectingNavigation = false;

    // Restore recording state from storage on page load
    chrome.storage.local.get(["recordingState"], (result) => {
        if (result.recordingState) {
            const state = result.recordingState;
            if (state.isRecording) {
                // Restore recording state after page reload
                isRecording = true;
                recordedActions = state.recordedActions || [];
                initialUrl = state.initialUrl;
                expectingNavigation = false;

                // Re-attach event listeners
                document.addEventListener("click", handleClick, true);
                document.addEventListener("input", handleInput, true);
                document.addEventListener("change", handleChange, true);

                console.log(
                    "Recording state restored after page reload. Actions so far:",
                    recordedActions.length
                );
            }
        }
    });

    // Listen for messages from popup/background
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "startRecording") {
            startRecording();
            sendResponse({ status: "started" });
        } else if (request.action === "stopRecording") {
            stopRecording();
            sendResponse({
                status: "stopped",
                actions: recordedActions,
                initialUrl: initialUrl,
            });
        } else if (request.action === "getRecordingStatus") {
            sendResponse({
                isRecording: isRecording,
                actionCount: recordedActions.length,
            });
        }
    });

    function saveRecordingState() {
        // Persist recording state to survive page reloads
        chrome.storage.local.set({
            recordingState: {
                isRecording: isRecording,
                recordedActions: recordedActions,
                initialUrl: initialUrl,
            },
        });
    }

    function clearRecordingState() {
        // Clear persisted state
        chrome.storage.local.remove(["recordingState"]);
    }

    function startRecording() {
        isRecording = true;
        recordedActions = [];
        initialUrl = window.location.href;
        expectingNavigation = false;

        // Save state to storage
        saveRecordingState();

        // Add event listeners
        document.addEventListener("click", handleClick, true);
        document.addEventListener("input", handleInput, true);
        document.addEventListener("change", handleChange, true);

        console.log("Recording started at:", initialUrl);
    }

    function stopRecording() {
        isRecording = false;
        expectingNavigation = false;

        // Clear persisted state
        clearRecordingState();

        // Remove event listeners
        document.removeEventListener("click", handleClick, true);
        document.removeEventListener("input", handleInput, true);
        document.removeEventListener("change", handleChange, true);

        console.log(
            "Recording stopped. Total actions:",
            recordedActions.length
        );
    }

    function handleClick(event) {
        if (!isRecording) return;

        const element = event.target;
        const selector = generateSelector(element);

        if (!selector) return;

        // Skip if clicking on extension UI or non-interactive elements
        if (element.closest("body") && isInteractiveElement(element)) {
            const action = {
                type: "click",
                selector: selector,
                timestamp: new Date().toISOString(),
            };

            recordedActions.push(action);
            console.log("Recorded click:", selector);

            // Save state after each action
            saveRecordingState();

            // Mark that we're expecting navigation (ignore next navigation event)
            expectingNavigation = true;

            // Reset expectingNavigation after a short delay
            setTimeout(() => {
                expectingNavigation = false;
            }, 1000);
        }
    }

    function handleInput(event) {
        if (!isRecording) return;

        const element = event.target;

        // Only record input events for text inputs, textareas, and contenteditable
        if (
            element.tagName === "INPUT" ||
            element.tagName === "TEXTAREA" ||
            element.isContentEditable
        ) {
            const selector = generateSelector(element);
            if (!selector) return;

            // Get the current value
            const text = element.value || element.textContent || "";

            // Check if this is a new input (not just a continuation)
            const lastAction = recordedActions[recordedActions.length - 1];
            if (
                lastAction &&
                lastAction.type === "type" &&
                lastAction.selector === selector
            ) {
                // Update the last type action with new text
                lastAction.text = text;
            } else {
                // Create new type action
                const action = {
                    type: "type",
                    selector: selector,
                    text: text,
                    timestamp: new Date().toISOString(),
                };
                recordedActions.push(action);
                console.log("Recorded type:", selector, text);

                // Save state after each action
                saveRecordingState();
            }
        }
    }

    function handleChange(event) {
        if (!isRecording) return;

        const element = event.target;

        // Handle select dropdowns - record as click on the select element
        if (element.tagName === "SELECT") {
            const selector = generateSelector(element);
            if (selector) {
                // For selects, we record the click that opened it (if any)
                // The change event indicates selection was made
                // We'll record this as a click on the selected option
                const selectedOption = element.options[element.selectedIndex];
                if (selectedOption) {
                    const optionSelector = `${selector} > option[value="${selectedOption.value}"]`;
                    const action = {
                        type: "click",
                        selector: optionSelector,
                        timestamp: new Date().toISOString(),
                    };
                    recordedActions.push(action);
                    console.log("Recorded select change:", optionSelector);

                    // Save state after each action
                    saveRecordingState();
                }
            }
        }
    }

    function isInteractiveElement(element) {
        const tagName = element.tagName.toLowerCase();
        const interactiveTags = ["a", "button", "input", "select", "textarea"];

        if (interactiveTags.includes(tagName)) {
            return true;
        }

        // Check for role attributes
        const role = element.getAttribute("role");
        if (role === "button" || role === "link" || role === "menuitem") {
            return true;
        }

        // Check for click handlers
        if (element.onclick || element.getAttribute("onclick")) {
            return true;
        }

        return false;
    }

    function generateSelector(element) {
        // Try ID first
        if (element.id) {
            return `#${element.id}`;
        }

        // Try unique class combination
        if (element.className && typeof element.className === "string") {
            const classes = element.className
                .trim()
                .split(/\s+/)
                .filter((c) => c);
            if (classes.length > 0) {
                const classSelector = "." + classes.join(".");
                const matches = document.querySelectorAll(classSelector);
                if (matches.length === 1) {
                    return classSelector;
                }
            }
        }

        // Try data attributes
        if (element.dataset.testid) {
            return `[data-testid="${element.dataset.testid}"]`;
        }
        if (element.dataset.id) {
            return `[data-id="${element.dataset.id}"]`;
        }

        // Try name attribute for form elements
        if (element.name) {
            return `[name="${element.name}"]`;
        }

        // Fallback to tag + nth-child
        const tagName = element.tagName.toLowerCase();
        const parent = element.parentElement;
        if (parent) {
            const siblings = Array.from(parent.children).filter(
                (child) => child.tagName.toLowerCase() === tagName
            );
            const index = siblings.indexOf(element);
            if (index >= 0) {
                return `${tagName}:nth-of-type(${index + 1})`;
            }
        }

        // Last resort: tag name
        return tagName;
    }
})();
