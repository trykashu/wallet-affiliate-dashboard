"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { revalidatePath } from "next/cache";

async function assertAdmin() {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user || !isAdminEmail(user.email)) throw new Error("Forbidden");
}

export interface TemplateInput {
  id?: string;
  title: string;
  platform: "instagram" | "twitter" | "linkedin" | "general";
  category: "intro" | "case-study" | "promo" | "follow-up";
  body: string;
  sort_order: number;
  is_published: boolean;
}

export async function saveTemplate(input: TemplateInput) {
  await assertAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { id, ...rest } = input;
  const row = { ...rest, updated_at: new Date().toISOString() };
  const op = id
    ? db.from("affiliate_share_templates").update(row).eq("id", id)
    : db.from("affiliate_share_templates").insert(row);
  const { error } = await op;
  if (error) throw new Error(error.message);
  revalidatePath("/admin/share-templates");
  revalidatePath("/dashboard/tools");
}

export async function deleteTemplate(id: string) {
  await assertAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { error } = await db.from("affiliate_share_templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/share-templates");
  revalidatePath("/dashboard/tools");
}

export async function toggleTemplatePublished(id: string, isPublished: boolean) {
  await assertAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { error } = await db
    .from("affiliate_share_templates")
    .update({ is_published: isPublished, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/share-templates");
  revalidatePath("/dashboard/tools");
}
