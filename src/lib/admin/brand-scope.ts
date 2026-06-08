import { cookies } from "next/headers";

/**
 * Admin brand scope — lets the admin view the Kashu business or the Payova
 * (whitelabel) business in isolation. Persisted in the `admin_brand` cookie,
 * toggled from the header. Payova-referred affiliates (and their users /
 * earnings / transactions) are kept entirely separate from Kashu in the
 * scoped admin views. The Payouts page intentionally ignores this and stays
 * Kashu-only for wire safety.
 */
export type BrandScope = "kashu" | "payova";

export async function getBrandScope(): Promise<BrandScope> {
  const store = await cookies();
  return store.get("admin_brand")?.value === "payova" ? "payova" : "kashu";
}

/** True when a row's whitelabel_brand_id belongs to the active scope. */
export function inScope(whitelabelBrandId: string | null | undefined, scope: BrandScope): boolean {
  return scope === "payova" ? whitelabelBrandId != null : whitelabelBrandId == null;
}
