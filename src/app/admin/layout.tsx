import { redirect }        from "next/navigation";
import { createClient }    from "@/lib/supabase/server";
import { isAdminEmail }    from "@/lib/admin";
import AppSidebar          from "@/components/layout/AppSidebar";

export const dynamic = "force-dynamic";

const ADMIN_NAV = [
  { label: "Overview",    href: "/admin",              icon: "grid"    as const, exact: true },
  { label: "Affiliates",  href: "/admin/affiliates",   icon: "users"   as const },
  { label: "Users",       href: "/admin/users",        icon: "link"    as const },
  { label: "Funnel",      href: "/admin/funnel",       icon: "chart"   as const },
  { label: "Earnings",    href: "/admin/earnings",     icon: "wallet"  as const },
  { label: "Payouts",     href: "/admin/payouts",      icon: "dollar"  as const },
  { label: "Settings",    href: "/admin/settings",     icon: "support" as const },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) redirect("/dashboard");

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  return (
    <div className="flex min-h-screen relative">
      {/* Page-level ambient orbs */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="ambient-orb w-[600px] h-[600px] bg-brand-600/[0.04] -top-48 -right-48" />
        <div className="ambient-orb w-[500px] h-[500px] bg-accent/[0.03] -bottom-32 -left-32" style={{ animationDelay: "-7s" }} />
      </div>

      <AppSidebar
        userEmail={user.email ?? ""}
        navItems={ADMIN_NAV}
        isAdmin={true}
        hideProfile
        profileHref="/admin"
      />

      <div className="flex-1 lg:pl-64 min-w-0 relative z-10">
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-white/70 backdrop-blur-xl border-b border-surface-200/60">
          <div className="pl-16 pr-4 sm:pr-6 lg:pl-8 lg:pr-8 h-16 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="text-base font-semibold text-gray-900">Admin Panel</h1>
                <span className="badge-amber text-[10px] px-2 py-0.5 rounded-xl border font-semibold">Admin</span>
              </div>
              <p className="text-[11px] text-brand-400 hidden sm:block">{today}</p>
            </div>
            <a
              href="/dashboard"
              className="flex items-center gap-1.5 text-xs font-medium text-brand-600 border border-brand-200
                         hover:border-brand-400 hover:text-brand-700 bg-white rounded-lg px-3 py-2
                         transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
              </svg>
              Back to Dashboard
            </a>
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
