import { createServiceClient } from "@/lib/supabase/service";
import type { AffiliateResource, ShareTemplate } from "@/types/database";

export async function fetchPublishedResources(): Promise<AffiliateResource[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data, error } = await db
    .from("affiliate_resources")
    .select("*")
    .eq("is_published", true)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data as AffiliateResource[];
}

export async function fetchPublishedShareTemplates(): Promise<ShareTemplate[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data, error } = await db
    .from("affiliate_share_templates")
    .select("*")
    .eq("is_published", true)
    .order("platform", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data as ShareTemplate[];
}
