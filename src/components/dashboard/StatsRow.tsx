import type { ReferredUser } from "@/types/database";
import { fmt } from "@/lib/fmt";

interface Props {
  users: ReferredUser[];
}

interface CardDef {
  label: string;
  value: string;
  sub: string;
  variant: "default" | "accent" | "rate";
  icon: React.ReactNode;
}

const STAGGER = ["stagger-1", "stagger-2", "stagger-3"];

/** Slugs that count as "transacted" (transaction_run or later in the funnel) */
const TRANSACTED_SLUGS = ["transaction_run", "funds_in_wallet", "ach_initiated", "funds_in_bank"];

export default function StatsRow({ users }: Props) {
  const total      = users.length;
  const transacted = users.filter((u) => TRANSACTED_SLUGS.includes(u.status_slug)).length;
  const convRate   = total > 0 ? transacted / total : 0;

  const cards: CardDef[] = [
    {
      label:   "Total Users",
      value:   fmt.count(total),
      sub:     "all referred",
      variant: "default",
      icon: (
        <svg className="w-[18px] h-[18px]" aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      ),
    },
    {
      label:   "Transacted",
      value:   fmt.count(transacted),
      sub:     "ran a transaction",
      variant: "accent",
      icon: (
        <svg className="w-[18px] h-[18px]" aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      ),
    },
    {
      label:   "Conversion Rate",
      value:   fmt.percent(convRate),
      sub:     "referred \u2192 transacted",
      variant: "rate",
      icon: (
        <svg className="w-[18px] h-[18px]" aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
        </svg>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
      {cards.map((card, idx) => {
        const isAccent = card.variant === "accent";
        const isRate   = card.variant === "rate";

        const iconClass = isAccent
          ? "bg-accent/10 text-accent border-accent/15"
          : isRate
          ? "bg-brand-50 text-brand-600 border-brand-100"
          : "bg-surface-100 text-brand-500 border-surface-200";

        const valueClass = isAccent || isRate ? "text-gradient" : "text-gray-900";

        const cardClass = isAccent
          ? "stat-card-accent animate-reveal-up"
          : "stat-card animate-reveal-up";

        return (
          <div
            key={card.label}
            className={`${cardClass} ${STAGGER[idx]} group relative overflow-hidden`}
          >
            {/* Ambient corner glow */}
            <div
              className="absolute -top-10 -right-10 w-36 h-36 rounded-full blur-3xl pointer-events-none opacity-40 transition-opacity duration-500 group-hover:opacity-60"
              style={{ background: isAccent ? "rgb(var(--kw-accent-rgb) / 0.2)" : "rgb(var(--kw-brand-600-rgb) / 0.06)" }}
            />

            {/* Icon pill */}
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-4 sm:mb-5 border ${iconClass} flex-shrink-0`}>
              {card.icon}
            </div>

            {/* Display number */}
            <p className={`text-display-sm sm:text-display font-bold tracking-tight leading-none tabular-nums ${valueClass}`}>
              {card.value}
            </p>

            {/* Label */}
            <p className="text-[10px] sm:text-[11px] font-bold text-brand-400 uppercase tracking-[0.1em] mt-3 sm:mt-4">
              {card.label}
            </p>
            <p className="text-[11px] text-brand-400/60 mt-0.5">{card.sub}</p>

            {/* Bottom accent line on transacted card */}
            {isAccent && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-accent/80 to-transparent" />
            )}
          </div>
        );
      })}
    </div>
  );
}
