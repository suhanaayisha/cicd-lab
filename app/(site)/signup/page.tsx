import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '../../_components/forms';
import { getCurrentUser } from '../../_lib/session';

export const metadata: Metadata = { title: 'Sign up' };

export default async function Page() {
  if (await getCurrentUser()) redirect('/dashboard');
  return <AuthForm mode="signup" />;
}
