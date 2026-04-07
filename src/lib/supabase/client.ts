/**
 * Supabase BROWSER client — singleton for Client Components.
 * Uses the ANON key. RLS enforced at DB level via the user's JWT.
 * Never import this in Server Components or API routes.
 */
"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
