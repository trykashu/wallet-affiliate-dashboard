import { fmt } from "@/lib/fmt";

interface MoneyProps {
  value: number;
  /**
   * Compact notation ($12.3K) — used where horizontal space is tight.
   * Compact figures carry no cents (K/M suffix instead). Default: full
   * dollars with superscript cents (the craft detail).
   */
  compact?: boolean;
  /** Masked by the admin balance-visibility toggle. Default: true. */
  sensitive?: boolean;
  className?: string;
}

/**
 * Admin currency display. Renders large dollars with small raised cents in
 * the secondary text color — applied to every balance / large figure in the
 * admin panel. Carries `data-sensitive` so the balance-visibility toggle can
 * blur it across server-rendered pages without prop drilling.
 */
export default function Money({ value, compact = false, sensitive = true, className }: MoneyProps) {
  const safe = Number.isFinite(value) ? value : 0;
  const neg = safe < 0;
  const abs = Math.abs(safe);
  const sensAttr = sensitive ? { "data-sensitive": "" } : {};

  if (compact) {
    return (
      <span className={`ad-num ${className ?? ""}`} {...sensAttr}>
        {neg ? "-" : ""}
        {fmt.currencyCompact(abs)}
      </span>
    );
  }

  const totalCents = Math.round(abs * 100);
  const whole = Math.floor(totalCents / 100);
  const cents = totalCents % 100;

  return (
    <span className={`ad-num ${className ?? ""}`} {...sensAttr}>
      {neg ? "-" : ""}${fmt.count(whole)}
      <span className="ad-cents">{cents.toString().padStart(2, "0")}</span>
    </span>
  );
}
