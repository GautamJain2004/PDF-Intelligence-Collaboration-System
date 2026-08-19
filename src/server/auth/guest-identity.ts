import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { guestIdentities } from '@/server/db/schema';

/**
 * Durable identity for account-less visitors.
 *
 * Share links are one-shot by design, so without this the same person opening a
 * second link is a brand-new stranger who has to re-type their name — and their
 * comments across documents look like they came from different people.
 *
 * This is emphatically NOT authentication. There is no password and the email
 * is never verified, so possessing an email grants nothing: access still comes
 * entirely from holding a valid share token. Treating it as a credential would
 * let anyone read another guest's documents by typing their address.
 */

export type GuestIdentityRecord = {
  id: string;
  email: string;
  displayName: string;
  /** True when this email has been seen before, so the UI can greet them back. */
  returning: boolean;
};

/** Normalised once, here, so lookups can rely on the unique index matching. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Builds a usable name from an address when the visitor did not supply one.
 *
 * "jordan.patel@acme.com" becomes "Jordan Patel" — better than showing a raw
 * address next to every comment, which reads as a leak even though the address
 * is only visible to people who already hold the link.
 */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const words = local
    .replace(/[._+-]+/g, ' ')
    .replace(/\d+/g, '')
    .trim();

  if (!words) return 'Guest';

  return words
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .slice(0, 60);
}

/** The name remembered for an address, or null. Used to prefill the join form. */
export async function lookupGuestName(email: string): Promise<string | null> {
  const [row] = await db
    .select({ displayName: guestIdentities.displayName })
    .from(guestIdentities)
    .where(eq(guestIdentities.email, normaliseEmail(email)))
    .limit(1);

  return row?.displayName ?? null;
}

/**
 * Finds or creates the identity behind an email.
 *
 * A remembered name wins unless the visitor deliberately types a different one,
 * which is what makes attribution stable across links while still letting
 * someone correct a typo.
 */
export async function resolveGuestIdentity(
  rawEmail: string,
  requestedName?: string | null,
): Promise<GuestIdentityRecord> {
  const email = normaliseEmail(rawEmail);
  const wanted = requestedName?.trim() || null;

  const [existing] = await db
    .select()
    .from(guestIdentities)
    .where(eq(guestIdentities.email, email))
    .limit(1);

  if (existing) {
    if (wanted && wanted !== existing.displayName) {
      const [updated] = await db
        .update(guestIdentities)
        .set({ displayName: wanted, updatedAt: new Date() })
        .where(eq(guestIdentities.id, existing.id))
        .returning();

      return { id: updated.id, email, displayName: updated.displayName, returning: true };
    }

    return { id: existing.id, email, displayName: existing.displayName, returning: true };
  }

  const [created] = await db
    .insert(guestIdentities)
    .values({ email, displayName: wanted ?? nameFromEmail(email) })
    /*
     * Two tabs submitting at once would otherwise raise a unique violation and
     * fail a join that should plainly succeed. Nothing is updated on conflict;
     * the row is re-read below.
     */
    .onConflictDoNothing({ target: guestIdentities.email })
    .returning();

  if (created) {
    return { id: created.id, email, displayName: created.displayName, returning: false };
  }

  const [raced] = await db
    .select()
    .from(guestIdentities)
    .where(eq(guestIdentities.email, email))
    .limit(1);

  return { id: raced.id, email, displayName: raced.displayName, returning: true };
}
