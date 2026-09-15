import { redirect } from 'next/navigation';
import { getLearnerId } from '@/lib/auth/session';
import { AuthForm } from '../auth/AuthForm';

export const metadata = { title: 'Log in · System Design Academy' };

export default async function LoginPage() {
  if (await getLearnerId()) redirect('/');
  return <AuthForm mode="login" />;
}
