import { redirect }            from "next/navigation";
import { createClient }        from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail }        from "@/lib/admin";
import AdminSettingsForm       from "@/components/admin/AdminSettingsForm";
import type { PayoutSettings } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const { data: settings } = await db
    .from("payout_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  const currentSettings: PayoutSettings | null = settings ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-bold text-brand-400 uppercase tracking-wider">Settings</h2>
        <p className="text-xs text-brand-400 mt-0.5">Configure payout and system settings</p>
      </div>

      <AdminSettingsForm settings={currentSettings} />
    </div>
  );
}
