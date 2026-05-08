"use client";
import type { ShareTemplate } from "@/types/database";
import { PlatformIcon } from "./SocialCopyCard";

type Platform = ShareTemplate["platform"] | "all";
const PLATFORMS: Platform[] = ["all", "instagram", "twitter", "linkedin", "general"];

export default function SocialCopyFilter({
  value, onChange,
}: { value: Platform; onChange: (p: Platform) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PLATFORMS.map((p) => {
        const active = value === p;
        return (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all duration-200 active:scale-[0.97] ${
              active
                ? "bg-accent text-brand-900 border-accent shadow-glow-sm"
                : "bg-white text-brand-400 border-gray-200 hover:text-gray-900 hover:border-gray-300"
            }`}
          >
            <PlatformIcon platform={p} className="w-3 h-3" />
            {label(p)}
          </button>
        );
      })}
    </div>
  );
}

function label(p: Platform) {
  if (p === "all") return "All";
  if (p === "twitter") return "X";
  return p[0].toUpperCase() + p.slice(1);
}
