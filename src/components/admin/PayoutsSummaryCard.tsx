import Money from "./Money";

interface Props {
  /** Approved earnings awaiting payout. */
  ready: number;
  /** Pending earnings still accruing / not yet approved. */
  pending: number;
  /** Earnings already paid out. */
  paid: number;
}

/**
 * Read-only payouts summary for the Overview. "Ready / pending / paid" are
 * derived from earnings rows already fetched on the page. The batch/queue
 * detail lives behind the payouts table (not fetched here) — so this links out
 * to /admin/payouts rather than fabricating queue counts.
 */
export default function PayoutsSummaryCard({ ready, pending, paid }: Props) {
  const items = [
    { label: "Ready to pay", value: ready, accent: true,  hint: "Approved, awaiting batch" },
    { label: "Pending",      value: pending, accent: false, hint: "Accruing / unapproved" },
    { label: "Paid out",     value: paid, accent: false, hint: "Lifetime" },
  ];

  return (
    <div className="ad-card overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between gap-4" style={{ borderBottom: "1px solid var(--ad-border)" }}>
        <div>
          <h3 className="text-sm font-semibold ad-text-1">Payouts</h3>
          <p className="text-[11px] ad-text-3 mt-0.5">Commission pipeline · batch queue in Payouts</p>
        </div>
        <a href="/admin/payouts" className="ad-btn-ghost flex items-center gap-1.5">
          <span>Manage</span>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 8.25L21 12m0 0l-3.75 3.75M21 12H3" />
          </svg>
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x" style={{ borderColor: "var(--ad-border)" }}>
        {items.map((it) => (
          <div key={it.label} className="px-5 py-4" style={{ borderColor: "var(--ad-border)" }}>
            <p className="ad-label">{it.label}</p>
            <p className={`mt-1.5 text-xl font-semibold ${it.accent ? "ad-accent-text" : "ad-text-1"}`}>
              <Money value={it.value} />
            </p>
            <p className="text-[10px] ad-text-3 mt-1">{it.hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
