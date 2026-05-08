"use client";
import type { ShareTemplate } from "@/types/database";

type Platform = ShareTemplate["platform"] | "all";
const PLATFORMS: Platform[] = ["all", "instagram", "twitter", "linkedin", "general"];

export default function SocialCopyFilter({
  value, onChange,
}: { value: Platform; onChange: (p: Platform) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PLATFORMS.map((p) => (
        <button key={p} onClick={() => onChange(p)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
            value === p
              ? "bg-brand-600 text-white border-brand-700"
              : "bg-white text-brand-400 border-gray-200 hover:text-gray-900"
          }`}>
          {label(p)}
        </button>
      ))}
    </div>
  );
}

function label(p: Platform) {
  if (p === "all") return "All";
  if (p === "twitter") return "X";
  return p[0].toUpperCase() + p.slice(1);
}
