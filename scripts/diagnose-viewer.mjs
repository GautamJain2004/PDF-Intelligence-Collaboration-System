/**
 * Diagnostic for the PDF viewer. Dumps every console message, request failure,
 * and the rendered DOM around the viewer so the actual cause is visible.
 *
 *   node scripts/diagnose-viewer.mjs
 */
import { chromium } from 'playwright-core';
import path from 'node:path';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const PDF = path.resolve('sample-data/Agreement_v3.pdf');

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* try next */
    }
  }
  throw new Error('no browser');
}

const browser = await launch();
const page = await (await browser.newContext()).newPage();

page.on('console', (m) => console.log(`  [console.${m.type()}] ${m.text().slice(0, 400)}`));
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message.slice(0, 400)}`));
page.on('requestfailed', (r) =>
  console.log(`  [reqfail] ${r.url().slice(0, 140)} :: ${r.failure()?.errorText}`),
);
page.on('response', (r) => {
  if (r.status() >= 400) console.log(`  [http ${r.status()}] ${r.url().slice(0, 140)}`);
});

console.log('\n=== signup + upload ===');
const email = `diag-${Date.now()}@example.com`;
await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
await page.fill('#name', 'Diag');
await page.fill('#email', email);
await page.fill('#password', 'diagnostic-password');
await page.click('button[type=submit]');
await page.waitForURL('**/dashboard', { timeout: 60_000 });
await page.setInputFiles('input[type=file]', PDF);
await page.waitForSelector('text=AI summary', { timeout: 180_000 });

console.log('\n=== opening document ===');
await page.click('a[href^="/documents/"]');
await page.waitForURL('**/documents/**', { timeout: 60_000 });
await page.waitForTimeout(20_000);

console.log('\n=== DOM state ===');
const state = await page.evaluate(() => {
  const q = (s) => document.querySelectorAll(s).length;
  const doc = document.querySelector('.react-pdf__Document');
  const err = [...document.querySelectorAll('[role=alert], .text-destructive')]
    .map((e) => e.textContent?.trim())
    .filter(Boolean);
  return {
    documentWrappers: q('.react-pdf__Document'),
    pageWrappers: q('.react-pdf__Page'),
    canvases: q('canvas'),
    pdfCanvases: q('canvas.react-pdf__Page__canvas'),
    dataPageDivs: q('[data-page]'),
    workerSrc: window.pdfjsWorkerSrcDebug ?? null,
    docHtml: doc ? doc.innerHTML.slice(0, 500) : null,
    visibleErrors: err.slice(0, 5),
    bodyText: document.body.innerText.slice(0, 600),
  };
});
console.log(JSON.stringify(state, null, 2));

await browser.close();
