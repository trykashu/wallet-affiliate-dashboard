import { redirect }            from "next/navigation";
import { GeistSans }           from "geist/font/sans";
import { GeistMono }           from "geist/font/mono";
import { createClient }        from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdminEmail }        from "@/lib/admin";
import AdminSidebar            from "@/components/admin/AdminSidebar";
import BalanceVisibilityToggle from "@/components/admin/BalanceVisibilityToggle";
import type { NavItem }        from "@/components/layout/AppSidebar";

export const dynamic = "force-dynamic";

const BASE_ADMIN_NAV: NavItem[] = [
  { label: "Overview",    href: "/admin",              icon: "grid"    as const, exact: true },
  { label: "Affiliates",  href: "/admin/affiliates",   icon: "users"   as const },
  { label: "Users",       href: "/admin/users",        icon: "link"    as const },
  { label: "Transactions", href: "/admin/transactions", icon: "dollar"  as const },
  { label: "Funnel",      href: "/admin/funnel",       icon: "chart"   as const },
  { label: "Earnings",    href: "/admin/earnings",     icon: "wallet"  as const },
  { label: "Payouts",     href: "/admin/payouts",      icon: "dollar"  as const },
  { label: "Resources",       href: "/admin/resources",         icon: "grid"    as const },
  { label: "Share Templates", href: "/admin/share-templates",   icon: "link"    as const },
  { label: "Settings",    href: "/admin/settings",     icon: "support" as const },
];

async function getPendingReviewBatchCount(): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = createServiceClient() as any;
    const { data } = await svc
      .from("payouts")
      .select("batch_id")
      .eq("status", "pending_review")
      .not("batch_id", "is", null);
    type Row = { batch_id: string | null };
    const distinct = new Set<string>();
    for (const r of (data as Row[] | null) ?? []) {
      if (r.batch_id) distinct.add(r.batch_id);
    }
    return distinct.size;
  } catch {
    return 0;
  }
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  const pendingReviewCount = await getPendingReviewBatchCount();
  const adminNav: NavItem[] = BASE_ADMIN_NAV.map((item) =>
    item.href === "/admin/payouts"
      ? { ...item, badge: pendingReviewCount }
      : item,
  );

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  return (
    <div
      data-admin-theme
      className={`${GeistSans.variable} ${GeistMono.variable} flex min-h-screen relative`}
      style={{
        // Map the self-hosted Geist variables onto the admin font tokens so
        // globals.css can stay token-driven (var(--font-admin)).
        ["--font-admin" as string]: "var(--font-geist-sans)",
        ["--font-admin-mono" as string]: "var(--font-geist-mono)",
      } as React.CSSProperties}
    >
      <AdminSidebar userEmail={user.email ?? ""} navItems={adminNav} />

      <div className="flex-1 lg:pl-64 min-w-0 relative z-10">
        {/* Top bar */}
        <header
          className="sticky top-0 z-30 backdrop-blur-xl"
          style={{ backgroundColor: "rgba(11, 14, 19, 0.8)", borderBottom: "1px solid var(--ad-border)" }}
        >
          <div className="pl-16 pr-4 sm:pr-6 lg:pl-8 lg:pr-8 h-16 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="text-base font-semibold ad-text-1">Admin Panel</h1>
                <span className="ad-badge-accent">Admin</span>
              </div>
              <p className="text-[11px] ad-text-3 hidden sm:block">{today}</p>
            </div>
            <div className="flex items-center gap-2.5">
              <BalanceVisibilityToggle />
              <a href="/dashboard" className="ad-btn-ghost flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                </svg>
                <span className="hidden sm:inline">Back to Dashboard</span>
              </a>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-5 sm:space-y-7 animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
