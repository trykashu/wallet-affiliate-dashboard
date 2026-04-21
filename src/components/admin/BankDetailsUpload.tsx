"use client";

import { useState, useCallback } from "react";
import {
  validateRoutingNumber,
  validateAccountNumber,
  cleanRoutingNumber,
  cleanAccountNumber,
} from "@/lib/bank-validation";

interface PreviewRow {
  email: string;
  routing_number: string;
  account_number: string;
  account_name: string;
  routingValid: boolean;
  accountValid: boolean;
  routingError?: string;
  accountError?: string;
}

interface UploadResult {
  processed: number;
  created: number;
  updated: number;
  errors: { row: number; email: string; error: string }[];
}

function parseCsvClient(text: string): PreviewRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const emailIdx = header.indexOf("email");
  const routingIdx = header.indexOf("routing_number");
  const accountIdx = header.indexOf("account_number");
  const nameIdx = header.indexOf("account_name");

  if (emailIdx === -1 || routingIdx === -1 || accountIdx === -1) {
    throw new Error("CSV must have columns: email, routing_number, account_number");
  }

  const rows: PreviewRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",").map((c) => c.trim());

    const email = cols[emailIdx] || "";
    const routing = cols[routingIdx] || "";
    const account = cols[accountIdx] || "";
    const name = nameIdx !== -1 ? cols[nameIdx] || "" : "";

    const routingResult = validateRoutingNumber(routing);
    const accountResult = validateAccountNumber(account);

    rows.push({
      email,
      routing_number: routing,
      account_number: account,
      account_name: name,
      routingValid: routingResult.valid,
      accountValid: accountResult.valid,
      routingError: routingResult.error,
      accountError: accountResult.error,
    });
  }
  return rows;
}

export default function BankDetailsUpload() {
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      setResult(null);
      setParseError(null);
      setPreview(null);

      const selected = e.target.files?.[0];
      if (!selected) {
        setFile(null);
        return;
      }
      setFile(selected);

      try {
        const text = await selected.text();
        const rows = parseCsvClient(text);
        if (rows.length === 0) {
          setParseError("CSV has no data rows");
          return;
        }
        setPreview(rows);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Failed to parse CSV");
      }
    },
    []
  );

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/admin/upload-bank-details", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setParseError(data.error || "Upload failed");
        return;
      }
      setResult(data);
    } catch {
      setParseError("Network error during upload");
    } finally {
      setUploading(false);
    }
  }, [file]);

  const validCount = preview?.filter((r) => r.routingValid && r.accountValid).length ?? 0;
  const invalidCount = preview ? preview.length - validCount : 0;

  return (
    <div className="card p-6 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-brand-400 uppercase tracking-wider">
          Import Bank Details
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          Upload a CSV with columns: email, routing_number, account_number, account_name
        </p>
      </div>

      {/* Drop zone / file picker */}
      <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-surface-200 rounded-xl cursor-pointer hover:border-accent hover:bg-gray-50 transition-colors">
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          <svg
            className="w-8 h-8 mb-2 text-brand-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <p className="text-sm text-gray-600">
            {file ? file.name : "Click to select CSV file"}
          </p>
        </div>
        <input
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileChange}
        />
      </label>

      {parseError && (
        <div className="bg-red-50 text-red-600 border border-red-200 rounded-xl px-4 py-3 text-sm">
          {parseError}
        </div>
      )}

      {/* Preview table */}
      {preview && preview.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">{preview.length} rows found</span>
            <span className="text-accent font-medium">{validCount} valid</span>
            {invalidCount > 0 && (
              <span className="text-red-500 font-medium">{invalidCount} invalid</span>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-surface-200/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="th text-left px-3 py-2">Email</th>
                  <th className="th text-left px-3 py-2">Routing #</th>
                  <th className="th text-left px-3 py-2">Account #</th>
                  <th className="th text-left px-3 py-2">Name</th>
                  <th className="th text-center px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200/60">
                {preview.map((row, i) => {
                  const isValid = row.routingValid && row.accountValid;
                  const cleaned = cleanAccountNumber(row.account_number);
                  const masked = cleaned.length >= 4
                    ? "****" + cleaned.slice(-4)
                    : row.account_number;
                  const cleanedRouting = cleanRoutingNumber(row.routing_number);

                  return (
                    <tr key={i} className={isValid ? "" : "bg-red-50/50"}>
                      <td className="px-3 py-2 text-gray-600">{row.email}</td>
                      <td className="px-3 py-2 text-gray-600 tabular-nums">{cleanedRouting}</td>
                      <td className="px-3 py-2 text-gray-600 tabular-nums">{masked}</td>
                      <td className="px-3 py-2 text-gray-600">{row.account_name || "-"}</td>
                      <td className="px-3 py-2 text-center">
                        {isValid ? (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent/10 text-accent text-xs font-bold">
                            &#10003;
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-500 text-xs font-bold cursor-help"
                            title={row.routingError || row.accountError || "Invalid"}
                          >
                            &#10007;
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleUpload}
            disabled={uploading || validCount === 0}
            className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Uploading...
              </span>
            ) : (
              `Upload ${validCount} Account${validCount !== 1 ? "s" : ""}`
            )}
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-accent/10 rounded-xl px-4 py-3 text-center">
              <p className="text-lg font-bold text-accent tabular-nums">{result.created}</p>
              <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Created</p>
            </div>
            <div className="bg-blue-50 rounded-xl px-4 py-3 text-center">
              <p className="text-lg font-bold text-blue-600 tabular-nums">{result.updated}</p>
              <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Updated</p>
            </div>
            <div className={`rounded-xl px-4 py-3 text-center ${result.errors.length > 0 ? "bg-red-50" : "bg-gray-50"}`}>
              <p className={`text-lg font-bold tabular-nums ${result.errors.length > 0 ? "text-red-500" : "text-gray-400"}`}>
                {result.errors.length}
              </p>
              <p className="text-[10px] text-brand-400 uppercase tracking-wider font-medium">Errors</p>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-red-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-red-50">
                    <th className="th text-left px-3 py-2">Row</th>
                    <th className="th text-left px-3 py-2">Email</th>
                    <th className="th text-left px-3 py-2">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-100">
                  {result.errors.map((err, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-gray-600 tabular-nums">{err.row}</td>
                      <td className="px-3 py-2 text-gray-600">{err.email}</td>
                      <td className="px-3 py-2 text-red-600">{err.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
