/**
 * Headless browser smoke test for the PDF viewer.
 *
 *   node scripts/smoke-viewer.mjs
 *
 * The viewer failure mode that matters (pdf.js failing to initialise under the
 * bundler) only appears at runtime in a real browser — it compiles fine and the
 * server returns 200. This drives an actual browser through signup, upload,
 * and rendering, and fails loudly on any console error or unrendered page.
 *
 * Uses the system Edge/Chrome rather than downloading a browser.
 */
import { chromium } from 'playwright-core';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const PDF = path.resolve('sample-data/Agreement_v3.pdf');

const CHANNELS = ['msedge', 'chrome'];

async function launch() {
  let lastError;
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not launch a browser (${CHANNELS.join(', ')}): ${lastError}`);
}

async function main() {
  if (!existsSync(PDF)) {
    throw new Error(`Missing ${PDF}. Run: npx tsx scripts/make-sample-pdf.ts`);
  }

  const browser = await launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const step = (s) => console.log(`\n▸ ${s}`);
  let failed = false;
  const check = (label, ok, detail = '') => {
    console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) failed = true;
  };

  try {
    step('Sign up');
    const email = `smoke-${Date.now()}@example.com`;
    await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
    await page.fill('#name', 'Smoke Tester');
    await page.fill('#email', email);
    await page.fill('#password', 'smoke-test-password');
    await page.click('button[type=submit]');
    await page.waitForURL('**/dashboard', { timeout: 60_000 });
    check('reached dashboard', true);

    step('Upload PDF');
    await page.setInputFiles('input[type=file]', PDF);
    // Ingest runs synchronously; the card flips to a summary when done.
    await page.waitForSelector('text=AI summary', { timeout: 180_000 });
    check('summary rendered on dashboard', true);

    step('Open document');
    await page.click('a[href^="/documents/"]');
    await page.waitForURL('**/documents/**', { timeout: 60_000 });

    step('PDF renders');
    // The real assertion: pdf.js produced a canvas with actual pixels.
    await page.waitForSelector('canvas.react-pdf__Page__canvas', { timeout: 90_000 });
    const canvas = await page.evaluate(() => {
      const c = document.querySelector('canvas.react-pdf__Page__canvas');
      return c ? { w: c.width, h: c.height } : null;
    });
    check('canvas present', Boolean(canvas), canvas ? `${canvas.w}x${canvas.h}` : 'none');
    check('canvas has real dimensions', Boolean(canvas && canvas.w > 100 && canvas.h > 100));

    const pageCount = await page.locator('canvas.react-pdf__Page__canvas').count();
    check('all pages rendered', pageCount >= 4, `${pageCount} canvases`);

    step('Toolbar');
    const total = await page.textContent('text=/^\\/ \\d+$/').catch(() => null);
    check('page count shown in toolbar', Boolean(total), total ?? '');

    step('Console errors');
    const pdfErrors = errors.filter(
      (e) => /pdf|defineProperty|webpack/i.test(e) && !/favicon/i.test(e),
    );
    check('no pdf.js / bundler errors', pdfErrors.length === 0, pdfErrors.slice(0, 3).join(' | '));

    if (errors.length) {
      console.log('\n   (all console errors seen:)');
      for (const e of errors.slice(0, 10)) console.log('     - ' + e.slice(0, 160));
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${failed ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED'}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\nSMOKE TEST ERROR:\n', e);
  process.exit(1);
});
