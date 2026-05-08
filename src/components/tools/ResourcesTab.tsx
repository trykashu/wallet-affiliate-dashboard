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

  if (totalCount === 0) {
    return (
      <div className="card p-10 flex flex-col items-center text-center gap-3 animate-reveal-up">
        <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <svg className="w-6 h-6 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-gray-900">No resources available yet</p>
        <p className="text-xs text-brand-400 max-w-xs">Tutorials, guides, and brand assets will land here. Check back soon.</p>
      </div>
    );
  }

  let visibleIdx = 0;
  return (
    <div className="space-y-10">
      {SECTIONS.map((section) => {
        const items = grouped.get(section.key) ?? [];
        if (!items.length) return null;
        const videos = items.filter((i) => i.kind === "video");
        const nonVideos = items.filter((i) => i.kind !== "video");
        const delay = visibleIdx * 60;
        visibleIdx += 1;
        return (
          <section
            key={section.key}
            className="space-y-3 animate-reveal-up"
            style={{ animationDelay: `${delay}ms` }}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0">
                <SectionIcon category={section.key} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-brand-400 uppercase tracking-wider">{section.label}</h2>
                {section.intro && <p className="text-xs text-brand-400/80 mt-0.5">{section.intro}</p>}
              </div>
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
      })}
    </div>
  );
}

function SectionIcon({ category }: { category: AffiliateResource["category"] }) {
  const cls = "w-4 h-4 text-brand-600";
  if (category === "onboarding") {
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
      </svg>
    );
  }
  if (category === "tutorial") {
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
      </svg>
    );
  }
  if (category === "guide") {
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    );
  }
  if (category === "compliance") {
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
      </svg>
    );
  }
  // brand
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" />
    </svg>
  );
}
