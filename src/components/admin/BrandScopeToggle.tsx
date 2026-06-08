"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BrandScope } from "@/lib/admin/brand-scope";

/**
 * Header toggle to switch the admin dashboard between the Kashu and Payova
 * (whitelabel) businesses. Writes the `admin_brand` cookie and refreshes so
 * server components re-fetch within the chosen scope.
 */
export default function BrandScopeToggle({ scope }: { scope: BrandScope }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<BrandScope>(scope);

  function select(next: BrandScope) {
    if (next === active) return;
    setActive(next);
    document.cookie = `admin_brand=${next}; path=/; max-age=31536000; samesite=lax`;
    // Flip the accent immediately — don't wait on the server round-trip (and
    // don't rely on router.refresh() re-rendering the layout that owns data-brand).
    const shell = document.querySelector("[data-admin-theme]");
    if (shell) shell.setAttribute("data-brand", next);
    startTransition(() => router.refresh());
  }

  const items: [BrandScope, string][] = [
    ["kashu", "Kashu"],
    ["payova", "Payova"],
  ];

  return (
    <div
      className="flex items-center gap-1 p-0.5 rounded-full"
      style={{ backgroundColor: "var(--ad-inset)", border: "1px solid var(--ad-border)", opacity: pending ? 0.6 : 1 }}
      aria-label="Brand scope"
    >
      {items.map(([key, label]) => (
        <button
          key={key}
          onClick={() => select(key)}
          disabled={pending}
          className="text-[11px] font-semibold px-3 py-1 rounded-full transition-colors"
          style={
            active === key
              ? { backgroundColor: "var(--ad-accent-soft)", color: "var(--ad-accent-strong)" }
              : { color: "var(--ad-text-3)" }
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
