"use client";

import { useMemo, useState } from "react";
import type { Affiliate, ShareTemplate, WhitelabelBrand } from "@/types/database";
import ReferralLinkCard from "@/components/dashboard/ReferralLinkCard";
import QRCodeGenerator from "@/components/dashboard/QRCodeGenerator";
import SocialCopyCard from "./SocialCopyCard";
import SocialCopyFilter from "./SocialCopyFilter";

type Platform = ShareTemplate["platform"] | "all";

export default function ShareTab({
  affiliate,
  brand: _brand,
  referralUrl,
  templates,
}: {
  affiliate: Affiliate;
  brand: WhitelabelBrand | null;
  referralUrl: string;
  templates: ShareTemplate[];
}) {
  const [platform, setPlatform] = useState<Platform>("all");

  const vars = useMemo(
    () => ({
      referral_link: referralUrl,
      agent_name: affiliate.agent_name,
      business_name: affiliate.business_name ?? undefined,
    }),
    [referralUrl, affiliate],
  );

  const filtered = useMemo(
    () => (platform === "all" ? templates : templates.filter((t) => t.platform === platform)),
    [platform, templates],
  );

  return (
    <div className="space-y-8">
      <div className="animate-reveal-up space-y-5">
        <ReferralLinkCard
          url={referralUrl}
          description="Share this link to earn commission on users who deposit funds into the wallet."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <QRCodeGenerator referralUrl={referralUrl} />

          <div className="card p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900">Quick Tips</h3>
            </div>
            <ul className="space-y-2 text-xs text-brand-400 leading-relaxed">
              <li className="flex gap-2"><span className="text-accent">•</span> Share your link via email, social, or messaging apps.</li>
              <li className="flex gap-2"><span className="text-accent">•</span> When someone signs up through your link, they're attributed to you.</li>
              <li className="flex gap-2"><span className="text-accent">•</span> You earn commission when they deposit funds.</li>
              <li className="flex gap-2"><span className="text-accent">•</span> Use the QR for in-person promo, printed materials, or presentations.</li>
            </ul>
          </div>
        </div>
      </div>

      <section className="space-y-4 animate-reveal-up" style={{ animationDelay: "60ms" }}>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-brand-400 uppercase tracking-wider">Social Copy</h2>
            <p className="text-xs text-brand-400/80 mt-1">Tap any card to copy with your link auto-filled.</p>
          </div>
          <span className="text-xs text-brand-400 tabular-nums">
            {filtered.length} template{filtered.length === 1 ? "" : "s"}
          </span>
        </div>
        <SocialCopyFilter value={platform} onChange={setPlatform} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((t) => (
            <SocialCopyCard key={t.id} template={t} vars={vars} />
          ))}
        </div>
        {filtered.length === 0 && <EmptyTemplates />}
      </section>
    </div>
  );
}

function EmptyTemplates() {
  return (
    <div className="card p-10 flex flex-col items-center text-center gap-3">
      <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
        <svg className="w-6 h-6 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5A3.375 3.375 0 006.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0015 2.25h-1.5a2.251 2.251 0 00-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 00-9-9z" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-gray-900">No templates here yet</p>
      <p className="text-xs text-brand-400 max-w-xs">Try a different platform — or check back soon. New copy is added regularly.</p>
    </div>
  );
}
