import { redirect } from 'next/navigation';
import { getLearnerId } from '@/lib/auth/session';
import { AuthForm } from '../auth/AuthForm';

export const metadata = { title: 'Sign up · System Design Academy' };

export default async function SignupPage() {
  if (await getLearnerId()) redirect('/');
  return <AuthForm mode="signup" />;
}
