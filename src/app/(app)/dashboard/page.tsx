import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/server/auth/session';
import { PAGE_SIZE, getLibraryStats, listDocuments } from '@/server/documents/queries';
import { DashboardClient } from '@/components/dashboard/dashboard-client';

export const metadata: Metadata = { title: 'Dashboard' };

// Always reflects the latest documents; caching a per-user list would be wrong.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Server-rendered first paint, then SWR takes over for search and paging.
  const [first, stats] = await Promise.all([
    listDocuments(user.id),
    getLibraryStats(user.id),
  ]);

  return (
    <DashboardClient
      initial={{
        documents: first.documents.map((d) => ({
          ...d,
          createdAt: d.createdAt.toISOString(),
        })),
        total: first.total,
        page: 1,
        pageSize: PAGE_SIZE,
        stats,
      }}
    />
  );
}
