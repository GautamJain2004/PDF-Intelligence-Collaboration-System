import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/server/auth/session';
import { listDocuments } from '@/server/documents/queries';
import { DashboardClient } from '@/components/dashboard/dashboard-client';

export const metadata: Metadata = { title: 'Dashboard' };

// Always reflects the latest documents; caching a per-user list would be wrong.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Server-rendered first paint, then SWR takes over for search and polling.
  const documents = await listDocuments(user.id);

  return (
    <DashboardClient
      initial={{
        documents: documents.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
      }}
    />
  );
}
