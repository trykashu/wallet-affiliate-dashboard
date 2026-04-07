import { redirect }             from "next/navigation";
import { cookies }              from "next/headers";
import { createClient }        from "@/lib/supabase/server";
import { isAdminEmail }        from "@/lib/admin";
import { VIEW_AS_COOKIE }      from "@/lib/affiliate-context";
import AppSidebar              from "@/components/layout/AppSidebar";
import AutoRefresh             from "@/components/layout/AutoRefresh";
import RealtimeRefresh         from "@/components/layout/RealtimeRefresh";
import NotificationBell        from "@/components/layout/NotificationBell";
import PageTitle               from "@/components/ui/PageTitle";
import type { Affiliate }      from "@/types/database";

export const dynamic = "force-dynamic";

const AFFILIATE_NAV = [
  { label: "Dashboard",      href: "/dashboard",                icon: "grid"    as const, exact: true },
  { label: "Users",          href: "/dashboard/users",          icon: "users"   as const },
  { label: "Earnings",       href: "/dashboard/earnings",       icon: "wallet"  as const },
  { label: "Payouts",        href: "/dashboard/payouts",        icon: "dollar"  as const },
  { label: "Analytics",      href: "/dashboard/analytics",      icon: "chart"   as const },
  { label: "Referral Links", href: "/dashboard/referral-link",  icon: "link"    as const },
  { label: "Support",        href: "/dashboard/support",        icon: "support" as const },
] as const;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isPreview = process.env.PREVIEW_BYPASS_AUTH === "true" && process.env.VERCEL_ENV === "preview";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && !isPreview) redirect("/login");

  const isAdmin = user ? isAdminEmail(user.email) : false;

  // -- Resolve effective affiliate (view-as or own) --
  const cookieStore  = await cookies();
  const viewAsCookie = cookieStore.get(VIEW_AS_COOKIE);
  let affiliate: Affiliate | null = null;
  let isViewingAs = false;
  let viewingAsName: string | null = null;

  if (isAdmin && viewAsCookie?.value) {
    try {
      const { affiliate_id, affiliate_name } = JSON.parse(viewAsCookie.value);
      const { createServiceClient } = await import("@/lib/supabase/service");
      const svc = createServiceClient();
      const { data } = await (svc as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .from("affiliates")
        .select("*")
        .eq("id", affiliate_id)
        .single();
      affiliate     = data as Affiliate | null;
      isViewingAs   = true;
      viewingAsName = affiliate_name;
    } catch { /* malformed cookie -- fall through to normal */ }
  }

  // Preview bypass: load an affiliate via service client without auth
  if (!affiliate && isPreview) {
    const { createServiceClient } = await import("@/lib/supabase/service");
    const svc = createServiceClient();
    const db = svc as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (process.env.PREVIEW_AFFILIATE_ID) {
      const { data } = await db.from("affiliates").select("*").eq("id", process.env.PREVIEW_AFFILIATE_ID).single();
      affiliate = data as Affiliate | null;
    } else {
      const { data } = await db.from("affiliates").select("*").eq("status", "active").order("created_at", { ascending: true }).limit(1).single();
      affiliate = data as Affiliate | null;
    }
  }

  if (!affiliate) {
    // Normal mode: RLS-scoped affiliate lookup
    const db = supabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: affiliateRaw } = await db.from("affiliates").select("*").single();
    affiliate = affiliateRaw as Affiliate | null;
  }

  if (!affiliate) {
    if (isAdmin) redirect("/admin");
    return <AccountPending userEmail={user?.email ?? ""} />;
  }

  // SSR unread notification count (skip in preview without user)
  let unreadCount = 0;
  if (user) {
    const db = supabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { count } = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("affiliate_id", affiliate.id)
      .eq("is_read", false);
    unreadCount = count ?? 0;
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  // -- Server action: exit view-as --
  async function exitViewAs() {
    "use server";
    const cookieStore = await cookies();
    cookieStore.delete(VIEW_AS_COOKIE);
    redirect("/admin");
  }

  return (
    <div className="flex min-h-screen relative">
      {/* Page-level ambient orbs */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="ambient-orb w-[600px] h-[600px] bg-accent/[0.03] -top-48 -right-48" />
        <div className="ambient-orb w-[500px] h-[500px] bg-brand-600/[0.04] -bottom-32 -left-32" style={{ animationDelay: "-7s" }} />
      </div>

      <AppSidebar
        userEmail={user?.email ?? ""}
        userName={affiliate.agent_name}
        companyName={affiliate.business_name ?? undefined}
        navItems={[...AFFILIATE_NAV]}
        isAdmin={isAdmin && !isViewingAs}
        tier={affiliate.tier}
      />

      <div className="flex-1 lg:pl-64 min-w-0 relative z-10">

        {/* -- View-as banner -- */}
        {isViewingAs && (
          <div className="bg-amber-500 text-amber-950 px-6 py-2.5 flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>
                Admin view-as mode — viewing dashboard as{" "}
                <strong className="font-semibold">{viewingAsName}</strong>
              </span>
            </div>
            <form action={exitViewAs}>
              <button
                type="submit"
                className="flex items-center gap-1.5 bg-amber-900/15 hover:bg-amber-900/25 border border-amber-900/20
                           rounded-xl px-3 py-1 text-xs font-semibold transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Exit view
              </button>
            </form>
          </div>
        )}

        {/* -- Top bar -- */}
        <header className="sticky top-0 z-30 bg-white/70 backdrop-blur-xl border-b border-surface-200/60">
          <div className="pl-16 pr-4 sm:pr-6 lg:pl-8 lg:pr-8 h-16 flex items-center justify-between gap-4">
            <PageTitle />

            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="hidden sm:flex flex-col items-end">
                <p className="text-sm font-semibold text-gray-900 leading-tight">{affiliate.agent_name}</p>
                <p className="text-[11px] text-brand-400 leading-tight">
                  {affiliate.business_name ?? today}
                </p>
              </div>
              <div className="w-px h-6 bg-surface-200 hidden sm:block" />
              {isAdmin && !isViewingAs && (
                <a
                  href="/admin"
                  className="badge-amber text-xs px-3 py-1.5 rounded-xl border font-semibold"
                >
                  Admin Panel
                </a>
              )}
              <NotificationBell
                affiliateId={affiliate.id}
                initialCount={unreadCount ?? 0}
              />
            </div>
          </div>
        </header>

        {/* -- Page content -- */}
        <main className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-5 sm:space-y-7 animate-fade-in">
          {children}
        </main>

        <AutoRefresh />
        <RealtimeRefresh />
      </div>
    </div>
  );
}

function AccountPending({ userEmail }: { userEmail: string }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center max-w-sm animate-fade-in">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-brand-600/20 border border-brand-600/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-brand-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-brand-600">Account Being Set Up</h1>
        <p className="mt-3 text-sm text-brand-400 leading-relaxed">
          Your affiliate account is being provisioned.
          <br />You&apos;ll receive an email at <span className="text-brand-600">{userEmail}</span> once it&apos;s ready.
        </p>
      </div>
    </div>
  );
}
