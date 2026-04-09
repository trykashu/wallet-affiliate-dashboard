import { redirect }            from "next/navigation";
import { createClient }        from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail }        from "@/lib/admin";
import TransactionTable        from "@/components/admin/TransactionTable";
import type { AdminTransaction } from "@/components/admin/TransactionTable";
import type { Transaction, Affiliate, ReferredUser } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminTransactionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const [txResult, affiliatesResult, usersResult] = await Promise.all([
    db.from("transactions")
      .select("id, affiliate_id, referred_user_id, amount, transaction_type, transaction_external_id, transaction_date, email, created_at")
      .order("transaction_date", { ascending: false })
      .limit(1000),
    db.from("affiliates")
      .select("id, agent_name"),
    db.from("referred_users")
      .select("id, full_name, email"),
  ]);

  const transactions: Transaction[] = txResult.data ?? [];
  const affiliates: Affiliate[]     = affiliatesResult.data ?? [];
  const users: ReferredUser[]       = usersResult.data ?? [];

  // Build lookup maps
  const affiliateMap = new Map<string, string>();
  for (const a of affiliates) affiliateMap.set(a.id, a.agent_name);

  const userMap = new Map<string, string>();
  for (const u of users) userMap.set(u.id, u.email);

  const enriched: AdminTransaction[] = transactions.map((tx) => ({
    id:                      tx.id,
    affiliate_id:            tx.affiliate_id,
    affiliate_name:          tx.affiliate_id ? (affiliateMap.get(tx.affiliate_id) ?? "Unknown") : null,
    user_email:              tx.email ?? (tx.referred_user_id ? (userMap.get(tx.referred_user_id) ?? null) : null),
    amount:                  tx.amount,
    transaction_type:        tx.transaction_type,
    transaction_external_id: tx.transaction_external_id,
    transaction_date:        tx.transaction_date,
    created_at:              tx.created_at,
  }));

  const affiliateNames = affiliates.map((a) => ({ id: a.id, name: a.agent_name }));

  return <TransactionTable transactions={enriched} affiliateNames={affiliateNames} />;
}
