import { getAffiliateContext } from "@/lib/affiliate-context";
import type { ReferredUser, FunnelStatus } from "@/types/database";
import UserTable from "@/components/dashboard/UserTable";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) return null;
  const { db, affiliateId } = ctx;

  const [{ data: usersRaw }, { data: statusesRaw }] = await Promise.all([
    db
      .from("referred_users")
      .select("*")
      .eq("affiliate_id", affiliateId)
      .order("created_at", { ascending: false }),
    db
      .from("funnel_statuses")
      .select("*")
      .order("sort_order", { ascending: true }),
  ]);

  const users: ReferredUser[] = (usersRaw ?? []) as ReferredUser[];
  const funnelStatuses: FunnelStatus[] = (statusesRaw ?? []) as FunnelStatus[];

  return (
    <>
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">Referred Users</h1>
        <p className="text-sm text-brand-400 mt-1">
          Track every user you&apos;ve referred and their progress through the funnel.
        </p>
      </div>

      <UserTable users={users} funnelStatuses={funnelStatuses} />
    </>
  );
}
