import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthForm } from '@/components/auth/auth-form';
import { MIN_PASSWORD_LENGTH } from '@/lib/validation';

export const metadata: Metadata = { title: 'Create account' };

export default function SignupPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          Upload your first PDF in under a minute.
        </p>
      </div>

      <AuthForm
        endpoint="/api/auth/signup"
        redirectTo="/dashboard"
        submitLabel="Create account"
        pendingLabel="Creating account…"
        fields={[
          {
            name: 'name',
            label: 'Name',
            type: 'text',
            placeholder: 'Ada Lovelace',
            autoComplete: 'name',
          },
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
            autoComplete: 'new-password',
            hint: `At least ${MIN_PASSWORD_LENGTH} characters.`,
          },
        ]}
      />

      <p className="text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
