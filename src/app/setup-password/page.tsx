import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import SetupPasswordForm from "@/components/auth/SetupPasswordForm";

export const dynamic = "force-dynamic";

export default async function SetupPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not logged in → login
  if (!user) redirect("/login");

  const isAdmin = isAdminEmail(user.email);
  const successRedirect = isAdmin ? "/admin" : "/dashboard";

  // Already has password → correct destination
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const table = isAdmin ? "admins" : "affiliates";
  const { data: row } = await db
    .from(table)
    .select("has_password")
    .eq("user_id", user.id)
    .maybeSingle();

  if (row?.has_password) redirect(successRedirect);

  return <SetupPasswordForm redirectTo={successRedirect} />;
}
