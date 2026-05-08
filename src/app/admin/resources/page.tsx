import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import AdminResources from "@/components/admin/AdminResources";
import type { AffiliateResource } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function AdminResourcesPage() {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data } = await db
    .from("affiliate_resources")
    .select("*")
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true });

  return <AdminResources initialRows={(data ?? []) as AffiliateResource[]} />;
}
