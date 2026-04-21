/**
 * POST /api/auth/setup-password
 * Sets the user's password and marks has_password = true on their affiliate or admin row.
 * Accepts session from cookies OR Authorization header (for invite flow where session is in localStorage).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  let userId: string | undefined;
  let userEmail: string | undefined;

  // Try 1: Get user from server cookies (normal flow)
  const supabase = await createClient();
  const { data: { user: cookieUser } } = await supabase.auth.getUser();

  if (cookieUser) {
    userId = cookieUser.id;
    userEmail = cookieUser.email ?? undefined;
  }

  // Try 2: Get user from Authorization header (invite flow — session in localStorage)
  if (!userId) {
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      // Create a one-off client with the token to get the user
      const tokenClient = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );
      const { data: { user: tokenUser } } = await tokenClient.auth.getUser();
      if (tokenUser) {
        userId = tokenUser.id;
        userEmail = tokenUser.email ?? undefined;
      }
    }
  }

  if (!userId) {
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

  // Note: password is already set client-side via supabase.auth.updateUser()
  // This endpoint just marks has_password = true in the database

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const now = new Date().toISOString();

  if (userEmail && isAdminEmail(userEmail)) {
    await svc
      .from("admins")
      .update({ has_password: true })
      .eq("user_id", userId);
  } else {
    await svc
      .from("affiliates")
      .update({ has_password: true, account_activated_at: now })
      .eq("user_id", userId);
  }

  return NextResponse.json({ ok: true });
}
