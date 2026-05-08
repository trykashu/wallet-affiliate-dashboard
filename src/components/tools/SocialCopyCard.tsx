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
    <div className="card-hover p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{template.title}</h3>
        <PlatformBadge platform={template.platform} />
      </div>
      <div className="bg-surface-50 border border-surface-100 rounded-xl p-4">
        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{interpolated}</p>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">
          {template.category.replace("-", " ")}
        </span>
        <button
          onClick={copy}
          aria-live="polite"
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all duration-200 active:scale-[0.97] ${
            copied
              ? "bg-brand-600 text-white shadow-glow-sm"
              : "bg-accent text-brand-900 hover:bg-accent-600"
          }`}
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function PlatformBadge({ platform }: { platform: ShareTemplate["platform"] }) {
  const base = "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border";
  const cls =
    platform === "instagram" ? `${base} text-pink-700 bg-pink-50 border-pink-200`
    : platform === "twitter" ? `${base} text-gray-900 bg-gray-100 border-gray-200`
    : platform === "linkedin" ? `${base} text-sky-700 bg-sky-50 border-sky-200`
    : `${base} text-brand-400 bg-surface-100 border-surface-200`;
  return (
    <span className={cls}>
      <PlatformIcon platform={platform} />
      {platformLabel(platform)}
    </span>
  );
}

export function PlatformIcon({ platform, className = "w-3 h-3" }: { platform: ShareTemplate["platform"] | "all"; className?: string }) {
  if (platform === "instagram") {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
        <rect x="3" y="3" width="18" height="18" rx="5" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="3.75" />
        <circle cx="17.5" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (platform === "twitter") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zM17.083 19.77h1.833L7.084 4.126H5.117L17.083 19.77z"/>
      </svg>
    );
  }
  if (platform === "linkedin") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.45 20.45h-3.555v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.446-2.136 2.94v5.666H9.353V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.284zM5.337 7.433a2.062 2.062 0 11.001-4.125 2.062 2.062 0 010 4.125zM7.119 20.45H3.555V9H7.12v11.45z"/>
      </svg>
    );
  }
  if (platform === "all") {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
      </svg>
    );
  }
  // general → share / sparkle
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
    </svg>
  );
}

function platformLabel(p: ShareTemplate["platform"]) {
  return p === "twitter" ? "X" : p[0].toUpperCase() + p.slice(1);
}
