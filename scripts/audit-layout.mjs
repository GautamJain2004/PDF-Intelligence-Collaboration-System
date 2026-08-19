/**
 * Measures the real rendered geometry of the viewer panels.
 *
 *   node scripts/audit-layout.mjs
 *
 * A layout can typecheck, render, and still be unusable: the failure mode here
 * was panels whose scroll area collapsed to ~100px, so comment bodies were
 * pushed out of view. Screenshots do not catch that reliably; measuring the
 * boxes does. Also captures PNGs for eyeballing.
 */
import { chromium } from 'playwright-core';
import path from 'node:path';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const PDF = path.resolve('sample-data/Agreement_v3.pdf');

const VIEWPORTS = [
  { name: 'laptop-1920x850', width: 1920, height: 850 },
  { name: 'laptop-1440x800', width: 1440, height: 800 },
  { name: 'tablet-1024x768', width: 1024, height: 768 },
  { name: 'phone-390x844', width: 390, height: 844 },
];

let bad = 0;
const check = (label, ok, detail = '') => {
  console.log(`     ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) bad++;
};

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ channel, headless: true }); } catch {}
  }
  throw new Error('no browser');
}

const browser = await launch();

// One account + upload, reused across viewports.
const ctx = await browser.newContext({ viewport: { width: 1920, height: 850 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
// Wait for hydration: clicking before React attaches handlers triggers a native
// form submit that never reaches /dashboard.
await page.waitForFunction(() => {
  const b = document.querySelector('button[type=submit]');
  return Boolean(b) && !b.disabled;
}, { timeout: 60_000 });
await page.waitForTimeout(1500);
await page.fill('#name', 'Layout Auditor');
await page.fill('#email', `layout-${Date.now()}@example.com`);
await page.fill('#password', 'layout-password-1');
await Promise.all([
  page.waitForURL('**/dashboard', { timeout: 90_000 }),
  page.click('button[type=submit]'),
]);
await page.setInputFiles('input[type=file]', PDF);
await page.waitForSelector('text=AI summary', { timeout: 240_000 });
// The dashboard polls while documents process, so the card can re-render out
// from under a click. Read the href and navigate directly instead.
const docHref = await page
  .locator('a[href^="/documents/"]')
  .first()
  .getAttribute('href');
await page.goto(`${BASE}${docHref}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas.react-pdf__Page__canvas', { timeout: 90_000 });

// Leave a comment so the thread has content to measure.
await page.getByRole('tab', { name: 'Comments' }).click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: /Add a comment/ }).click();
const ed = page.locator('.tiptap').first();
await ed.waitFor({ state: 'visible', timeout: 20_000 });
await ed.click();
await page.keyboard.type('This is a comment body that must be fully visible in the panel, not clipped.');
await page.getByRole('button', { name: 'Comment', exact: true }).click();
// Wait for the posted comment itself. Waiting on the typed text matched the
// editor's own content and passed even when the submit had not landed.
await page.waitForSelector('.comment-body:not(.tiptap)', { timeout: 30_000 });
await page.waitForTimeout(800);

for (const vp of VIEWPORTS) {
  console.log(`\n▸ ${vp.name}`);
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(1200);

  if (vp.width < 1024) {
    await page.getByRole('button', { name: 'Comments' }).last().click();
    await page.waitForTimeout(400);
    await page.getByRole('tab', { name: 'Comments' }).click();
    await page.waitForTimeout(800);
  }

  const m = await page.evaluate(() => {
    const box = (el) => (el ? el.getBoundingClientRect() : null);
    const vis = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const commentBody = document.querySelector('.comment-body:not(.tiptap)');
    const scroller = [...document.querySelectorAll('.scrollbar-thin')].find((e) => {
      const r = e.getBoundingClientRect();
      return r.height > 0 && e.querySelector('.comment-body:not(.tiptap)');
    });
    const header = document.querySelector('header');
    return {
      headerH: Math.round(box(header)?.height ?? 0),
      threadScrollerH: Math.round(box(scroller)?.height ?? 0),
      commentBodyVisible: vis(commentBody),
      commentBodyText: commentBody?.textContent?.slice(0, 40) ?? null,
      commentBodyInView: (() => {
        if (!commentBody || !scroller) return false;
        const c = commentBody.getBoundingClientRect();
        const s = scroller.getBoundingClientRect();
        return c.top >= s.top - 2 && c.bottom <= s.bottom + 2;
      })(),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      verticalOverflow: document.documentElement.scrollHeight > window.innerHeight + 1,
      docScrollHeight: document.documentElement.scrollHeight,
    };
  });

  check('header is compact', m.headerH <= 160, `${m.headerH}px`);
  check('thread scroll area has usable height', m.threadScrollerH >= 150, `${m.threadScrollerH}px`);
  check('comment body rendered', m.commentBodyVisible, m.commentBodyText ?? 'none');
  check('comment body fully inside its scroller', m.commentBodyInView);
  check('no horizontal page overflow', !m.horizontalOverflow);
  check(
    'page does not overflow the viewport vertically',
    !m.verticalOverflow,
    `content ${m.docScrollHeight}px vs viewport ${vp.height}px`,
  );

  await page.screenshot({ path: `/tmp/layout-${vp.name}.png` });
}

await browser.close();
console.log(`\n${bad === 0 ? 'LAYOUT AUDIT PASSED' : bad + ' LAYOUT CHECK(S) FAILED'}`);
process.exit(bad === 0 ? 0 : 1);
