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
      .select("id, affiliate_id, referred_user_id, amount, transaction_type, transaction_external_id, transaction_date, email, created_at, card_last4, card_issuer, funnel_percent")
      .eq("transaction_type", "Transfer In")
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

  type TxnExtra = Transaction & {
    card_last4?: string | null;
    card_issuer?: string | null;
    funnel_percent?: number | null;
  };

  const enriched: AdminTransaction[] = transactions.map((tx) => {
    const t = tx as TxnExtra;
    return {
      id:                      t.id,
      affiliate_id:            t.affiliate_id,
      affiliate_name:          t.affiliate_id ? (affiliateMap.get(t.affiliate_id) ?? "Unknown") : null,
      user_email:              t.email ?? (t.referred_user_id ? (userMap.get(t.referred_user_id) ?? null) : null),
      amount:                  t.amount,
      transaction_type:        t.transaction_type,
      transaction_external_id: t.transaction_external_id,
      transaction_date:        t.transaction_date,
      created_at:              t.created_at,
      card_last4:              t.card_last4 ?? null,
      card_issuer:             t.card_issuer ?? null,
      funnel_percent:          t.funnel_percent ?? null,
    };
  });

  const affiliateNames = affiliates.map((a) => ({ id: a.id, name: a.agent_name }));

  return <TransactionTable transactions={enriched} affiliateNames={affiliateNames} />;
}
