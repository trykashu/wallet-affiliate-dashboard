"use client";

import { usePathname } from "next/navigation";

const PAGE_META: Record<string, { title: string; sub: string }> = {
  "/dashboard":                  { title: "Dashboard",       sub: "Overview & performance"                            },
  "/dashboard/users":            { title: "Users",           sub: "Track referred users through the funnel"           },
  "/dashboard/earnings":         { title: "Earnings",        sub: "Commissions, residuals, and payout history"        },
  "/dashboard/payouts":          { title: "Payouts",         sub: "Manage withdrawals and payout accounts"            },
  "/dashboard/analytics":        { title: "Analytics",       sub: "Leaderboards, rankings, and performance trends"    },
  "/dashboard/referral-link":    { title: "Referral Links",  sub: "Share links for user recruitment"                  },
  "/dashboard/support":          { title: "Support",         sub: "Report issues, share feedback, or request features" },
  "/dashboard/profile":          { title: "My Profile",      sub: "Account & security settings"                       },
};

export default function PageTitle() {
  const pathname = usePathname();
  // Match exact first, then strip trailing segments for nested routes
  const meta =
    PAGE_META[pathname] ??
    PAGE_META[
      Object.keys(PAGE_META)
        .filter((k) => pathname.startsWith(k + "/"))
        .sort((a, b) => b.length - a.length)[0]
    ] ?? { title: "Dashboard", sub: "" };

  return (
    <div className="min-w-0">
      <h1 className="text-base font-semibold text-gray-900 truncate">{meta.title}</h1>
      {meta.sub && (
        <p className="text-[11px] text-brand-400 leading-tight hidden sm:block">{meta.sub}</p>
      )}
    </div>
  );
}
