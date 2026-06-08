"use client";

import { useTransition } from "react";
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

  function select(next: BrandScope) {
    if (next === scope) return;
    document.cookie = `admin_brand=${next}; path=/; max-age=31536000; samesite=lax`;
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
            scope === key
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
