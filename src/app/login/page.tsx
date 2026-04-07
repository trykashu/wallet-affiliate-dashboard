/**
 * Login page — Magic Link authentication.
 * Affiliates enter their email and receive a one-time login link.
 * No passwords to manage, no credential leakage risk.
 */

import LoginForm from "@/components/auth/LoginForm";

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  return <LoginForm initialError={error} />;
}
