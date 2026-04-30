import AppSidebar from "@/components/layout/AppSidebar";
import type { NavItem } from "@/components/layout/AppSidebar";
import DemoPageTitle from "@/components/layout/DemoPageTitle";

export const dynamic = "force-dynamic";

const DEMO_NAV: NavItem[] = [
  { label: "Dashboard",      href: "/demo",                icon: "grid"    as const, exact: true },
  { label: "Users",          href: "/demo/users",          icon: "users"   as const },
  { label: "Earnings",       href: "/demo/earnings",       icon: "wallet"  as const },
  { label: "Payouts",        href: "/demo/payouts",        icon: "dollar"  as const },
  { label: "Referral Links", href: "/demo/referral-link",  icon: "link"    as const },
  { label: "Support",        href: "/demo/support",        icon: "support" as const },
];

export const metadata = {
  title: "Demo | Kashu Wallet Affiliate Dashboard",
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen relative">
      {/* Page-level ambient orbs */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="ambient-orb w-[600px] h-[600px] bg-accent/[0.03] -top-48 -right-48" />
        <div className="ambient-orb w-[500px] h-[500px] bg-brand-600/[0.04] -bottom-32 -left-32" style={{ animationDelay: "-7s" }} />
      </div>

      <AppSidebar
        userEmail="alex@riveragrowth.com"
        userName="Alex Rivera"
        companyName="Rivera Growth Partners"
        navItems={DEMO_NAV}
        tier="platinum"
        hideSignOut
        hideProfile
      />

      <div className="flex-1 lg:pl-64 min-w-0 relative z-10">
        {/* Demo mode banner */}
        <div className="bg-purple-500 text-white px-6 py-2.5 flex items-center justify-between gap-4 text-sm">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
            </svg>
            <span>
              Demo Mode — viewing sample data for{" "}
              <strong className="font-semibold">Alex Rivera</strong>
            </span>
          </div>
          <a
            href="/login"
            className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 border border-white/20
                       rounded-xl px-3 py-1 text-xs font-semibold transition-colors"
          >
            Sign in to your account
          </a>
        </div>

        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-white/70 backdrop-blur-xl border-b border-surface-200/60">
          <div className="pl-16 pr-4 sm:pr-6 lg:pl-8 lg:pr-8 h-16 flex items-center justify-between gap-4">
            <DemoPageTitle />
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="hidden sm:flex flex-col items-end">
                <p className="text-sm font-semibold text-gray-900 leading-tight">Alex Rivera</p>
                <p className="text-[11px] text-brand-400 leading-tight">Rivera Growth Partners</p>
              </div>
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
