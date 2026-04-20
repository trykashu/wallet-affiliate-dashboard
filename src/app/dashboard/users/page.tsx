import { getAffiliateContext } from "@/lib/affiliate-context";
import type { ReferredUser } from "@/types/database";
import UserTable from "@/components/dashboard/UserTable";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) return null;
  const { db, affiliateId } = ctx;

  const { data: usersRaw } = await db
    .from("referred_users")
    .select("*")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false });

  const users: ReferredUser[] = (usersRaw ?? []) as ReferredUser[];

  return (
    <>
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">Referred Users</h1>
        <p className="text-sm text-brand-400 mt-1">
          Users you&apos;ve referred to the Kashu wallet.
        </p>
      </div>

      <UserTable users={users} />
    </>
  );
}
