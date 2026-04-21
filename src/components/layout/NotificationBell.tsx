"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import ToastContainer from "@/components/ui/Toast";
import type { ToastMessage } from "@/components/ui/Toast";
import type { Notification } from "@/types/database";

interface NotificationBellProps {
  affiliateId: string;
  initialCount: number;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  funnel_change: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  ),
  earning_credited: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  tier_upgrade: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
    </svg>
  ),
};

export default function NotificationBell({ affiliateId, initialCount }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const supabase = createClient();

  // Fetch recent notifications when dropdown opens
  const fetchNotifications = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data } = await db
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setNotifications(data as Notification[]);
  }, [supabase]);

  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, fetchNotifications]);

  // Subscribe to real-time inserts
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const channel = db
      .channel("notifications-bell")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `affiliate_id=eq.${affiliateId}`,
        },
        (payload: { new: Notification }) => {
          const notif = payload.new;
          setCount((c) => c + 1);
          setToasts((prev) => [
            ...prev,
            { id: notif.id, title: notif.title, body: notif.body ?? undefined, type: "info" as const },
          ]);
          setNotifications((prev) => [notif, ...prev.slice(0, 19)]);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [affiliateId, supabase]);

  async function markRead(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("notifications").update({ is_read: true }).eq("id", id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );
    setCount((c) => Math.max(0, c - 1));
  }

  async function markAllRead() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("notifications")
      .update({ is_read: true })
      .eq("affiliate_id", affiliateId)
      .eq("is_read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setCount(0);
  }

  return (
    <>
      {/* Bell button */}
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="relative w-9 h-9 rounded-xl flex items-center justify-center
                     text-brand-400 hover:text-brand-600 hover:bg-surface-100
                     transition-all duration-150"
          aria-label="Notifications"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1
                             rounded-full bg-accent text-brand-950 text-[9px] font-bold
                             flex items-center justify-center leading-none">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>

        {/* Dropdown */}
        {open && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
            />
            <div
              className="absolute right-0 top-11 w-80 bg-white border border-surface-200/60 rounded-2xl z-50 shadow-card-md overflow-hidden
                         animate-scale-in origin-top-right"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200/60">
                <h3 className="text-xs font-semibold text-gray-900">Notifications</h3>
                {count > 0 && (
                  <button
                    onClick={markAllRead}
                    className="text-[10px] text-accent hover:text-accent/80 transition-colors"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              {/* List */}
              <div className="max-h-[380px] overflow-y-auto divide-y divide-surface-200/60">
                {notifications.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <div className="w-10 h-10 mx-auto mb-3 rounded-2xl bg-surface-100 flex items-center justify-center">
                      <svg className="w-5 h-5 text-brand-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                      </svg>
                    </div>
                    <p className="text-xs font-medium text-gray-900">All caught up</p>
                    <p className="text-[10px] text-brand-400 mt-0.5">No new notifications</p>
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`flex gap-3 px-4 py-3 hover:bg-surface-50/80 transition-colors cursor-default
                                  ${!n.is_read ? "bg-accent/5" : ""}`}
                      onClick={() => !n.is_read && markRead(n.id)}
                    >
                      <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center
                                       ${!n.is_read ? "bg-accent/15 text-accent" : "bg-surface-100 text-brand-400"}`}>
                        {TYPE_ICONS[n.type] ?? TYPE_ICONS.funnel_change}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs leading-snug ${!n.is_read ? "text-gray-900 font-medium" : "text-brand-400"}`}>
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="text-[10px] text-brand-400 mt-0.5 leading-relaxed">{n.body}</p>
                        )}
                        <p className="text-[10px] text-brand-400 mt-1">{timeAgo(n.created_at)}</p>
                      </div>
                      {!n.is_read && (
                        <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-accent mt-1.5" />
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Toast portal */}
      <ToastContainer
        messages={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </>
  );
}
