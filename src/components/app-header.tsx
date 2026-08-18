'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, LogOut, Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/misc';
import { apiFetch } from '@/lib/fetcher';

const THEME_KEY = 'pdfiq-theme';

/** Theme toggle, persisted so the inline boot script can apply it before paint. */
function ThemeToggle() {
  const [dark, setDark] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
    } catch {
      // Private browsing with storage disabled — the toggle still works for
      // this page view, it just will not persist.
    }
    setDark(next);
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {/* Render nothing until mounted so SSR and client markup agree. */}
      {dark === null ? null : dark ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}

export function AppHeader({
  user,
}: {
  user: { id: string; name: string; email: string };
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      router.replace('/login');
      router.refresh();
    } catch {
      toast.error('Could not sign out. Please try again.');
      setSigningOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <FileText className="size-4" />
          </span>
          <span className="hidden sm:inline">PDF Intelligence</span>
        </Link>

        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />

          <div className="mx-1 hidden items-center gap-2 sm:flex">
            <Avatar name={user.name} size="sm" />
            <div className="leading-tight">
              <p className="text-xs font-medium">{user.name}</p>
              <p className="text-[11px] text-muted-foreground">{user.email}</p>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            loading={signingOut}
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
