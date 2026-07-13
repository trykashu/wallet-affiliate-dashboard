import VerifyOtpCard from "@/components/auth/VerifyOtpCard";

/**
 * Query-param variant: /auth/verify?token_hash=...&type=...
 * Used for links delivered outside the Supabase SMTP relay (which corrupts
 * `=`-delimited tokens — see VerifyOtpCard). Emailed links use the path
 * variant /auth/verify/[type]/[token] instead.
 */
export default function AuthVerifyPage() {
  return <VerifyOtpCard />;
}
