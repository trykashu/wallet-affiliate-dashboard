"use client";

import { useState } from "react";

export interface EditBankExisting {
  account_name?: string | null;
  last4?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
}

interface Props {
  affiliateId: string;
  affiliateName: string;
  existing: EditBankExisting | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditBankDrawer({
  affiliateId,
  affiliateName,
  existing,
  onClose,
  onSaved,
}: Props) {
  const [accountName, setAccountName] = useState(existing?.account_name ?? "");
  const [routing, setRouting] = useState("");
  const [account, setAccount] = useState("");
  const [address1, setAddress1] = useState(existing?.address1 ?? "");
  const [address2, setAddress2] = useState(existing?.address2 ?? "");
  const [city, setCity] = useState(existing?.city ?? "");
  const [region, setRegion] = useState(existing?.region ?? "");
  const [postalCode, setPostalCode] = useState(existing?.postal_code ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const accountTrimmed = account.trim();
  const canSave =
    accountName.trim().length >= 2 &&
    /^\d{9}$/.test(routing.trim()) &&
    (accountTrimmed === "" || /^\d{4,17}$/.test(accountTrimmed)) &&
    address1.trim().length >= 2 &&
    city.trim().length >= 2 &&
    /^[A-Za-z]{2}$/.test(region.trim()) &&
    /^\d{5}(-\d{4})?$/.test(postalCode.trim());

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      // account_number omitted when blank → API helper keeps existing number.
      const body: Record<string, unknown> = {
        account_holder_name: accountName.trim(),
        routing_number: routing.trim(),
        address1: address1.trim(),
        address2: address2.trim() || null,
        city: city.trim(),
        region: region.trim().toUpperCase(),
        postal_code: postalCode.trim(),
      };
      if (accountTrimmed !== "") body.account_number = accountTrimmed;

      const res = await fetch(`/api/admin/affiliates/${affiliateId}/bank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Save failed (${res.status})`);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={() => !busy && onClose()} />
      <div className="drawer-panel max-w-md">
        <div className="flex items-center justify-between mb-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">Manual bank edit</p>
            <h2 className="text-lg font-bold ad-text-1 mt-1 truncate">Edit bank details — {affiliateName}</h2>
            <p className="text-xs ad-text-3 mt-1">
              Admin override. Saving marks this account as verified and eligible for ACH transfers.
            </p>
          </div>
          <button
            onClick={() => !busy && onClose()}
            className="text-sm ad-text-3 hover:text-[var(--ad-text)] flex-shrink-0"
            aria-label="Close drawer"
          >Close</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">Account holder name</label>
            <input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="Jane Doe"
              className="ad-input w-full px-3 py-2 rounded-xl text-sm mt-1"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">Routing number</label>
            <input
              value={routing}
              onChange={(e) => setRouting(e.target.value.replace(/\D/g, "").slice(0, 9))}
              placeholder="9 digits"
              inputMode="numeric"
              maxLength={9}
              className="ad-input w-full px-3 py-2 rounded-xl text-sm mt-1 tabular-nums font-mono"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">Account number</label>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value.replace(/\D/g, "").slice(0, 17))}
              placeholder={`•••• ${existing?.last4 ?? "----"}`}
              inputMode="numeric"
              maxLength={17}
              className="ad-input w-full px-3 py-2 rounded-xl text-sm mt-1 tabular-nums font-mono"
            />
            <p className="text-[10px] ad-text-3 mt-1">Leave blank to keep the existing account number.</p>
          </div>

          <div>
            <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">Address Line 1</label>
            <input
              value={address1}
              onChange={(e) => setAddress1(e.target.value)}
              placeholder="304 S. Jones Blvd"
              className="ad-input w-full px-3 py-2 rounded-xl text-sm mt-1"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">Address Line 2 (optional)</label>
            <input
              value={address2}
              onChange={(e) => setAddress2(e.target.value)}
              placeholder="Suite 100"
              className="ad-input w-full px-3 py-2 rounded-xl text-sm mt-1"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">City</label>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Las Vegas"
                className="ad-input w-full px-3 py-2 rounded-xl text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">State</label>
              <input
                value={region}
                onChange={(e) => setRegion(e.target.value.toUpperCase().slice(0, 2))}
                placeholder="NV"
                maxLength={2}
                className="ad-input w-full px-3 py-2 rounded-xl text-sm mt-1 uppercase"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold ad-text-3 uppercase tracking-wider">ZIP Code</label>
            <input
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="89107"
              maxLength={10}
              className="ad-input w-full px-3 py-2 rounded-xl text-sm mt-1 tabular-nums"
            />
          </div>
        </div>

        {err && (
          <div className="mt-3 bg-[rgba(242,112,110,0.10)] border border-[rgba(242,112,110,0.28)] rounded-xl px-3 py-2 text-xs text-[var(--ad-neg)]">{err}</div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="text-xs font-semibold ad-text-2 px-3 py-2">Cancel</button>
          <button
            onClick={save}
            disabled={!canSave || busy}
            className="ad-btn-primary text-xs px-4 py-2 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Saving…" : "Save bank details"}
          </button>
        </div>
      </div>
    </>
  );
}
