"use client";

import { useCallback, useMemo, useState } from "react";

export interface PdfBankAffiliate {
  id: string;
  agent_name: string;
  email: string;
  business_name: string | null;
}

interface ExtractedPreview {
  email: string | null;
  account_holder_name: string | null;
  routing_number: string | null;
  account_number: string | null;
  account_type: "checking" | "savings" | null;
  routing_valid: boolean;
  account_valid: boolean;
  address: {
    address1: string | null;
    address2: string | null;
    city: string | null;
    region: string | null;
    postal_code: string | null;
    country: string;
  };
  warnings: string[];
  raw_text_excerpt: string;
}
interface PreviewResponse {
  ok: boolean;
  affiliate: { id: string; agent_name: string; email: string };
  extracted: ExtractedPreview;
  ready_to_save: boolean;
}

export default function PdfBankUpload({ affiliates }: { affiliates: PdfBankAffiliate[] }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [savedAction, setSavedAction] = useState<"created" | "updated" | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return affiliates.slice(0, 8);
    return affiliates
      .filter(
        (a) =>
          a.agent_name.toLowerCase().includes(q) ||
          a.email.toLowerCase().includes(q) ||
          (a.business_name ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [search, affiliates]);

  const selected = useMemo(
    () => affiliates.find((a) => a.id === selectedId) ?? null,
    [selectedId, affiliates],
  );

  const reset = useCallback(() => {
    setPreview(null);
    setSavedAction(null);
    setError(null);
  }, []);

  const runPreview = useCallback(async () => {
    if (!file || !selectedId) return;
    setBusy("preview");
    setError(null);
    setPreview(null);
    setSavedAction(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("affiliate_id", selectedId);
      const res = await fetch("/api/admin/bank-from-pdf", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Extraction failed (${res.status})`);
      setPreview(body as PreviewResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setBusy(null);
    }
  }, [file, selectedId]);

  const save = useCallback(async () => {
    if (!file || !selectedId || !preview?.ready_to_save) return;
    setBusy("save");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("affiliate_id", selectedId);
      fd.append("confirm", "true");
      const res = await fetch("/api/admin/bank-from-pdf", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Save failed (${res.status})`);
      setSavedAction(body.action as "created" | "updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }, [file, selectedId, preview]);

  return (
    <div className="card p-6 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-brand-400 uppercase tracking-wider">
          Import Bank Details (PDF)
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          Pick an affiliate, drop their signed bank-detail PDF (W9, PandaDoc copy, or typed form), preview the extracted fields, then save.
        </p>
      </div>

      {/* Affiliate picker */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Affiliate</label>
        {selected ? (
          <div className="flex items-center justify-between p-3 bg-surface-100/60 border border-surface-200/60 rounded-xl">
            <div>
              <p className="text-sm font-semibold text-gray-900">{selected.agent_name}</p>
              <p className="text-[10px] text-brand-400">{selected.email}</p>
            </div>
            <button
              onClick={() => { setSelectedId(null); reset(); }}
              className="text-[10px] font-semibold text-brand-600 underline decoration-dotted"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or business"
              className="input-base w-full px-3 py-2 rounded-xl text-sm"
            />
            <div className="max-h-48 overflow-y-auto rounded-xl border border-surface-200/60 divide-y divide-surface-200/60">
              {filtered.length === 0 ? (
                <p className="p-3 text-xs text-brand-400">No matches.</p>
              ) : (
                filtered.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => { setSelectedId(a.id); reset(); }}
                    className="w-full text-left px-3 py-2 hover:bg-surface-100/60 transition-colors"
                  >
                    <p className="text-sm text-gray-900">{a.agent_name}</p>
                    <p className="text-[10px] text-brand-400">{a.email}{a.business_name ? ` · ${a.business_name}` : ""}</p>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* File picker */}
      {selected && (
        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-surface-200 rounded-xl cursor-pointer hover:border-accent hover:bg-surface-100/60 transition-colors">
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            <svg className="w-8 h-8 mb-2 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm text-gray-600">{file ? file.name : "Click to select PDF (max 10MB)"}</p>
          </div>
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              reset();
            }}
          />
        </label>
      )}

      {selected && file && !preview && !savedAction && (
        <button
          onClick={runPreview}
          disabled={busy === "preview"}
          className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === "preview" ? "Extracting…" : "Extract bank details from PDF"}
        </button>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 border border-red-200 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="space-y-3">
          <div className="border border-surface-200/60 rounded-xl divide-y divide-surface-200/60">
            <PreviewField label="Account holder" value={preview.extracted.account_holder_name} />
            <PreviewField label="Routing number" value={preview.extracted.routing_number} valid={preview.extracted.routing_valid} />
            <PreviewField label="Account number" value={preview.extracted.account_number ? `••••${preview.extracted.account_number.slice(-4)}` : null} valid={preview.extracted.account_valid} />
            <PreviewField label="Account type" value={preview.extracted.account_type ?? "—"} />
            <PreviewField label="Email found in PDF" value={preview.extracted.email} />
            <PreviewField
              label="Address"
              value={
                preview.extracted.address.address1
                  ? `${preview.extracted.address.address1}, ${preview.extracted.address.city ?? ""} ${preview.extracted.address.region ?? ""} ${preview.extracted.address.postal_code ?? ""}`.trim()
                  : null
              }
              valid={!!(preview.extracted.address.address1 && preview.extracted.address.city && preview.extracted.address.region && preview.extracted.address.postal_code)}
            />
          </div>

          {preview.extracted.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">Warnings</p>
              <ul className="text-[11px] text-amber-700 list-disc list-inside space-y-0.5">
                {preview.extracted.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {savedAction ? (
            <div className="bg-accent/10 text-accent border border-accent/30 rounded-xl px-4 py-3 text-sm font-semibold">
              ✓ Bank details {savedAction} for {preview.affiliate.agent_name}.
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={!preview.ready_to_save || busy === "save"}
                className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                title={!preview.ready_to_save ? "Routing or account didn't validate — review warnings" : ""}
              >
                {busy === "save" ? "Saving…" : "Save to payout account"}
              </button>
              <button
                onClick={() => { setFile(null); reset(); }}
                className="text-xs text-brand-600 hover:text-brand-700 underline decoration-dotted"
              >
                Discard and try another PDF
              </button>
            </div>
          )}

          {!preview.ready_to_save && (
            <p className="text-[10px] text-amber-700">
              Cannot save — extracted routing or account number didn&apos;t pass validation. Use the CSV upload above or PandaDoc Re-verify on this affiliate.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PreviewField({ label, value, valid }: { label: string; value: string | null; valid?: boolean }) {
  return (
    <div className="px-3 py-2 flex items-center justify-between">
      <span className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">{label}</span>
      <span className="text-sm font-mono text-gray-900 flex items-center gap-2">
        {value ?? <span className="text-brand-400">—</span>}
        {valid === true && <span className="text-accent text-xs">✓</span>}
        {valid === false && <span className="text-red-500 text-xs">✗</span>}
      </span>
    </div>
  );
}
