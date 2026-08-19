/**
 * Checks that share-invite email can actually reach a real recipient.
 *
 *   npm run verify:email -- [recipient@example.com]
 *
 * With no recipient it only reports configuration and authenticates against the
 * mail server — nothing is sent. Pass an address to send the genuine share
 * invite template, so what lands in the inbox is exactly what an invitee gets.
 *
 * This exists because a broken email setup is otherwise invisible: the share
 * link is created successfully and the failure is a provider-side rejection the
 * owner only notices when the invite never arrives.
 */
import 'dotenv/config';
import { config } from 'dotenv';
import { createRequire } from 'node:module';

config({ path: '.env.local', quiet: true });

/*
 * Applied in-process rather than via NODE_OPTIONS so the npm script stays a
 * plain `tsx` invocation that behaves identically in PowerShell and POSIX
 * shells. It must run before the dynamic imports below, since every module they
 * pull in guards itself with `server-only`.
 */
createRequire(import.meta.url)('./allow-server-only.cjs');

async function main() {
  const recipient = process.argv[2];

  const { emailTransport, env } = await import('../src/lib/env');
  const { verifyEmailTransport, sendEmail } = await import('../src/server/email/send');
  const { shareInviteEmail } = await import('../src/server/email/templates');

  const transport = emailTransport();
  const e = env();

  console.log('\n--- Email configuration ---');
  console.log(`  transport : ${transport ?? 'NONE — email is disabled'}`);
  console.log(`  from      : ${e.EMAIL_FROM ?? '(unset)'}`);
  if (transport === 'smtp') {
    console.log(`  server    : ${e.SMTP_HOST}:${e.SMTP_PORT}`);
    console.log(`  user      : ${e.SMTP_USER}`);
    console.log(`  password  : ${e.SMTP_PASS ? `set (${e.SMTP_PASS.length} chars)` : 'MISSING'}`);
  }

  if (!transport) {
    console.error(
      '\nFAIL  No transport configured.\n' +
        '      Set EMAIL_FROM plus SMTP_USER and SMTP_PASS in .env.local.\n',
    );
    process.exit(1);
  }

  /*
   * Gmail App Passwords are exactly 16 characters. They are usually displayed
   * in four spaced groups, and pasting the spaces is the single most common
   * setup mistake — it fails authentication with a message that does not
   * mention whitespace at all.
   */
  if (transport === 'smtp' && /gmail|googlemail/i.test(e.SMTP_HOST)) {
    const pass = e.SMTP_PASS ?? '';
    if (/\s/.test(pass)) {
      console.warn(
        '\nWARN  SMTP_PASS contains spaces. Gmail shows App Passwords in groups\n' +
          '      of four, but the spaces are display only — remove them.',
      );
    } else if (pass.length !== 16) {
      console.warn(
        `\nWARN  SMTP_PASS is ${pass.length} characters; Gmail App Passwords are 16.\n` +
          '      An ordinary account password will be rejected.',
      );
    }
  }

  console.log('\n--- Authenticating ---');
  const check = await verifyEmailTransport();

  if (!check.sent) {
    console.error(`\nFAIL  ${check.reason}\n      ${check.message}\n`);
    process.exit(1);
  }
  console.log('  OK — the mail server accepted the credentials.');

  if (!recipient) {
    console.log(
      '\nPASS  Configuration is valid. Nothing was sent.\n' +
        '      Re-run with an address to send a real test invite:\n' +
        '        npx tsx scripts/verify-email.ts you@example.com\n',
    );
    return;
  }

  console.log(`\n--- Sending a real share invite to ${recipient} ---`);
  const mail = shareInviteEmail({
    sharerName: 'PDF Intelligence',
    filename: 'Agreement_v3.pdf',
    url: `${e.APP_URL}/s/verification-test-link`,
    canComment: true,
    summary:
      'This is a delivery test. If you can read this in your inbox, share ' +
      'invitations will reach any recipient you invite.',
  });

  const result = await sendEmail({ to: recipient, ...mail });

  if (!result.sent) {
    console.error(`\nFAIL  ${result.reason}\n      ${result.message}\n`);
    process.exit(1);
  }

  console.log(
    `\nPASS  Delivered to ${recipient}.\n` +
      '      Check the inbox (and spam on the first send from a new sender).\n',
  );
}

main().catch((error) => {
  console.error('\nVERIFY EMAIL ERROR:\n', error);
  process.exit(1);
});
