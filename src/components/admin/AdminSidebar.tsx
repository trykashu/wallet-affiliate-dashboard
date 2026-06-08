"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import type { NavItem } from "@/components/layout/AppSidebar";

/* -- Icon set (inline SVG, no external deps) -- */
const Icons = {
  grid: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
  users: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),
  wallet: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
    </svg>
  ),
  dollar: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  chart: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
    </svg>
  ),
  link: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  ),
  support: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
    </svg>
  ),
  signout: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
    </svg>
  ),
  menu: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  ),
  close: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  profile: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
};

interface AdminSidebarProps {
  userEmail: string;
  navItems: NavItem[];
}

/**
 * Admin-only sidebar — a charcoal + indigo fork of AppSidebar. The affiliate
 * AppSidebar (teal) is intentionally left untouched; this consumes the admin
 * design tokens ([data-admin-theme] scope). No whitelabel/brand logic: the
 * admin shell is always the Kashu charcoal theme.
 */
export default function AdminSidebar({ userEmail, navItems }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function isActive(item: NavItem) {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(item.href + "/");
  }

  const initials = userEmail.charAt(0).toUpperCase();
  const displayName = userEmail.split("@")[0];

  const sidebar = (
    <div className="flex flex-col h-full relative">
      {/* Logo */}
      <div
        className="relative flex items-center px-5 h-16 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--ad-border)" }}
      >
        <Image
          src="/kashu-logo-white.png"
          alt="Kashu"
          width={100}
          height={32}
          className="relative object-contain z-10"
          priority
        />
      </div>

      {/* Nav */}
      <nav className="relative flex-1 px-3 py-3 space-y-0.5 overflow-y-auto scrollbar-dark z-10">
        <p className="ad-nav-label">Navigation</p>
        {navItems.map((item) => {
          const active = isActive(item);
          return (
            <div key={item.href}>
              {item.sectionLabel && <p className="ad-nav-label">{item.sectionLabel}</p>}
              <a
                href={item.href}
                className={`ad-nav-item group relative ${active ? "ad-nav-item-active" : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                    style={{ backgroundColor: "var(--ad-accent)" }}
                  />
                )}
                <span
                  className="flex-shrink-0"
                  style={active ? { color: "var(--ad-accent)" } : undefined}
                >
                  {Icons[item.icon]}
                </span>
                <span className="flex-1 text-[13px]">{item.label}</span>
                {typeof item.badge === "number" && item.badge > 0 && (
                  <span
                    className="ad-badge-amber text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full leading-none min-w-[18px] text-center"
                    title={`${item.badge} pending`}
                  >
                    {item.badge}
                  </span>
                )}
              </a>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="relative flex-shrink-0 px-3 pb-4 space-y-1 z-10">
        <div className="ad-divider my-2" />

        {/* User card */}
        <div
          className="flex items-center gap-3 px-3 py-3 rounded-2xl mt-1"
          style={{ backgroundColor: "var(--ad-inset)", border: "1px solid var(--ad-border)" }}
        >
          <div className="relative flex-shrink-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: "var(--ad-accent-soft)", border: "1px solid var(--ad-accent-border)" }}
            >
              <span className="text-xs font-bold" style={{ color: "var(--ad-accent-strong)" }}>
                {initials}
              </span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate leading-tight ad-text-1">{displayName}</p>
            <p className="text-[10px] truncate mt-0.5 ad-text-3">{userEmail}</p>
          </div>
          <span className="ad-badge-accent flex-shrink-0">Admin</span>
        </div>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="ad-nav-item group hover:!text-[#F2706E]"
          style={{ marginTop: "0.25rem" }}
        >
          <span className="flex-shrink-0">{Icons.signout}</span>
          <span className="text-[13px]">Sign out</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex flex-col w-64 fixed inset-y-0 left-0 z-40 overflow-hidden"
        style={{ backgroundColor: "var(--ad-bg)", borderRight: "1px solid var(--ad-border)" }}
      >
        {sidebar}
      </aside>

      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 w-10 h-10 rounded-2xl flex items-center justify-center"
        style={{ backgroundColor: "var(--ad-surface)", border: "1px solid var(--ad-border)", color: "var(--ad-text)" }}
        aria-label="Open menu"
      >
        {Icons.menu}
      </button>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="relative w-64 flex flex-col animate-slide-in overflow-hidden"
            style={{ backgroundColor: "var(--ad-bg)", borderRight: "1px solid var(--ad-border)" }}
          >
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-3 p-1.5 rounded-xl z-20 text-[#626975] hover:text-[#F4F5F7]"
              aria-label="Close menu"
            >
              {Icons.close}
            </button>
            {sidebar}
          </aside>
        </div>
      )}
    </>
  );
}
