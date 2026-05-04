/**
 * affiliate-context.ts
 * --------------------
 * Central utility that resolves the "effective" affiliate for any dashboard page.
 *
 * Normal mode:  anon client -> RLS auto-scopes all queries to the logged-in affiliate.
 * View-as mode: admin has set the `wallet_view_as` cookie -> service client + explicit
 *               affiliate_id filtering so the admin sees exactly what the target
 *               affiliate would see.
 *
 * Usage in any dashboard server component:
 *   const ctx = await getAffiliateContext();
 *   if (!ctx) return null;
 *   const { db, affiliate, affiliateId, isViewingAs, viewingAsName, brand } = ctx;
 *
 *   // Query with explicit affiliate_id (works in both modes)
 *   const { data } = await db.from("referred_users")
 *     .select("*")
 *     .eq("affiliate_id", affiliateId)
 *     .order("created_at", { ascending: false });
 */

import { cookies }             from "next/headers";
import { createServiceClient } from "./supabase/service";
import { createClient }        from "./supabase/server";
import { isAdminEmail }        from "./admin";
import type { Affiliate, WhitelabelBrand } from "@/types/database";

/** Default Kashu signup landing URL — used when an affiliate's whitelabel brand
 *  has no `signup_base_url` configured (or the affiliate has no brand at all). */
export const DEFAULT_SIGNUP_BASE_URL = "https://signup.kashupay.com";

export interface AffiliateContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db:             any;
  affiliate:      Affiliate;
  affiliateId:    string;
  isViewingAs:    boolean;
  viewingAsName:  string | null;
  brand:          WhitelabelBrand | null;
}

export const VIEW_AS_COOKIE = "wallet_view_as";

export interface ViewAsCookiePayload {
  affiliate_id:   string;
  affiliate_name: string;
}

/** Parse the view-as cookie safely — returns null on any error. */
export async function getViewAsPayload(): Promise<ViewAsCookiePayload | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(VIEW_AS_COOKIE)?.value;
    if (!raw) return null;
    return JSON.parse(raw) as ViewAsCookiePayload;
  } catch {
    return null;
  }
}

/** Fetch the whitelabel brand for an affiliate (null if unset). */
async function fetchBrand(brandId: string | null): Promise<WhitelabelBrand | null> {
  if (!brandId) return null;
  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brandRaw } = await (svc as any)
    .from("whitelabel_brands")
    .select("*")
    .eq("id", brandId)
    .single();
  return (brandRaw ?? null) as WhitelabelBrand | null;
}

/**
 * Returns the effective affiliate context for a dashboard page.
 * Returns null if no valid affiliate is found (caller should `return null`).
 */
export async function getAffiliateContext(): Promise<AffiliateContext | null> {
  const viewAs = await getViewAsPayload();

  if (viewAs) {
    // ── View-as mode: re-verify caller is still an admin before using service client ──
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();

    if (user && isAdminEmail(user.email)) {
      const svc = createServiceClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = svc as any;
      const { data: affiliateRaw } = await db
        .from("affiliates")
        .select("*")
        .eq("id", viewAs.affiliate_id)
        .single();

      if (!affiliateRaw) return null;

      const affiliate = affiliateRaw as Affiliate;
      const brand = await fetchBrand(affiliate.whitelabel_brand_id);

      return {
        db,
        affiliate,
        affiliateId:    viewAs.affiliate_id,
        isViewingAs:    true,
        viewingAsName:  viewAs.affiliate_name,
        brand,
      };
    }
    // Not an admin — fall through to normal mode (ignore the cookie)
  }

  // ── Preview bypass: use service client with a specific affiliate ──────────────
  if (
    process.env.PREVIEW_BYPASS_AUTH === "true" &&
    process.env.VERCEL_ENV === "preview"
  ) {
    const svc = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = svc as any;

    let affiliateRaw;
    if (process.env.PREVIEW_AFFILIATE_ID) {
      ({ data: affiliateRaw } = await db
        .from("affiliates")
        .select("*")
        .eq("id", process.env.PREVIEW_AFFILIATE_ID)
        .single());
    } else {
      // Fall back to first active affiliate
      ({ data: affiliateRaw } = await db
        .from("affiliates")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: true })
        .limit(1)
        .single());
    }

    if (!affiliateRaw) return null;
    const affiliate = affiliateRaw as Affiliate;
    const brand = await fetchBrand(affiliate.whitelabel_brand_id);
    return {
      db,
      affiliate,
      affiliateId:    affiliate.id,
      isViewingAs:    false,
      viewingAsName:  null,
      brand,
    };
  }

  // ── Normal mode: use anon client (RLS handles all scoping) ─────────────────
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: affiliateRaw } = await db.from("affiliates").select("*").single();
  if (!affiliateRaw) return null;

  const affiliate = affiliateRaw as Affiliate;
  const brand = await fetchBrand(affiliate.whitelabel_brand_id);

  return {
    db,
    affiliate,
    affiliateId:    affiliate.id,
    isViewingAs:    false,
    viewingAsName:  null,
    brand,
  };
}
