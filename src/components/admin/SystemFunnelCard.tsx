import { fmt } from "@/lib/fmt";

interface Props {
  /** Total referred users in the system (all stages). */
  totalLeads: number;
  signedUp: number;
  activated: number;
}

/**
 * System-wide funnel: clicks → signups → activated, thin progress bars.
 * Clicks have no source in the data currently fetched, so that stage is a
 * flagged placeholder (no fabricated number). Signups/activated are real,
 * derived from referred_users.status_slug.
 */
export default function SystemFunnelCard({ totalLeads, signedUp, activated }: Props) {
  // Baseline for bar widths: signups is the widest known stage.
  const baseline = Math.max(signedUp, 1);
  const signupRate = totalLeads > 0 ? signedUp / totalLeads : 0;
  const activationRate = signedUp > 0 ? activated / signedUp : 0;

  return (
    <div className="ad-card overflow-hidden">
      <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--ad-border)" }}>
        <h3 className="text-sm font-semibold ad-text-1">System Funnel</h3>
        <p className="text-[11px] ad-text-3 mt-0.5">Clicks → signups → activated across all affiliates</p>
      </div>

      <div className="px-5 py-5 space-y-4">
        {/* Clicks — placeholder (no source) */}
        <Stage
          label="Clicks"
          value="—"
          barPct={100}
          placeholder
          note="No click source connected"
        />

        {/* Signups */}
        <Stage
          label="Signups"
          value={fmt.count(signedUp)}
          barPct={100}
          meta={totalLeads > 0 ? `${fmt.percent(signupRate)} of ${fmt.count(totalLeads)} leads` : undefined}
        />

        {/* Activated */}
        <Stage
          label="Activated"
          value={fmt.count(activated)}
          barPct={(activated / baseline) * 100}
          meta={`${fmt.percent(activationRate)} of signups`}
        />
      </div>
    </div>
  );
}

function Stage({
  label, value, barPct, meta, placeholder, note,
}: {
  label: string;
  value: string;
  barPct: number;
  meta?: string;
  placeholder?: boolean;
  note?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium ad-text-2">{label}</span>
          {note && (
            <span className="ad-badge ad-badge-neutral" title={note}>{note}</span>
          )}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold ad-text-1 tabular-nums">{value}</span>
          {meta && <span className="text-[10px] ad-text-3 tabular-nums">{meta}</span>}
        </div>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--ad-inset)" }}>
        {placeholder ? (
          <div
            className="h-full rounded-full"
            style={{
              width: "100%",
              backgroundImage:
                "repeating-linear-gradient(45deg, var(--ad-border) 0, var(--ad-border) 6px, transparent 6px, transparent 12px)",
            }}
          />
        ) : (
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(Math.max(barPct, 0), 100)}%`, backgroundColor: "var(--ad-accent)" }}
          />
        )}
      </div>
    </div>
  );
}
