"use client";

export interface BankPreview {
  account_holder_name: string | null;
  routing_number: string | null;
  account_number_last4: string | null;
  account_type: "checking" | "savings" | null;
  routing_valid: boolean;
  account_valid: boolean;
  warnings: string[];
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
}

interface Props {
  open: boolean;
  affiliateName: string | null;
  pandadocId: string | null;
  preview: BankPreview | null;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export default function BankPreviewDrawer({
  open,
  affiliateName,
  pandadocId,
  preview,
  loading,
  submitting,
  error,
  onClose,
  onConfirm,
}: Props) {
  if (!open) return null;

  const canConfirm =
    !!preview && preview.routing_valid && preview.account_valid && !submitting && !loading;

  const pandadocUrl = pandadocId
    ? `https://app.pandadoc.com/a/#/documents/${pandadocId}/view`
    : null;

  return (
    <>
      <div className="drawer-backdrop" onClick={() => !submitting && onClose()} />
      <div className="drawer-panel">
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Confirm bank info</p>
            <h2 className="text-xl font-bold text-gray-900 mt-1 truncate">{affiliateName ?? "Unknown affiliate"}</h2>
          </div>
          <button
            onClick={() => !submitting && onClose()}
            className="text-sm text-brand-400 hover:text-gray-900"
            aria-label="Close drawer"
          >Close</button>
        </div>

        {loading && (
          <div className="card p-6 text-center text-sm text-brand-400">Fetching from PandaDoc…</div>
        )}

        {error && (
          <div className="card p-3 mb-4 bg-red-50 border-red-200">
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {preview && !loading && (
          <div className="space-y-4">
            <div className="card p-4 bg-surface-50 space-y-3">
              <PreviewField label="Account holder" value={preview.account_holder_name ?? "—"} />
              <PreviewField
                label="Routing number"
                value={preview.routing_number ?? "—"}
                badge={preview.routing_valid ? { kind: "ok", text: "ABA valid" } : { kind: "warn", text: "Invalid checksum" }}
                mono
              />
              <PreviewField
                label="Account number"
                value={preview.account_number_last4 ? `•••• ${preview.account_number_last4}` : "—"}
                badge={preview.account_valid ? { kind: "ok", text: "Format valid" } : { kind: "warn", text: "Invalid format" }}
                mono
              />
              <PreviewField label="Account type" value={preview.account_type ?? "—"} />
            </div>

            {(preview.address1 || preview.city || preview.region || preview.postal_code) && (
              <div className="card p-4 bg-surface-50 space-y-3">
                <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Mailing address (for Mercury)</p>
                <p className="text-sm text-gray-900 leading-relaxed">
                  {preview.address1 ?? <span className="text-brand-400">— address 1 missing —</span>}
                  {preview.address2 && <><br />{preview.address2}</>}
                  <br />
                  {preview.city ?? <span className="text-brand-400">— city missing —</span>}
                  {", "}
                  {preview.region ?? <span className="text-brand-400">— state missing —</span>}
                  {" "}
                  {preview.postal_code ?? <span className="text-brand-400">— zip missing —</span>}
                  <br />
                  <span className="text-xs text-brand-400">{preview.country ?? "US"}</span>
                </p>
              </div>
            )}

            {preview.warnings.length > 0 && (
              <div className="card p-3 bg-amber-50 border-amber-200">
                <p className="text-[10px] font-bold text-amber-900 uppercase tracking-wider mb-2">
                  Extraction warnings
                </p>
                <ul className="space-y-1">
                  {preview.warnings.map((w, i) => (
                    <li key={i} className="text-xs text-amber-900 leading-snug flex gap-2">
                      <span aria-hidden>⚠</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-amber-700 mt-2 italic leading-snug">
                  Compare against the source PandaDoc carefully before confirming.
                </p>
              </div>
            )}

            {pandadocUrl && (
              <a
                href={pandadocUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 underline decoration-dotted"
              >
                Open contract in PandaDoc
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </a>
            )}

            <p className="text-[11px] text-brand-400 leading-relaxed">
              Compare these values against the signed PandaDoc. Only click <span className="font-semibold">Confirm &amp; save</span> if everything matches — this marks the bank account as verified and eligible for ACH transfers.
            </p>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-surface-200/60">
              <button
                onClick={onClose}
                disabled={submitting}
                className="text-xs font-semibold text-brand-400 hover:text-gray-900 px-3 py-2"
              >Cancel</button>
              <button
                onClick={onConfirm}
                disabled={!canConfirm}
                className="text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl px-3 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >{submitting ? "Saving…" : "Confirm & save"}</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function PreviewField({
  label,
  value,
  badge,
  mono,
}: {
  label: string;
  value: string;
  badge?: { kind: "ok" | "warn"; text: string };
  mono?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">{label}</p>
        {badge && (
          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
              badge.kind === "ok"
                ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                : "text-amber-700 bg-amber-50 border-amber-200"
            }`}
          >{badge.text}</span>
        )}
      </div>
      <p className={`text-sm text-gray-900 mt-1 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
