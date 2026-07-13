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
import type { Affiliate, WhitelabelBrand, DelegatePermissions } from "@/types/database";

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
  /** True when the effective session is a delegate acting on the owner's account. */
  isDelegate:          boolean;
  /** The delegate's own email (null unless isDelegate). */
  delegateEmail:       string | null;
  /** The owner affiliate's display name, for the delegate banner (null unless isDelegate). */
  delegateOwnerName:   string | null;
  /** What the delegate may see. For a real owner: both true (no restriction). */
  delegatePermissions: DelegatePermissions;
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

export interface DelegateResolution {
  affiliate:     Affiliate;
  affiliateId:   string;
  ownerName:     string;
  delegateEmail: string;
  permissions:   DelegatePermissions;
}

/**
 * Resolve a delegate session to the OWNER's affiliate.
 * - Fast path: service-client lookup by delegate_user_id (already accepted).
 * - First login: the row isn't stamped yet, so call accept_delegate_invite()
 *   via the ANON client (it reads auth.uid()/auth.jwt()), then re-read.
 * Returns null if the user is not a delegate.
 */
export async function resolveDelegateContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  anonClient: any,
  userId: string,
): Promise<DelegateResolution | null> {
  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = svc as any;

  let { data: row } = await s
    .from("affiliate_delegates")
    .select("*")
    .eq("delegate_user_id", userId)
    .maybeSingle();

  if (!row) {
    // First login — stamp via the RPC (uses the caller's own session), then re-read.
    await anonClient.rpc("accept_delegate_invite");
    ({ data: row } = await s
      .from("affiliate_delegates")
      .select("*")
      .eq("delegate_user_id", userId)
      .maybeSingle());
  }

  if (!row) return null;

  const { data: affiliateRaw } = await s
    .from("affiliates")
    .select("*")
    .eq("id", row.affiliate_id)
    .single();
  if (!affiliateRaw) return null;

  const affiliate = affiliateRaw as Affiliate;
  return {
    affiliate,
    affiliateId:   affiliate.id,
    ownerName:     affiliate.agent_name,
    delegateEmail: row.delegate_email,
    permissions: {
      canViewEarnings: !!row.can_view_earnings,
      canViewPayouts:  !!row.can_view_payouts,
    },
  };
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
        isDelegate:          false,
        delegateEmail:       null,
        delegateOwnerName:   null,
        delegatePermissions: { canViewEarnings: true, canViewPayouts: true },
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
      isDelegate:          false,
      delegateEmail:       null,
      delegateOwnerName:   null,
      delegatePermissions: { canViewEarnings: true, canViewPayouts: true },
    };
  }

  // ── Normal mode: use anon client (RLS handles all scoping) ─────────────────
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: affiliateRaw } = await db.from("affiliates").select("*").single();

  if (affiliateRaw) {
    const affiliate = affiliateRaw as Affiliate;
    const brand = await fetchBrand(affiliate.whitelabel_brand_id);
    return {
      db,
      affiliate,
      affiliateId:    affiliate.id,
      isViewingAs:    false,
      viewingAsName:  null,
      brand,
      isDelegate:          false,
      delegateEmail:       null,
      delegateOwnerName:   null,
      delegatePermissions: { canViewEarnings: true, canViewPayouts: true },
    };
  }

  // ── Delegate mode: no affiliate row for this user — maybe they're a delegate ──
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const deleg = await resolveDelegateContext(supabase, user.id);
    if (deleg) {
      const brand = await fetchBrand(deleg.affiliate.whitelabel_brand_id);
      // Delegates read via the service client (RLS is owner-only and won't scope to them).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegateDb = createServiceClient() as any;
      return {
        db: delegateDb,
        affiliate:     deleg.affiliate,
        affiliateId:   deleg.affiliateId,
        isViewingAs:   false,
        viewingAsName: null,
        brand,
        isDelegate:          true,
        delegateEmail:       deleg.delegateEmail,
        delegateOwnerName:   deleg.ownerName,
        delegatePermissions: deleg.permissions,
      };
    }
  }

  return null;
}
