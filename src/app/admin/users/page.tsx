import { redirect }            from "next/navigation";
import { createClient }        from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail }        from "@/lib/admin";
import AdminUserTable          from "@/components/admin/AdminUserTable";
import type { AdminUser }      from "@/components/admin/AdminUserTable";
import type { ReferredUser, Affiliate } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [usersResult, affiliatesResult] = await Promise.all([
    db.from("referred_users")
      .select("id, full_name, email, affiliate_id, status_slug, first_transaction_amount, created_at")
      .order("created_at", { ascending: false }),
    db.from("affiliates")
      .select("id, agent_name"),
  ]);

  const referredUsers: ReferredUser[] = usersResult.data ?? [];
  const affiliates: Affiliate[]       = affiliatesResult.data ?? [];

  // Build affiliate name lookup
  const affiliateMap = new Map<string, string>();
  for (const a of affiliates) {
    affiliateMap.set(a.id, a.agent_name);
  }

  const enriched: AdminUser[] = referredUsers.map((u) => ({
    id:                       u.id,
    full_name:                u.full_name,
    email:                    u.email,
    affiliate_id:             u.affiliate_id,
    affiliate_name:           affiliateMap.get(u.affiliate_id) ?? "Unknown",
    status_slug:              u.status_slug,
    first_transaction_amount: u.first_transaction_amount,
    created_at:               u.created_at,
  }));

  const affiliateNames = affiliates.map((a) => ({ id: a.id, name: a.agent_name }));

  return <AdminUserTable users={enriched} affiliateNames={affiliateNames} />;
}
