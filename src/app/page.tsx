import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileText, MessageSquareText, Search, Share2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

const FEATURES = [
  {
    icon: Sparkles,
    title: 'Summaries that say something',
    body: 'Every upload is read end to end and condensed into a few sentences naming the parties, terms, and conclusions — not a description of the document’s shape.',
  },
  {
    icon: MessageSquareText,
    title: 'Chat grounded in the page',
    body: 'Questions are answered from retrieved passages only, with page citations you can click. When the document doesn’t cover something, it says so.',
  },
  {
    icon: Share2,
    title: 'Collaboration without accounts',
    body: 'Share a secure link. Invitees read the PDF, ask the AI questions, and join threaded comments — no signup, revocable any time.',
  },
  {
    icon: Search,
    title: 'Search by meaning',
    body: 'Look for “employment terms” and find the contract, whatever its filename happens to be.',
  },
];

export default async function LandingPage() {
  if (await getCurrentUser()) redirect('/dashboard');

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <FileText className="size-4" />
          </span>
          PDF Intelligence
        </span>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Get started</Link>
          </Button>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
        <section className="py-16 sm:py-24">
          <div className="max-w-2xl space-y-6">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20">
              <Sparkles className="size-3" />
              Retrieval-grounded, not guesswork
            </span>

            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              Turn dense PDFs into answers you can cite.
            </h1>

            <p className="text-lg leading-relaxed text-muted-foreground">
              Upload a document and get a summary worth reading, a chat that answers from
              the actual text with page references, and a place for your team to comment —
              without making anyone create an account.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup">Create a free account</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="grid gap-6 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="space-y-2.5 rounded-lg border border-border bg-card p-6"
            >
              <div className="w-fit rounded-md bg-primary/10 p-2">
                <Icon className="size-4 text-primary" />
              </div>
              <h2 className="font-semibold tracking-tight">{title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
