import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/server/auth/session';
import { AppHeader } from '@/components/app-header';

/**
 * Authenticated shell.
 *
 * This is the real gate for `/dashboard` and `/documents/*`. Middleware only
 * checks for a cookie's presence and cannot validate it — this server-side
 * resolution is what actually enforces authentication.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader user={user} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
