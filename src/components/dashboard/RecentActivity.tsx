"use client";

import type { FunnelStatusSlug } from "@/types/database";
import { funnelColor, funnelLabelColor, funnelLabel } from "@/lib/funnel-colors";
import { fmt } from "@/lib/fmt";
import { useBrand } from "@/lib/brand-context";

export interface RecentEvent {
  id: string;
  from_status: FunnelStatusSlug | null;
  to_status: FunnelStatusSlug;
  created_at: string;
  referred_users: { full_name: string } | null;
}

interface Props {
  events: RecentEvent[];
}

export default function RecentActivity({ events }: Props) {
  const brand = useBrand();
  const accentHex = brand?.accent_hex;

  return (
    <div className="card flex flex-col h-full">

      {/* Header */}
      <div className="px-5 py-4 border-b border-surface-200/60 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Recent Activity</h3>
          <p className="text-[11px] text-brand-400/70 mt-0.5">Latest funnel changes</p>
        </div>
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-xl bg-surface-100 text-brand-500 text-[11px] font-bold border border-surface-200/60">
          {events.length}
        </span>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-5 py-3">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center py-8">
            <div className="w-10 h-10 rounded-2xl bg-surface-100 border border-surface-200/60 flex items-center justify-center mb-3">
              <svg className="w-4 h-4 text-brand-400" aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-xs text-brand-400/70">No activity yet</p>
          </div>
        ) : (
          <ul className="relative">
            {/* Timeline line */}
            <div className="absolute left-[11px] top-5 bottom-5 w-px bg-gradient-to-b from-surface-300/60 via-surface-200/40 to-transparent pointer-events-none" />

            {events.map((event, idx) => {
              const dotColor = funnelColor(event.to_status, accentHex);
              const userName = event.referred_users?.full_name ?? "Unknown User";

              return (
                <li
                  key={event.id}
                  className="relative flex items-start gap-3.5 py-2.5 animate-reveal-up"
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  {/* Timeline dot */}
                  <div className="relative flex-shrink-0 mt-1.5 z-10">
                    <span
                      className="inline-block h-[10px] w-[10px] rounded-full ring-[3px] ring-white shadow-sm"
                      style={{ backgroundColor: dotColor }}
                    />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pb-3 border-b border-surface-200/40 last-of-type:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-semibold text-gray-900 leading-snug truncate">
                        {userName}
                      </p>
                      <span className="text-[10px] text-brand-400/60 flex-shrink-0 mt-0.5 tabular-nums font-medium">
                        {fmt.relative(event.created_at)}
                      </span>
                    </div>

                    {/* Status transition pills */}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {event.from_status ? (
                        <>
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-lg"
                            style={{
                              color: funnelLabelColor(event.from_status, accentHex),
                              background: funnelColor(event.from_status, accentHex) + "12",
                              border: `1px solid ${funnelColor(event.from_status, accentHex)}20`,
                            }}
                          >
                            {funnelLabel(event.from_status)}
                          </span>
                          <svg className="w-3 h-3 text-surface-300 flex-shrink-0" aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                          </svg>
                        </>
                      ) : null}
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg"
                        style={{
                          color: funnelLabelColor(event.to_status, accentHex),
                          background: dotColor + "15",
                          border: `1px solid ${dotColor}25`,
                        }}
                      >
                        {funnelLabel(event.to_status)}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
