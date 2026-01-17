# BrowTool Recorder (Chrome Extension)

Records the simplest browser actions:
- Click
- Type (debounced; **password inputs are skipped**)

Exports a JSON "tape" you can translate into Playwright/Puppeteer/Selenium later.

## Install (Load Unpacked)
1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select this folder (`browTool/`)

## Record
1. Go to any website
2. Click the extension icon (puzzle piece → pin it if you want)
3. Click **Start**
4. Perform clicks + typing
5. Click **Stop** (optional)
6. Click **Export JSON** to download your tape

## What gets exported
The JSON includes:
- `startUrl`
- `steps[]` with `t` ("click" | "type"), `url`, timestamp, and element hints (`role`, `labelText`, `ariaLabel`, `text`, `css`, etc.)

## Notes / limitations (by design for v0)
- No assertions, no navigation steps, no iframe/shadow-DOM handling.
- Element locators are *hints*; arbitrary sites can change. For reliable replay, your translator/runner should try multiple strategies (role/label/text/css/bbox).

