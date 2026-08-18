import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthForm } from '@/components/auth/auth-form';

export const metadata: Metadata = { title: 'Reset password' };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a link to choose a new password.
        </p>
      </div>

      <AuthForm
        endpoint="/api/auth/forgot-password"
        submitLabel="Send reset link"
        pendingLabel="Sending…"
        onSuccessMessage="If an account exists for that email, a reset link is on its way. The link expires in 30 minutes."
        fields={[
          {
            name: 'email',
            label: 'Email',
            type: 'email',
            placeholder: 'you@example.com',
            autoComplete: 'email',
          },
        ]}
      />

      <p className="text-sm text-muted-foreground">
        Remembered it?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
