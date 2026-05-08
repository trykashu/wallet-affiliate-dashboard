/* eslint-disable @typescript-eslint/no-explicit-any */
// Uploads "Affiliate Content Package/" to Supabase Storage and upserts
// affiliate_resources rows. Idempotent.
// Run:  NODE_OPTIONS=--max-old-space-size=4096 npx tsx scripts/upload-affiliate-content.ts
//       (the larger heap is needed because the largest video is ~525 MB and Buffer
//        upload via supabase-js peaks at ~2x the file size during serialization.)
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\\n|"|\s/g, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/\\n|"|\s/g, "");
if (!URL || !KEY) { console.error("Missing env"); process.exit(1); }

const supa = createClient(URL, KEY, { auth: { persistSession: false } });
const ROOT = resolve("Affiliate Content Package");
const UNPACKED = resolve(ROOT, "_unpacked");
const BUCKET = "affiliate-content";

function unpackZips() {
  if (!existsSync(UNPACKED)) mkdirSync(UNPACKED, { recursive: true });
  for (const z of ["How to Use Kashu.zip", "Brand Assets.zip"]) {
    const src = resolve(ROOT, z);
    const dst = resolve(UNPACKED, z.replace(/\.zip$/, ""));
    if (existsSync(dst)) { console.log(`skip unpack: ${z}`); continue; }
    mkdirSync(dst, { recursive: true });
    console.log(`unzip ${z} ...`);
    execFileSync("unzip", ["-q", src, "-d", dst]);
  }
}

interface ManifestItem {
  localPath: string;
  storagePath: string;
  title: string;
  description: string | null;
  kind: "video" | "pdf" | "image" | "archive";
  category: "onboarding" | "tutorial" | "brand" | "compliance" | "guide";
  sort_order: number;
  generateThumb?: boolean;
}

const HOW_TO = `${UNPACKED}/How to Use Kashu`;
const BRAND  = `${UNPACKED}/Brand Assets`;

const MANIFEST: ManifestItem[] = [
  { localPath: `${ROOT}/Affiliate Onboarding Video.mp4`, storagePath: "videos/onboarding.mp4",
    title: "Affiliate Onboarding", description: "Welcome video for new Kashu affiliates.",
    kind: "video", category: "onboarding", sort_order: 0, generateThumb: true },
  { localPath: `${HOW_TO}/Overview.mp4`,                storagePath: "videos/overview.mp4",
    title: "Kashu Overview", description: "End-to-end walkthrough of the wallet.",
    kind: "video", category: "tutorial", sort_order: 10, generateThumb: true },
  { localPath: `${HOW_TO}/Creating_Account.mp4`,        storagePath: "videos/creating_account.mp4",
    title: "Creating an Account", description: "Show users how to sign up.",
    kind: "video", category: "tutorial", sort_order: 20, generateThumb: true },
  { localPath: `${HOW_TO}/Verify_Identity.mp4`,         storagePath: "videos/verify_identity.mp4",
    title: "Verifying Identity", description: "Walk through KYC.",
    kind: "video", category: "tutorial", sort_order: 30, generateThumb: true },
  { localPath: `${HOW_TO}/Connecting_Credit_Card.mp4`,  storagePath: "videos/connecting_credit_card.mp4",
    title: "Connecting a Card", description: "Funding via credit card.",
    kind: "video", category: "tutorial", sort_order: 40, generateThumb: true },
  { localPath: `${HOW_TO}/Depositing_Funds.mp4`,        storagePath: "videos/depositing_funds.mp4",
    title: "Depositing Funds", description: "Moving money into the wallet.",
    kind: "video", category: "tutorial", sort_order: 50, generateThumb: true },
  { localPath: `${HOW_TO}/Moving_Funds.mp4`,            storagePath: "videos/moving_funds.mp4",
    title: "Moving Funds", description: "Sending money out.",
    kind: "video", category: "tutorial", sort_order: 60, generateThumb: true },

  { localPath: `${ROOT}/Creator Playbook.pdf`,          storagePath: "docs/creator_playbook.pdf",
    title: "Creator Playbook", description: "Best practices for promoting Kashu.",
    kind: "pdf", category: "guide", sort_order: 10 },
  { localPath: `${ROOT}/Kashu Affiliate FAQ_s.pdf`,     storagePath: "docs/affiliate_faqs.pdf",
    title: "Affiliate FAQs", description: "Common questions, answered.",
    kind: "pdf", category: "guide", sort_order: 20 },
  { localPath: `${ROOT}/Use Cases & Examples.pdf`,      storagePath: "docs/use_cases.pdf",
    title: "Use Cases & Examples", description: "Sample scenarios you can adapt.",
    kind: "pdf", category: "guide", sort_order: 30 },
  { localPath: `${ROOT}/Kashu Affiliate Code of Conduct.pdf`, storagePath: "docs/code_of_conduct.pdf",
    title: "Affiliate Code of Conduct", description: "What we expect from you.",
    kind: "pdf", category: "compliance", sort_order: 10 },

  { localPath: `${ROOT}/Kashu Brand Kit.pdf`,           storagePath: "brand/brand_kit.pdf",
    title: "Brand Kit (PDF)", description: "Logos, colors, type — at a glance.",
    kind: "pdf", category: "brand", sort_order: 10 },
  { localPath: `${BRAND}/Logo files/SVG/Logo.svg`,      storagePath: "brand/logo.svg",
    title: "Logo (SVG)", description: "Vector logo for production design work.",
    kind: "image", category: "brand", sort_order: 20 },
  { localPath: `${ROOT}/Brand Assets.zip`,              storagePath: "brand/brand_assets.zip",
    title: "Brand Assets (full zip)", description: "Everything: logos, icons, renders.",
    kind: "archive", category: "brand", sort_order: 99 },
];

function contentTypeFor(kind: string, path: string): string {
  if (kind === "video") return "video/mp4";
  if (kind === "pdf") return "application/pdf";
  if (kind === "archive") return "application/zip";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

async function generateThumb(item: ManifestItem): Promise<{ thumbStoragePath: string; durationSec: number | null } | null> {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); }
  catch { console.warn("ffmpeg missing; skip thumb"); return null; }

  const slug = item.storagePath.split("/").pop()!.replace(/\.mp4$/, "");
  const thumbLocal = resolve(UNPACKED, `${slug}.jpg`);
  try {
    execFileSync("ffmpeg",
      ["-y", "-ss", "00:00:02", "-i", item.localPath, "-vframes", "1", "-q:v", "4", thumbLocal],
      { stdio: "ignore" });
  } catch { return null; }

  const thumbStoragePath = `videos/thumbs/${slug}.jpg`;
  const buf = readFileSync(thumbLocal);
  const { error: thumbErr } = await supa.storage.from(BUCKET).upload(
    thumbStoragePath, buf, { upsert: true, contentType: "image/jpeg" }
  );
  if (thumbErr) { console.warn(`thumb upload failed for ${item.storagePath}: ${thumbErr.message}`); return null; }

  let durationSec: number | null = null;
  try {
    const out = execFileSync("ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", item.localPath]).toString();
    durationSec = Math.round(parseFloat(out));
  } catch {}
  return { thumbStoragePath, durationSec };
}

async function ensureUploaded(item: ManifestItem) {
  if (!existsSync(item.localPath)) { console.warn(`MISSING ${item.localPath}`); return; }
  const buf = readFileSync(item.localPath);
  const size = statSync(item.localPath).size;

  const dir = item.storagePath.split("/").slice(0, -1).join("/") || "";
  const name = item.storagePath.split("/").pop()!;
  const { data: existing } = await supa.storage.from(BUCKET).list(dir, { search: name });
  const already = existing?.find((f) => f.name === name);
  if (already && (already.metadata as any)?.size === size) {
    console.log(`skip ${item.storagePath} (unchanged)`);
  } else {
    console.log(`upload ${item.storagePath} (${(size/1024/1024).toFixed(1)} MB)`);
    const { error } = await supa.storage.from(BUCKET).upload(item.storagePath, buf, {
      upsert: true, contentType: contentTypeFor(item.kind, item.localPath),
    });
    if (error) throw error;
  }

  let thumbnail_path: string | null = null;
  let duration_seconds: number | null = null;
  if (item.generateThumb) {
    const t = await generateThumb(item);
    if (t) { thumbnail_path = t.thumbStoragePath; duration_seconds = t.durationSec; }
  }

  const public_url = supa.storage.from(BUCKET).getPublicUrl(item.storagePath).data.publicUrl;

  const { error: upErr } = await (supa as any)
    .from("affiliate_resources")
    .upsert({
      title: item.title,
      description: item.description,
      kind: item.kind,
      category: item.category,
      storage_path: item.storagePath,
      public_url,
      thumbnail_path,
      file_size_bytes: size,
      duration_seconds,
      sort_order: item.sort_order,
      is_published: true,
    }, { onConflict: "storage_path" });
  if (upErr) throw upErr;
}

(async () => {
  unpackZips();
  for (const item of MANIFEST) await ensureUploaded(item);
  console.log("done");
})().catch((e) => { console.error(e); process.exit(1); });
