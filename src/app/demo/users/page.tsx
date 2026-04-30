import { DEMO_REFERRED_USERS } from "@/lib/demo-data";
import UserTable from "@/components/dashboard/UserTable";

export const dynamic = "force-dynamic";

export default function DemoUsersPage() {
  return (
    <>
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">Referred Users</h1>
        <p className="text-sm text-brand-400 mt-1">
          Users you&apos;ve referred to the Kashu wallet.
        </p>
      </div>

      <UserTable users={DEMO_REFERRED_USERS} />
    </>
  );
}
