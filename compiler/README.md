# BrowTool → Playwright compiler

This converts a BrowTool JSON tape into a runnable **headless** Playwright script.

## Install
From the repo root:

```bash
cd compiler
npm i
npx playwright install --with-deps chromium
```

## Compile a tape

```bash
cd compiler
node compile.mjs ../browtool_www.wikipedia.org__1768683148888.json
```

This writes:
- `compiler/out/playwright-script.mjs`

## Run the compiled script (headless)

```bash
cd compiler
node out/playwright-script.mjs
```

Artifacts:
- `compiler/out/final.png`
- `compiler/out/final.html`

## Notes
- Locator strategy is best-effort: `getByTestId` → `getByRole` → `getByLabel` → `getByPlaceholder` → `#id` → CSS fallback.
- For arbitrary sites, some replays will fail (CAPTCHA, bot detection, DOM drift). When that happens, we can improve the compiler to emit multi-locator fallbacks per step.

