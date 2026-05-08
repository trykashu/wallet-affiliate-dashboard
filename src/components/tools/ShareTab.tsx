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
      <ReferralLinkCard
        url={referralUrl}
        description="Share this link to earn commission on users who deposit funds into the wallet."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <QRCodeGenerator referralUrl={referralUrl} />

        <div className="card p-6 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-gray-900">Quick Tips</h3>
          <ul className="space-y-2 text-xs text-brand-400 leading-relaxed">
            <li>• Share your link via email, social, or messaging apps.</li>
            <li>• When someone signs up through your link, they're attributed to you.</li>
            <li>• You earn commission when they deposit funds.</li>
            <li>• Use the QR for in-person promo, printed materials, or presentations.</li>
          </ul>
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-brand-400 uppercase tracking-wider">Social Copy</h2>
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
        {filtered.length === 0 && (
          <div className="card p-8 text-center text-sm text-brand-400">
            No templates for this platform yet.
          </div>
        )}
      </section>
    </div>
  );
}
