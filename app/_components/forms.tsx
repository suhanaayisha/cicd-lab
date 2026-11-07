'use client';

import Link from 'next/link';
import { useActionState, useState, type FormEvent } from 'react';
import { useFormStatus } from 'react-dom';
import {
  createMenuAction,
  deleteMenuAction,
  logInAction,
  replaceMenuPdfAction,
  signUpAction,
  type FormState,
} from '../actions';

// Mirrors MAX_PDF_BYTES in lib/menus.ts. Checked here so a too-large file fails instantly,
// before uploading; the server checks again.
const MAX_PDF_BYTES = 25 * 1024 * 1024;

function SubmitButton({ children, pending: pendingLabel, className }: {
  children: string;
  pending: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}

function ErrorMessage({ error }: { error?: string }) {
  return error ? <p className="error" role="alert">{error}</p> : null;
}

/** Blocks submitting a file over the size limit and shows a message instead. */
function useFileSizeGuard() {
  const [sizeError, setSizeError] = useState<string>();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const file = new FormData(event.currentTarget).get('pdf');
    if (file instanceof File && file.size > MAX_PDF_BYTES) {
      event.preventDefault();
      setSizeError(`That PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
    } else {
      setSizeError(undefined);
    }
  }
  return { sizeError, onSubmit };
}

/**
 * Instant "Passwords do not match" feedback while typing in either field; the server checks again.
 * Runs on both fields so fixing the first password also clears the warning.
 */
function checkPasswordsMatch(form: HTMLFormElement | null) {
  const password = form?.elements.namedItem('password') as HTMLInputElement | null;
  const confirm = form?.elements.namedItem('confirmPassword') as HTMLInputElement | null;
  if (!password || !confirm) return;
  confirm.setCustomValidity(confirm.value && confirm.value !== password.value ? 'Passwords do not match.' : '');
}

export function AuthForm({ mode }: { mode: 'signup' | 'login' }) {
  const isSignup = mode === 'signup';
  const [state, action] = useActionState<FormState, FormData>(isSignup ? signUpAction : logInAction, undefined);

  return (
    <section className="card narrow">
      <h1>{isSignup ? 'Create your account' : 'Log in'}</h1>
      <ErrorMessage error={state?.error} />
      <form action={action}>
        <label>
          Email
          <input type="email" name="email" required autoComplete="email" defaultValue={state?.email} />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            required
            minLength={isSignup ? 8 : 1}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            onInput={isSignup ? (event) => checkPasswordsMatch(event.currentTarget.form) : undefined}
          />
        </label>
        {isSignup && <p className="hint">At least 8 characters.</p>}
        {isSignup && (
          <label>
            Confirm password
            <input
              type="password"
              name="confirmPassword"
              required
              autoComplete="new-password"
              onInput={(event) => checkPasswordsMatch(event.currentTarget.form)}
            />
          </label>
        )}
        <SubmitButton pending={isSignup ? 'Creating account…' : 'Logging in…'}>
          {isSignup ? 'Sign up' : 'Log in'}
        </SubmitButton>
      </form>
      <p>
        {isSignup ? (
          <>Already have an account? <Link href="/login">Log in</Link></>
        ) : (
          <>New here? <Link href="/signup">Create an account</Link></>
        )}
      </p>
    </section>
  );
}

export function UploadMenuForm() {
  const [state, action] = useActionState<FormState, FormData>(createMenuAction, undefined);
  const { sizeError, onSubmit } = useFileSizeGuard();

  return (
    <section className="card">
      <h2>Add a menu</h2>
      <ErrorMessage error={sizeError ?? state?.error} />
      <form action={action} onSubmit={onSubmit}>
        <label>
          Restaurant or menu name
          <input name="name" required maxLength={80} />
        </label>
        <label>
          Menu PDF (max 25 MB)
          <input type="file" name="pdf" accept="application/pdf" required />
        </label>
        <SubmitButton pending="Uploading…">Upload menu</SubmitButton>
      </form>
    </section>
  );
}

export function ReplacePdfForm({ menuId }: { menuId: string }) {
  const [state, action] = useActionState<FormState, FormData>(replaceMenuPdfAction, undefined);
  const { sizeError, onSubmit } = useFileSizeGuard();

  return (
    <>
      <ErrorMessage error={sizeError ?? state?.error} />
      <form action={action} onSubmit={onSubmit} className="row">
        <input type="hidden" name="menuId" value={menuId} />
        <label>
          Replace PDF
          <input type="file" name="pdf" accept="application/pdf" required />
        </label>
        <SubmitButton pending="Uploading…">Replace</SubmitButton>
      </form>
    </>
  );
}

export function DeleteMenuButton({ menuId }: { menuId: string }) {
  return (
    <form
      action={deleteMenuAction}
      onSubmit={(event) => {
        if (!confirm('Delete this menu? Printed QR codes will stop working.')) event.preventDefault();
      }}
    >
      <input type="hidden" name="menuId" value={menuId} />
      <SubmitButton pending="Deleting…" className="danger">Delete menu</SubmitButton>
    </form>
  );
}
