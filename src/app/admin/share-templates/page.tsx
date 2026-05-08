import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import AdminShareTemplates from "@/components/admin/AdminShareTemplates";
import type { ShareTemplate } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminShareTemplatesPage() {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data } = await db
    .from("affiliate_share_templates")
    .select("*")
    .order("platform", { ascending: true })
    .order("sort_order", { ascending: true });

  return <AdminShareTemplates initialRows={(data ?? []) as ShareTemplate[]} />;
}
