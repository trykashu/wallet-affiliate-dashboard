"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useCallback, useState } from "react";

/**
 * AutoRefresh — calls router.refresh() on a configurable interval
 * to keep server-rendered data fresh. Shows a subtle refresh indicator.
 */
export default function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const [refreshing, setRefreshing] = useState(false);

  const sync = useCallback(() => {
    if (!mountedRef.current) return;

    setRefreshing(true);
    router.refresh();

    // Brief visual indicator then schedule next refresh
    setTimeout(() => {
      if (mountedRef.current) setRefreshing(false);
    }, 800);

    if (mountedRef.current) {
      timeoutRef.current = setTimeout(sync, intervalMs);
    }
  }, [router, intervalMs]);

  useEffect(() => {
    mountedRef.current = true;
    timeoutRef.current = setTimeout(sync, intervalMs);

    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [sync, intervalMs]);

  if (!refreshing) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 bg-white/90 backdrop-blur
                    border border-surface-200/60 rounded-xl px-3 py-1.5 shadow-card text-xs text-brand-400
                    animate-fade-in">
      <svg className="w-3 h-3 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Refreshing...
    </div>
  );
}
