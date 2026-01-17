import fs from "node:fs";
import path from "node:path";

function jsString(s) {
  return JSON.stringify(String(s ?? ""));
}

function pickLocatorExpr(target) {
  // Prefer the most stable hints first.
  const testId = target?.testId;
  if (testId) return `page.getByTestId(${jsString(testId)})`;

  const role = target?.role;
  const name = target?.accessibleName || target?.text || target?.ariaLabel;
  if (role && name) return `page.getByRole(${jsString(role)}, { name: ${jsString(name)} })`;

  const label = target?.labelText;
  if (label) return `page.getByLabel(${jsString(label)})`;

  const placeholder = target?.placeholder;
  if (placeholder) return `page.getByPlaceholder(${jsString(placeholder)})`;

  const id = target?.id;
  if (id) return `page.locator(${jsString("#" + id)})`;

  const css = target?.css;
  if (css) return `page.locator(${jsString(css)})`;

  // Last resort: tag selector (very weak)
  const tag = target?.tag;
  if (tag) return `page.locator(${jsString(tag)})`;

  return `page.locator("body")`;
}

function stepToCode(step, idx) {
  const loc = pickLocatorExpr(step?.target);

  if (step?.t === "type") {
    const value = step?.value ?? "";
    return [
      `  // step ${idx + 1}: type`,
      `  await ${loc}.fill(${jsString(value)});`,
      `  await page.waitForTimeout(50);`
    ].join("\n");
  }

  if (step?.t === "click") {
    return [
      `  // step ${idx + 1}: click`,
      `  await ${loc}.click();`,
      `  await page.waitForLoadState("domcontentloaded").catch(() => {});`
    ].join("\n");
  }

  return `  // step ${idx + 1}: unsupported step type ${jsString(step?.t)} (ignored)`;
}

function buildScript(tape, sourcePath) {
  const startUrl = tape?.startUrl || tape?.steps?.[0]?.url || "about:blank";
  const steps = Array.isArray(tape?.steps) ? tape.steps : [];

  const lines = [];
  lines.push(`// Generated from ${path.basename(sourcePath)} by browtool compiler`);
  lines.push(`import { chromium } from "playwright";`);
  lines.push(``);
  lines.push(`const TAPE_PATH = ${jsString(sourcePath)};`);
  lines.push(``);
  lines.push(`(async () => {`);
  lines.push(`  const browser = await chromium.launch({ headless: true });`);
  lines.push(`  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });`);
  lines.push(``);
  lines.push(`  page.on("console", (msg) => console.log("[console]", msg.type(), msg.text()));`);
  lines.push(`  page.on("pageerror", (err) => console.log("[pageerror]", err?.message || String(err)));`);
  lines.push(``);
  lines.push(`  await page.goto(${jsString(startUrl)}, { waitUntil: "domcontentloaded" });`);
  lines.push(``);
  steps.forEach((s, i) => lines.push(stepToCode(s, i), ``));
  lines.push(`  const finalUrl = page.url();`);
  lines.push(`  const html = await page.content();`);
  lines.push(`  console.log("FINAL_URL:", finalUrl);`);
  lines.push(`  console.log("HTML_LENGTH:", html.length);`);
  lines.push(``);
  lines.push(`  await page.screenshot({ path: "out/final.png", fullPage: true });`);
  lines.push(`  await fs.promises.writeFile("out/final.html", html, "utf-8");`);
  lines.push(``);
  lines.push(`  await browser.close();`);
  lines.push(`})();`);

  return `import fs from "node:fs";\n${lines.join("\n")}\n`;
}

function main() {
  const tapePathArg = process.argv[2];
  if (!tapePathArg) {
    console.error("Usage: node compile.mjs <path-to-browtool-tape.json>");
    process.exit(1);
  }

  const tapePath = path.isAbsolute(tapePathArg)
    ? tapePathArg
    : path.resolve(process.cwd(), tapePathArg);

  const outDir = path.resolve(process.cwd(), "out");
  fs.mkdirSync(outDir, { recursive: true });

  const raw = fs.readFileSync(tapePath, "utf-8");
  const tape = JSON.parse(raw);

  const script = buildScript(tape, tapePath);
  fs.writeFileSync(path.join(outDir, "playwright-script.mjs"), script, "utf-8");
  console.log("Wrote:", path.join(outDir, "playwright-script.mjs"));
}

main();

