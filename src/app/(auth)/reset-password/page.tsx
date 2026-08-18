import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthForm } from '@/components/auth/auth-form';
import { MIN_PASSWORD_LENGTH } from '@/lib/validation';

export const metadata: Metadata = { title: 'Choose a new password' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Link incomplete</h1>
        <p className="text-sm text-muted-foreground">
          This password reset link is missing its token. Request a new one to continue.
        </p>
        <Link
          href="/forgot-password"
          className="inline-block text-sm font-medium text-primary hover:underline"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">
          Signing in everywhere else will be revoked for safety.
        </p>
      </div>

      <AuthForm
        endpoint="/api/auth/reset-password"
        redirectTo="/dashboard"
        submitLabel="Update password"
        pendingLabel="Updating…"
        hiddenValues={{ token }}
        fields={[
          {
            name: 'password',
            label: 'New password',
            type: 'password',
            placeholder: '••••••••',
            autoComplete: 'new-password',
            hint: `At least ${MIN_PASSWORD_LENGTH} characters.`,
          },
        ]}
      />

      <p className="text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
