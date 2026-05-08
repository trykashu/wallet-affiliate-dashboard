"use client";
import type { Affiliate, ShareTemplate, WhitelabelBrand } from "@/types/database";

export default function ShareTab(_: {
  affiliate: Affiliate;
  brand: WhitelabelBrand | null;
  referralUrl: string;
  templates: ShareTemplate[];
}) {
  return <div className="card p-6">Share tab — pending implementation.</div>;
}
