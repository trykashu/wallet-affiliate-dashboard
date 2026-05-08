"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail } from "@/lib/admin";
import { revalidatePath } from "next/cache";

/** Allowed storage paths: lowercase letters/digits/dot/dash/underscore segments,
 *  separated by single forward slashes. No `..`, no leading slash, no empty segments.
 *  Examples: `videos/foo.mp4`, `brand/logo.svg`, `docs/playbook_v2.pdf`. */
const STORAGE_PATH_RE = /^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)*$/;

function validateStoragePath(p: string): string {
  const trimmed = p.trim();
  if (!trimmed) throw new Error("storage_path is required");
  if (trimmed.length > 200) throw new Error("storage_path too long");
  if (trimmed.includes("..")) throw new Error("storage_path may not contain '..'");
  if (!STORAGE_PATH_RE.test(trimmed)) {
    throw new Error("storage_path must be slash-separated alphanumerics/dots/dashes/underscores");
  }
  return trimmed;
}

async function assertAdmin() {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user || !isAdminEmail(user.email)) throw new Error("Forbidden");
}

export interface ResourceInput {
  id?: string;
  title: string;
  description: string | null;
  kind: "video" | "pdf" | "image" | "archive";
  category: "onboarding" | "tutorial" | "brand" | "compliance" | "guide";
  storage_path: string;
  public_url: string;
  thumbnail_path: string | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  sort_order: number;
  is_published: boolean;
}

export async function saveResource(input: ResourceInput) {
  await assertAdmin();
  const cleaned = { ...input, storage_path: validateStoragePath(input.storage_path) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  // Collision check on inserts: reject if another row already owns this storage_path
  if (!cleaned.id) {
    const { data: existing } = await db
      .from("affiliate_resources")
      .select("id")
      .eq("storage_path", cleaned.storage_path)
      .limit(1);
    if (existing && existing.length > 0) {
      throw new Error(`A resource already uses storage_path "${cleaned.storage_path}". Pick a unique path or edit the existing row.`);
    }
  }
  const { id, ...rest } = cleaned;
  // Manually bump updated_at — this codebase uses app-side updates (no triggers).
  const row = { ...rest, updated_at: new Date().toISOString() };
  const op = id
    ? db.from("affiliate_resources").update(row).eq("id", id)
    : db.from("affiliate_resources").insert(row);
  const { error } = await op;
  if (error) throw new Error(error.message);
  revalidatePath("/admin/resources");
  revalidatePath("/dashboard/tools");
}

export async function deleteResource(id: string) {
  await assertAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { error } = await db.from("affiliate_resources").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/resources");
  revalidatePath("/dashboard/tools");
}

export async function togglePublishedResource(id: string, isPublished: boolean) {
  await assertAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { error } = await db
    .from("affiliate_resources")
    .update({ is_published: isPublished, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/resources");
  revalidatePath("/dashboard/tools");
}

/**
 * Uploads a file to the affiliate-content bucket and returns the new metadata.
 * Caller is expected to merge the returned values into the form state and
 * still call saveResource() to persist the row.
 */
export async function uploadResourceFile(formData: FormData): Promise<{
  public_url: string;
  file_size_bytes: number;
  storage_path: string;
}> {
  await assertAdmin();
  const file = formData.get("file") as File | null;
  if (!file) throw new Error("No file provided");
  const storage_path = validateStoragePath(String(formData.get("storage_path") ?? ""));

  // Reject if 50 MB cap exceeded (matches the Next bodySizeLimit configured for this route)
  const MAX_BYTES = 50 * 1024 * 1024;
  if (file.size > MAX_BYTES) throw new Error(`File too large (max ${MAX_BYTES / 1024 / 1024} MB). Use scripts/upload-affiliate-content.ts for large files.`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await db.storage
    .from("affiliate-content")
    .upload(storage_path, buf, { upsert: true, contentType: file.type || "application/octet-stream" });
  if (error) throw new Error(error.message);

  const { data } = db.storage.from("affiliate-content").getPublicUrl(storage_path);
  return { public_url: data.publicUrl, file_size_bytes: buf.length, storage_path };
}
