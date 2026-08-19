/**
 * Browser test for the sharing and guest-commenting requirements.
 *
 *   node scripts/smoke-sharing.mjs
 *
 * Covers, as a real user would:
 *   - owner generates a unique share link from the UI
 *   - a visitor with NO account and NO cookies opens that link
 *   - the visitor identifies themselves and sees the full PDF rendered
 *   - the visitor comments; the owner sees it and replies (threading)
 *   - a read-only link can read but not comment
 *   - revoking a link cuts off a visitor who already has access
 *
 * Uses two isolated browser contexts so the "guest" genuinely shares no session
 * state with the owner — testing this in one context would prove nothing.
 */
import { chromium } from 'playwright-core';
import path from 'node:path';
import { existsSync } from 'node:fs';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const PDF = path.resolve('sample-data/Agreement_v3.pdf');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};
const step = (s) => console.log(`\n▸ ${s}`);

/**
 * Fills a controlled input and waits until the form actually reacts.
 *
 * Before hydration, `fill` updates the DOM node but not React's state, so a
 * state-gated submit button stays disabled forever. Re-filling after hydration
 * settles it.
 */
async function fillWhenLive(page, selector, value, submitSelector) {
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.fill(selector, value);
    try {
      await page.waitForFunction(
        (sel) => {
          const b = document.querySelector(sel);
          return Boolean(b) && !b.disabled;
        },
        submitSelector,
        { timeout: 3000 },
      );
      return;
    } catch {
      await page.waitForTimeout(500);
    }
  }
  throw new Error(`${selector} never enabled ${submitSelector}`);
}

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* next */
    }
  }
  throw new Error('no usable browser found');
}

async function main() {
  if (!existsSync(PDF)) throw new Error(`Missing ${PDF} — run scripts/make-sample-pdf.ts`);

  const browser = await launch();

  // --- Owner -------------------------------------------------------------
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const ownerErrors = [];
  owner.on('pageerror', (e) => ownerErrors.push(e.message));

  step('Owner: sign up and upload');
  await owner.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
  // Submitting before hydration falls back to a native form post.
  await owner.waitForFunction(
    () => {
      const b = document.querySelector('button[type=submit]');
      return Boolean(b) && !b.disabled;
    },
    { timeout: 60_000 },
  );
  await owner.fill('#name', 'Document Owner');
  await owner.fill('#email', `owner-${Date.now()}@example.com`);
  await owner.fill('#password', 'owner-password-123');
  await Promise.all([
    owner.waitForURL('**/dashboard', { timeout: 90_000 }),
    owner.click('button[type=submit]'),
  ]);
  await owner.setInputFiles('input[type=file]', PDF);
  await owner.waitForSelector('text=AI summary', { timeout: 180_000 });
  check('document uploaded and summarised', true);

  step('Owner: generate a share link from the UI');
  const docHref = await owner
    .locator('a[href^="/documents/"]')
    .first()
    .getAttribute('href');
  await owner.goto(`${BASE}${docHref}`, { waitUntil: 'domcontentloaded' });
  await owner.waitForSelector('canvas.react-pdf__Page__canvas', { timeout: 90_000 });
  await owner.click('button:has-text("Share")');
  await owner.waitForSelector('text=Share document', { timeout: 20_000 });
  await owner.click('button:has-text("Create a link to copy")');
  // The URL lives in the single "Active link" block now, not a separate box.
  await owner.waitForFunction(
    () => !document.body.innerText.includes('No active link'),
    undefined,
    { timeout: 30_000 },
  );

  // Whitespace stripped: the link wraps with `break-all` for narrow dialogs.
  const shareUrl = (await owner.locator('code').first().innerText()).replace(/\s+/g, '');
  const looksUnguessable = /\/s\/[A-Za-z0-9_-]{40,}$/.test(shareUrl);
  check('share link generated', Boolean(shareUrl), shareUrl.replace(/\/s\/.*/, '/s/<token>'));
  check('token is long and random', looksUnguessable, `${shareUrl.split('/s/')[1]?.length} chars`);

  // Close the dialog before interacting with the page behind it.
  await owner.keyboard.press('Escape');

  // --- Guest: brand-new context, no cookies, no account -------------------
  step('Guest: open the link with no account and no cookies');
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  const guestErrors = [];
  guest.on('pageerror', (e) => guestErrors.push(e.message));

  await guest.goto(shareUrl, { waitUntil: 'networkidle' });

  const cookies = await guestCtx.cookies();
  check('guest has no session cookie', !cookies.some((c) => c.name === 'pdfiq_session'));

  const sawPrompt = await guest.isVisible('#guestEmail');
  check('offered guest entry without signup', sawPrompt);
  check(
    'sign-in alternative offered',
    await guest.isVisible('a:has-text("Sign in to your account")'),
  );
  const sawSummary = await guest.isVisible('text=AI summary');
  check('AI summary shown before entering', sawSummary);

  await guest.fill('#displayName', 'Jordan Guest');
  // Email is what gates the submit button now, so it settles hydration.
  await fillWhenLive(guest, '#guestEmail', 'jordan.guest@example.com', 'button[type=submit]');
  await guest.click('button:has-text("Continue as guest")');

  step('Guest: full PDF renders');
  await guest.waitForSelector('canvas.react-pdf__Page__canvas', { timeout: 90_000 });
  const canvasCount = await guest.locator('canvas.react-pdf__Page__canvas').count();
  const dims = await guest.evaluate(() => {
    const c = document.querySelector('canvas.react-pdf__Page__canvas');
    return c ? { w: c.width, h: c.height } : null;
  });
  check('PDF canvas rendered for guest', Boolean(dims), dims ? `${dims.w}x${dims.h}` : 'none');
  check('all pages rendered for guest', canvasCount >= 4, `${canvasCount} pages`);

  step('Guest: comment in the sidebar');
  await guest.getByRole('tab', { name: 'Comments' }).click();
  await guest.waitForTimeout(600);
  await guest.getByRole('button', { name: /Add a comment/ }).click();
  // Exactly one editor should exist now — three used to be mounted at once.
  const editorCountGuest = await guest.locator('.tiptap').count();
  check('single comment editor mounted', editorCountGuest === 1, `${editorCountGuest} found`);

  const commentEditor = guest.locator('.tiptap').first();
  await commentEditor.waitFor({ state: 'visible', timeout: 30_000 });
  await commentEditor.click();
  await guest.keyboard.type('Guest here — the notice period looks unusual.');
  // Exact match: "Comment" would otherwise also select the "Comments" tab.
  await guest.getByRole('button', { name: 'Comment', exact: true }).click();
  await guest.waitForSelector('.comment-body:not(.tiptap)', { timeout: 30_000 });
  check('guest comment posted without an account', true);
  check('guest attributed by display name', await guest.isVisible('text=Jordan Guest'));

  step('Owner: sees the guest comment and replies');
  await owner.reload({ waitUntil: 'networkidle' });
  await owner.getByRole('tab', { name: 'Comments' }).click();
  await owner.waitForSelector('text=Guest here', { timeout: 60_000 });
  check('owner sees the guest comment', true);

  const guestComment = owner.locator('text=Guest here').first();
  await guestComment.hover();
  await owner.getByRole('button', { name: 'Reply', exact: true }).first().click();

  // The reply editor mounts inline under the comment being replied to.
  const replyEditor = owner.locator('.tiptap').first();
  await replyEditor.waitFor({ state: 'visible', timeout: 20_000 });
  await replyEditor.click();
  await owner.keyboard.type('Owner reply: it is three months after probation.');
  // The submit button inside the reply editor, not the "Reply" affordance.
  await owner.getByRole('button', { name: 'Reply', exact: true }).last().click();
  await owner.waitForSelector('text=Owner reply', { timeout: 30_000 });
  check('owner replied (threaded)', true);

  step('Guest: sees the threaded reply');
  await guest.reload({ waitUntil: 'networkidle' });
  await guest.getByRole('tab', { name: 'Comments' }).click();
  await guest.waitForSelector('text=Owner reply', { timeout: 60_000 });
  check('guest sees owner reply in thread', true);
  check('owner badge shown on owner comment', await guest.isVisible('text=Owner'));

  step('Read-only link cannot comment');
  await owner.click('button:has-text("Share")');
  await owner.waitForSelector('text=Share document', { timeout: 20_000 });
  await owner.click('button:has-text("Read only")');
  await owner.click('button:has-text("Create a link to copy")');
  await owner.waitForFunction(
    (previous) => {
      const el = document.querySelector('code');
      return Boolean(el) && el.innerText.replace(/\s+/g, '') !== previous;
    },
    shareUrl,
    { timeout: 30_000 },
  );
  const readOnlyUrl = (await owner.locator('code').first().innerText()).replace(/\s+/g, '');
  await owner.keyboard.press('Escape');

  const roCtx = await browser.newContext();
  const ro = await roCtx.newPage();
  await ro.goto(readOnlyUrl, { waitUntil: 'networkidle' });
  await ro.fill('#displayName', 'Read Only Rita');
  await fillWhenLive(ro, '#guestEmail', 'rita@example.com', 'button[type=submit]');
  await ro.click('button:has-text("Continue as guest")');
  await ro.waitForSelector('canvas.react-pdf__Page__canvas', { timeout: 90_000 });
  check('read-only visitor can view the PDF', true);
  await ro.getByRole('tab', { name: 'Comments' }).click();
  await ro.waitForTimeout(600);
  const readOnlyNotice = await ro.isVisible('text=read-only');
  check('read-only visitor told they cannot comment', readOnlyNotice);
  const composerCount = await ro.getByRole('button', { name: /Add a comment/ }).count();
  check('no composer offered to read-only visitor', composerCount === 0, `${composerCount} composers`);
  await roCtx.close();

  step('Revoking a link cuts off an active guest');
  await owner.click('button:has-text("Share")');
  // Section is singular now — one link is live at a time.
  await owner.waitForSelector('text=Active link', { timeout: 20_000 });
  // Revoke whatever is still live.
  for (;;) {
    const revoke = owner.locator('button[aria-label="Revoke this link"]').first();
    if ((await revoke.count()) === 0) break;
    await revoke.click();
    await owner.waitForTimeout(1200);
  }
  await owner.keyboard.press('Escape');

  const guestResponse = await guest.goto(shareUrl, { waitUntil: 'networkidle' });
  const revokedCopy = await guest.isVisible('text=This link no longer works');
  check('revoked link rejected', revokedCopy, `HTTP ${guestResponse?.status()}`);

  step('Console errors');
  const relevant = [...ownerErrors, ...guestErrors].filter((e) => !/favicon/i.test(e));
  check('no page errors in either context', relevant.length === 0, relevant.slice(0, 2).join(' | '));

  await browser.close();

  console.log(`\n${failures === 0 ? 'ALL SHARING CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 1 * 0 : 1);
}

main().catch((e) => {
  console.error('\nSHARING SMOKE TEST ERROR:\n', e);
  process.exit(1);
});
