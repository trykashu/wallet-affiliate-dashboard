"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import type {
  Affiliate,
  AffiliateResource,
  ShareTemplate,
  WhitelabelBrand,
} from "@/types/database";
import ShareTab from "./ShareTab";
import ResourcesTab from "./ResourcesTab";

type Tab = "share" | "resources";

export default function ToolsClient({
  affiliate,
  brand,
  referralUrl,
  resources,
  templates,
}: {
  affiliate: Affiliate;
  brand: WhitelabelBrand | null;
  referralUrl: string;
  resources: AffiliateResource[];
  templates: ShareTemplate[];
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab = params.get("tab") === "resources" ? "resources" : "share";

  const setTab = useCallback(
    (next: Tab) => {
      const sp = new URLSearchParams(params.toString());
      sp.set("tab", next);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  return (
    <div className="space-y-6">
      <div className="animate-reveal-up">
        <h1 className="text-2xl font-bold text-gray-900">Tools</h1>
        <p className="text-sm text-brand-400 mt-1">
          Everything you need to share Kashu.
        </p>
      </div>

      <div className="flex gap-1 p-1 bg-surface-100 rounded-xl border border-surface-200/60 w-fit">
        <TabButton active={tab === "share"} onClick={() => setTab("share")}>
          Share
        </TabButton>
        <TabButton
          active={tab === "resources"}
          onClick={() => setTab("resources")}
        >
          Resources
        </TabButton>
      </div>

      {tab === "share" ? (
        <ShareTab
          affiliate={affiliate}
          brand={brand}
          referralUrl={referralUrl}
          templates={templates}
        />
      ) : (
        <ResourcesTab resources={resources} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
        active
          ? "bg-white text-gray-900 shadow-card"
          : "text-brand-400 hover:text-gray-900"
      }`}
    >
      {children}
    </button>
  );
}
