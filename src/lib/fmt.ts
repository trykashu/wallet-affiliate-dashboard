/**
 * Shared formatting utilities — Mercury-grade financial display.
 * Use these everywhere. Never use inline Intl.NumberFormat, .toFixed(), or .toLocaleString().
 *
 * All Intl instances are cached at module level for performance.
 */

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currencyCompactFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  compactDisplay: "short",
  minimumSignificantDigits: 3,
  maximumSignificantDigits: 3,
});

const countFmt = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const percentFmt = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const rateFmtInner = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const fmt = {
  /** $12,345.67 — always 2 decimals */
  currency: (n: number) => currencyFmt.format(n),

  /** $12.3K — compact for large numbers */
  currencyCompact: (n: number) => currencyCompactFmt.format(n),

  /** 1,234 — comma-separated, no decimals */
  count: (n: number) => countFmt.format(n),

  /** 25.0% — pass as decimal (0.25), one decimal */
  percent: (n: number) => percentFmt.format(n),

  /** 0.375% — for commission rates, 3 decimal places. Pass the percentage value directly (e.g. 0.375). */
  rate: (n: number) => `${rateFmtInner.format(n)}%`,

  /** Mar 15, 2026 — short month */
  date: (d: string | Date) => {
    const date = typeof d === "string" ? new Date(d) : d;
    return dateFmt.format(date);
  },

  /** 2h ago — relative time */
  relative: (d: string | Date) => {
    const date = typeof d === "string" ? new Date(d) : d;
    const diff = Date.now() - date.getTime();
    if (diff < MINUTE) return `${Math.max(1, Math.floor(diff / SECOND))}s ago`;
    const minutes = Math.floor(diff / MINUTE);
    if (diff < HOUR) return `${minutes}m ago`;
    const hours = Math.floor(diff / HOUR);
    if (diff < DAY) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return dateFmt.format(date);
  },
} as const;
