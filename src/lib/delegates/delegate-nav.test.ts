import { test } from "node:test";
import assert from "node:assert/strict";
import { filterNavForDelegate } from "./delegate-nav";

const NAV = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Users",     href: "/dashboard/users" },
  { label: "Earnings",  href: "/dashboard/earnings" },
  { label: "Payouts",   href: "/dashboard/payouts" },
  { label: "Tools",     href: "/dashboard/tools" },
  { label: "Support",   href: "/dashboard/support" },
];

test("owner (not delegate) keeps all nav", () => {
  const out = filterNavForDelegate(NAV, { isDelegate: false, canViewEarnings: false, canViewPayouts: false });
  assert.equal(out.length, 6);
});

test("delegate with no flags loses Earnings + Payouts", () => {
  const out = filterNavForDelegate(NAV, { isDelegate: true, canViewEarnings: false, canViewPayouts: false });
  const hrefs = out.map((n) => n.href);
  assert.ok(!hrefs.includes("/dashboard/earnings"));
  assert.ok(!hrefs.includes("/dashboard/payouts"));
  assert.ok(hrefs.includes("/dashboard/users"));
  assert.ok(hrefs.includes("/dashboard/tools"));
});

test("delegate with earnings flag keeps Earnings but not Payouts", () => {
  const out = filterNavForDelegate(NAV, { isDelegate: true, canViewEarnings: true, canViewPayouts: false });
  const hrefs = out.map((n) => n.href);
  assert.ok(hrefs.includes("/dashboard/earnings"));
  assert.ok(!hrefs.includes("/dashboard/payouts"));
});
