"use client";
import { useMemo } from "react";
import type { AffiliateResource } from "@/types/database";
import VideoCard from "./VideoCard";
import ResourceCard from "./ResourceCard";

const SECTIONS: Array<{ key: AffiliateResource["category"]; label: string; intro?: string }> = [
  { key: "onboarding", label: "Onboarding" },
  { key: "tutorial",   label: "Tutorial Videos", intro: "Send these to anyone you refer." },
  { key: "guide",      label: "Guides & FAQs" },
  { key: "compliance", label: "Compliance" },
  { key: "brand",      label: "Brand Assets" },
];

export default function ResourcesTab({ resources }: { resources: AffiliateResource[] }) {
  const grouped = useMemo(() => {
    const m = new Map<AffiliateResource["category"], AffiliateResource[]>();
    for (const r of resources) {
      const arr = m.get(r.category) ?? [];
      arr.push(r);
      m.set(r.category, arr);
    }
    return m;
  }, [resources]);

  const totalCount = resources.length;

  return (
    <div className="space-y-10">
      {totalCount === 0 ? (
        <div className="card p-8 text-center text-sm text-brand-400">
          No resources available yet.
        </div>
      ) : (
        SECTIONS.map((section) => {
          const items = grouped.get(section.key) ?? [];
          if (!items.length) return null;
          const videos = items.filter((i) => i.kind === "video");
          const nonVideos = items.filter((i) => i.kind !== "video");
          return (
            <section key={section.key} className="space-y-3">
              <div>
                <h2 className="text-sm font-bold text-brand-400 uppercase tracking-wider">{section.label}</h2>
                {section.intro && <p className="text-xs text-brand-400 mt-1">{section.intro}</p>}
              </div>
              {videos.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {videos.map((r) => <VideoCard key={r.id} resource={r} />)}
                </div>
              )}
              {nonVideos.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {nonVideos.map((r) => <ResourceCard key={r.id} resource={r} />)}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
