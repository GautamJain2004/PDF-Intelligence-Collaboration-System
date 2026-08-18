import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileText, MessageSquareText, Share2, Sparkles } from 'lucide-react';

import { getCurrentUser } from '@/server/auth/session';

const HIGHLIGHTS = [
  {
    icon: Sparkles,
    title: 'Summaries on upload',
    body: 'Every PDF is read and condensed into a few sentences worth trusting.',
  },
  {
    icon: MessageSquareText,
    title: 'Ask the document',
    body: 'Grounded answers with page citations — retrieval, not guesswork.',
  },
  {
    icon: Share2,
    title: 'Share without friction',
    body: 'Send a secure link. Invitees read, ask, and comment without an account.',
  },
];

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Signed-in users have no business on the auth screens.
  if (await getCurrentUser()) redirect('/dashboard');

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Marketing panel is decorative; hidden on small screens to keep the
          form above the fold on phones. */}
      <aside className="relative hidden overflow-hidden bg-slate-950 p-10 text-slate-100 lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              'radial-gradient(60rem 40rem at 15% 0%, rgba(37,99,235,.35), transparent 60%), radial-gradient(45rem 35rem at 100% 100%, rgba(14,165,233,.22), transparent 55%)',
          }}
        />

        <Link
          href="/"
          className="relative flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-blue-600">
            <FileText className="size-4" />
          </span>
          PDF Intelligence
        </Link>

        <div className="relative space-y-10">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight">
              Turn dense PDFs into
              <br />
              answers you can cite.
            </h1>
            <p className="max-w-sm text-sm leading-relaxed text-slate-400">
              Upload a document and get a summary, a searchable knowledge base, and a
              collaboration space — in one place.
            </p>
          </div>

          <ul className="space-y-5">
            {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-inset ring-white/15">
                  <Icon className="size-4 text-blue-300" />
                </span>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-sm leading-relaxed text-slate-400">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-slate-500">
          Documents stay private to you and the people you explicitly invite.
        </p>
      </aside>

      <main className="flex items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <Link
            href="/"
            className="mb-8 flex items-center gap-2 text-sm font-semibold tracking-tight lg:hidden"
          >
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <FileText className="size-4" />
            </span>
            PDF Intelligence
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}
