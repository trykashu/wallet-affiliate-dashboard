"use client";

import { usePathname } from "next/navigation";

const TITLES: Record<string, string> = {
  "/demo":               "Dashboard",
  "/demo/users":         "Referred Users",
  "/demo/earnings":      "Earnings",
  "/demo/payouts":       "Payouts",
  "/demo/referral-link": "Referral Link",
  "/demo/support":       "Support",
};

export default function DemoPageTitle() {
  const pathname = usePathname();
  const title = TITLES[pathname] ?? "Demo";
  return <h1 className="text-lg font-bold text-gray-900">{title}</h1>;
}
