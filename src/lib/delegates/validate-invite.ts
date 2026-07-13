export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface InviteCheckInput {
  email: string;
  ownerEmail: string;
  emailIsAffiliate: boolean;
}

export interface InviteCheckResult {
  ok: boolean;
  error?: string;
}

export function checkInviteAllowed(input: InviteCheckInput): InviteCheckResult {
  const email = normalizeEmail(input.email);
  if (email === normalizeEmail(input.ownerEmail)) {
    return { ok: false, error: "You can't invite your own email as a delegate." };
  }
  if (input.emailIsAffiliate) {
    return {
      ok: false,
      error: "This email belongs to an affiliate account and can't be a delegate.",
    };
  }
  return { ok: true };
}
