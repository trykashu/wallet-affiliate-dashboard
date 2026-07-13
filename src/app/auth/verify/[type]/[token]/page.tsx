import VerifyOtpCard from "@/components/auth/VerifyOtpCard";

/**
 * Path-param variant: /auth/verify/<type>/<token_hash>
 * This is the format the Supabase email templates emit. It contains NO `=`
 * characters because the SMTP relay behind our sender mis-decodes
 * quoted-printable and eats `=` + two hex chars — which corrupted every
 * `?token_hash=<hex>` query link (see VerifyOtpCard).
 */
export default async function AuthVerifyPathPage({
  params,
}: {
  params: Promise<{ type: string; token: string }>;
}) {
  const { type, token } = await params;
  return <VerifyOtpCard type={type} tokenHash={token} />;
}
