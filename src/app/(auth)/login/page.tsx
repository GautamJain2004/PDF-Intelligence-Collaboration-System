import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthForm } from '@/components/auth/auth-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to reach your documents.
        </p>
      </div>

      <AuthForm
        endpoint="/api/auth/login"
        redirectTo="/dashboard"
        submitLabel="Sign in"
        pendingLabel="Signing in…"
        fields={[
          {
            name: 'email',
            label: 'Email',
            type: 'email',
            placeholder: 'you@example.com',
            autoComplete: 'email',
          },
          {
            name: 'password',
            label: 'Password',
            type: 'password',
            placeholder: '••••••••',
            autoComplete: 'current-password',
          },
        ]}
      />

      <div className="space-y-3 text-sm">
        <Link
          href="/forgot-password"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Forgot your password?
        </Link>
        <p className="text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
