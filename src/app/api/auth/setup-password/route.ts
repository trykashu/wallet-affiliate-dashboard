/**
 * POST /api/auth/setup-password
 * Sets the user's password and marks has_password = true on their affiliate or admin row.
 * Requires an authenticated session (user just clicked magic link).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { password } = body;

  if (!password || typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  // Set the password on the Supabase auth user
  const { error: authError } = await supabase.auth.updateUser({ password });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  // Mark has_password = true on the correct table (use service client to bypass RLS)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const now = new Date().toISOString();

  if (isAdminEmail(user.email)) {
    const { error: dbError } = await svc
      .from("admins")
      .update({ has_password: true })
      .eq("user_id", user.id);

    if (dbError) {
      console.error("[setup-password] Failed to update admin has_password:", dbError.message);
    }
  } else {
    const { error: dbError } = await svc
      .from("affiliates")
      .update({ has_password: true, account_activated_at: now })
      .eq("user_id", user.id);

    if (dbError) {
      console.error("[setup-password] Failed to update affiliate has_password:", dbError.message);
    }
  }

  return NextResponse.json({ ok: true });
}
