"use client";
import { useState } from "react";
import type { ShareTemplate } from "@/types/database";
import { interpolate, type TemplateVarValues } from "@/lib/template-vars";

export default function SocialCopyCard({
  template, vars,
}: { template: ShareTemplate; vars: TemplateVarValues }) {
  const [copied, setCopied] = useState(false);
  const interpolated = interpolate(template.body, vars);

  async function copy() {
    await navigator.clipboard.writeText(interpolated);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{template.title}</h3>
        <span className={badgeClass(template.platform)}>{platformLabel(template.platform)}</span>
      </div>
      <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{interpolated}</p>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">
          {template.category.replace("-", " ")}
        </span>
        <button onClick={copy} aria-live="polite" className="btn-accent text-xs px-3 py-1.5 rounded-xl">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function platformLabel(p: ShareTemplate["platform"]) {
  return p === "twitter" ? "X" : p[0].toUpperCase() + p.slice(1);
}
function badgeClass(p: ShareTemplate["platform"]) {
  const base = "text-[10px] font-semibold px-2 py-0.5 rounded-full border";
  if (p === "instagram") return `${base} text-pink-700 bg-pink-50 border-pink-200`;
  if (p === "twitter")   return `${base} text-gray-900 bg-gray-100 border-gray-200`;
  if (p === "linkedin")  return `${base} text-sky-700 bg-sky-50 border-sky-200`;
  return `${base} text-brand-400 bg-surface-100 border-surface-200`;
}
