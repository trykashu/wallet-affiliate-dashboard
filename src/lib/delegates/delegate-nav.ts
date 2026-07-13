export interface NavGateOpts {
  isDelegate: boolean;
  canViewEarnings: boolean;
  canViewPayouts: boolean;
}

/** Removes Earnings/Payouts nav items a delegate isn't permitted to see. Owners keep everything. */
export function filterNavForDelegate<T extends { href: string }>(
  nav: readonly T[],
  opts: NavGateOpts,
): T[] {
  if (!opts.isDelegate) return [...nav];
  return nav.filter((item) => {
    if (item.href === "/dashboard/earnings") return opts.canViewEarnings;
    if (item.href === "/dashboard/payouts")  return opts.canViewPayouts;
    return true;
  });
}
