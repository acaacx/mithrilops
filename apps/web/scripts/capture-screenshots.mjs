/**
 * Captures the README screenshots into docs/screenshots. Requires the dev
 * server: `pnpm dev`, then `node scripts/capture-screenshots.mjs`.
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:5173";
const outDir = fileURLToPath(new URL("../../../docs/screenshots/", import.meta.url));
mkdirSync(outDir, { recursive: true });

const shots = [
  ["/", "overview"],
  ["/pipelines/run-2210", "pipeline-run"],
  ["/security", "security"],
  ["/generator", "generator"],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
for (const [path, name] of shots) {
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}${name}.png` });
  console.log(`captured ${name}.png (${path})`);
}
await browser.close();
