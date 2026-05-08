import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getAffiliateContext,
  DEFAULT_SIGNUP_BASE_URL,
} from "@/lib/affiliate-context";
import {
  fetchPublishedResources,
  fetchPublishedShareTemplates,
} from "@/lib/affiliate-resources";
import ToolsClient from "@/components/tools/ToolsClient";

export const dynamic = "force-dynamic";

export default async function ToolsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/dashboard");

  const { affiliate, brand } = ctx;
  const baseUrl = brand?.signup_base_url ?? DEFAULT_SIGNUP_BASE_URL;
  const referralUrl = `${baseUrl}?referrer=${affiliate.attribution_id}`;

  const [resources, templates] = await Promise.all([
    fetchPublishedResources(),
    fetchPublishedShareTemplates(),
  ]);

  return (
    <ToolsClient
      affiliate={affiliate}
      brand={brand}
      referralUrl={referralUrl}
      resources={resources}
      templates={templates}
    />
  );
}
