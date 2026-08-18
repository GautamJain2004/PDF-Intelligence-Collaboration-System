import 'server-only';

/**
 * Email templates.
 *
 * Plain string templates rather than a rendering library: two emails do not
 * justify the dependency. Every interpolated value is HTML-escaped, because
 * document filenames and user names are attacker-controlled and would otherwise
 * allow HTML injection into a recipient's inbox.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(opts: { heading: string; body: string; cta?: { href: string; label: string }; footer?: string }) {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
      <tr>
        <td style="padding:32px;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;">PDF Intelligence</p>
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;">${opts.heading}</h1>
          <div style="font-size:14px;line-height:1.65;color:#334155;">${opts.body}</div>
          ${
            opts.cta
              ? `<p style="margin:28px 0 0;">
                   <a href="${opts.cta.href}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:14px;font-weight:600;">${opts.cta.label}</a>
                 </p>
                 <p style="margin:18px 0 0;font-size:12px;color:#64748b;word-break:break-all;">
                   Or paste this link into your browser:<br />${opts.cta.href}
                 </p>`
              : ''
          }
          ${
            opts.footer
              ? `<p style="margin:26px 0 0;padding-top:18px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">${opts.footer}</p>`
              : ''
          }
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function shareInviteEmail(params: {
  sharerName: string;
  filename: string;
  url: string;
  canComment: boolean;
  summary?: string | null;
}) {
  const sharer = escapeHtml(params.sharerName);
  const file = escapeHtml(params.filename);

  const summaryBlock = params.summary
    ? `<div style="margin:18px 0 0;padding:14px 16px;background:#f8fafc;border-left:3px solid #2563eb;border-radius:0 8px 8px 0;">
         <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;">AI summary</p>
         <p style="margin:0;font-size:13px;line-height:1.6;color:#334155;">${escapeHtml(params.summary)}</p>
       </div>`
    : '';

  return {
    subject: `${params.sharerName} shared "${params.filename}" with you`,
    html: layout({
      heading: `${sharer} shared a document with you`,
      body: `<p style="margin:0;"><strong>${file}</strong></p>
             ${summaryBlock}
             <p style="margin:18px 0 0;">You can read the full document, ask the built-in AI questions about it${
               params.canComment ? ', and leave comments' : ''
             }. No account required.</p>`,
      cta: { href: params.url, label: 'Open document' },
      footer:
        'Anyone with this link can open the document, so only forward it to people you trust. The sender can revoke it at any time.',
    }),
    text: [
      `${params.sharerName} shared "${params.filename}" with you.`,
      params.summary ? `\nAI summary: ${params.summary}` : '',
      `\nOpen it here: ${params.url}`,
      '\nNo account required. Anyone with this link can open the document.',
    ].join(''),
  };
}

export function passwordResetEmail(params: { name: string; url: string; ttlMinutes: number }) {
  return {
    subject: 'Reset your PDF Intelligence password',
    html: layout({
      heading: 'Reset your password',
      body: `<p style="margin:0;">Hi ${escapeHtml(params.name)},</p>
             <p style="margin:12px 0 0;">We received a request to reset your password. This link expires in ${params.ttlMinutes} minutes and can be used once.</p>`,
      cta: { href: params.url, label: 'Choose a new password' },
      footer:
        'If you did not request this, you can safely ignore this email — your password will not change.',
    }),
    text: `Hi ${params.name},\n\nReset your password using this link (expires in ${params.ttlMinutes} minutes, single use):\n${params.url}\n\nIf you did not request this, ignore this email.`,
  };
}
