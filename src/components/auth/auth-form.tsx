'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorText } from '@/components/ui/misc';
import { apiFetch, RequestError } from '@/lib/fetcher';
import { MIN_PASSWORD_LENGTH } from '@/lib/validation';
import { cn } from '@/lib/utils';

export type AuthField = {
  name: string;
  label: string;
  type: 'text' | 'email' | 'password';
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
};

/**
 * Shared credential form.
 *
 * All four auth screens share submit handling, field-level error mapping, and
 * the disabled/loading states — only the field list and endpoint differ.
 */
export function AuthForm({
  fields,
  endpoint,
  submitLabel,
  pendingLabel,
  redirectTo,
  hiddenValues,
  onSuccessMessage,
}: {
  fields: AuthField[];
  endpoint: string;
  submitLabel: string;
  pendingLabel: string;
  /** Where to send the user on success. Omit to show `onSuccessMessage` instead. */
  redirectTo?: string;
  hiddenValues?: Record<string, string>;
  onSuccessMessage?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  /**
   * Whether React has hydrated and `onSubmit` is actually wired up.
   *
   * Server-rendered HTML is interactive before hydration completes. A submit in
   * that window bypasses the React handler entirely and the browser performs a
   * NATIVE form submission — which, for a GET form, appends every field to the
   * URL. Observed in testing as:
   *
   *   /signup?name=...&email=...&password=layout-password-1
   *
   * That puts a plaintext password into browser history, the Referer header,
   * and any server access log. Blocking submission until hydrated closes the
   * window; `method="post"` below ensures that even if one slipped through,
   * credentials travel in a body rather than a URL.
   */
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => setHydrated(true), []);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [done, setDone] = React.useState<string | null>(null);
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setFormError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = { ...hiddenValues };
    for (const field of fields) payload[field.name] = String(data.get(field.name) ?? '');

    try {
      const result = await apiFetch<{ message?: string }>(endpoint, {
        method: 'POST',
        json: payload,
      });

      if (redirectTo) {
        // Full refresh so server components pick up the new session cookie.
        router.replace(redirectTo);
        router.refresh();
      } else {
        setDone(result?.message ?? onSuccessMessage ?? 'Done.');
      }
    } catch (error) {
      if (error instanceof RequestError) {
        setFieldErrors(error.fields ?? {});
        // Only show a form-level banner when no field owns the message.
        if (!error.fields || Object.keys(error.fields).length === 0) {
          setFormError(error.message);
        }
      } else {
        setFormError('Network error. Please check your connection and try again.');
      }
      setPending(false);
    }
  }

  if (done) {
    return (
      <div
        role="status"
        className="rounded-lg border border-success/25 bg-success/10 p-4 text-sm text-foreground"
      >
        {done}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} method="post" action="" noValidate className="space-y-4">
      {formError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {formError}
        </div>
      ) : null}

      {fields.map((field) => {
        const isPassword = field.type === 'password';
        const shown = revealed[field.name] ?? false;
        const error = fieldErrors[field.name];

        return (
          <div key={field.name} className="space-y-1.5">
            <Label htmlFor={field.name}>{field.label}</Label>
            <div className={cn(isPassword && 'relative')}>
              <Input
                id={field.name}
                name={field.name}
                type={isPassword && shown ? 'text' : field.type}
                placeholder={field.placeholder}
                autoComplete={field.autoComplete}
                disabled={pending}
                invalid={Boolean(error)}
                aria-describedby={
                  error ? `${field.name}-error` : field.hint ? `${field.name}-hint` : undefined
                }
                minLength={isPassword ? MIN_PASSWORD_LENGTH : undefined}
                className={cn(isPassword && 'pr-10')}
                required
              />
              {isPassword ? (
                <button
                  type="button"
                  onClick={() =>
                    setRevealed((r) => ({ ...r, [field.name]: !r[field.name] }))
                  }
                  className="absolute right-0 top-0 grid h-10 w-10 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={shown ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              ) : null}
            </div>

            {error ? (
              <ErrorText>
                <span id={`${field.name}-error`}>{error}</span>
              </ErrorText>
            ) : field.hint ? (
              <p id={`${field.name}-hint`} className="text-xs text-muted-foreground">
                {field.hint}
              </p>
            ) : null}
          </div>
        );
      })}

      <Button type="submit" className="w-full" loading={pending} disabled={!hydrated}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
