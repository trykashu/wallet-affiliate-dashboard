"use client";

import { useEffect, useState } from "react";

interface Props {
  referralUrl: string;
}

export default function QRCodeGenerator({ referralUrl }: Props) {
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  useEffect(() => {
    if (!referralUrl) return;

    async function generateQR() {
      try {
        const QRCode = (await import("qrcode")).default;
        const dataUrl = await QRCode.toDataURL(referralUrl, {
          width:  280,
          margin: 2,
          color: {
            dark:  "#0C5147",
            light: "#ffffff",
          },
          errorCorrectionLevel: "M",
        });
        setQrDataUrl(dataUrl);
      } catch (err) {
        console.error("QR generation failed:", err);
      }
    }

    generateQR();
  }, [referralUrl]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }

  function handleDownloadPNG() {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = "kashu-referral-qr.png";
    a.click();
  }

  return (
    <div className="card p-6 flex flex-col gap-5">
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900">QR Code</h3>
        <p className="text-xs text-brand-400 mt-0.5">
          Scan to open your referral link — great for in-person pitches
        </p>
      </div>

      {/* QR Code */}
      <div className="flex justify-center">
        {qrDataUrl ? (
          <div className="rounded-2xl overflow-hidden border border-gray-200 p-3 bg-brand-600 inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="Referral QR Code"
              width={200}
              height={200}
              className="block"
              style={{ imageRendering: "pixelated" }}
            />
          </div>
        ) : (
          <div className="w-[200px] h-[200px] rounded-2xl bg-surface-100 border border-surface-200/60 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* URL display + copy */}
      <div className="bg-surface-50/60 rounded-xl border border-surface-200/60 flex items-center gap-2 px-3 py-2.5">
        <p className="flex-1 text-xs text-brand-400 truncate font-mono">
          {referralUrl || "\u2014"}
        </p>
        <button
          onClick={handleCopy}
          className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-lg border transition-all ${
            copied
              ? "bg-accent/10 border-accent/30 text-accent"
              : "border-gray-200 text-brand-400 hover:text-brand-600 hover:bg-brand-50 hover:border-brand-600"
          }`}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      {/* Download */}
      <div className="flex gap-2">
        <button
          onClick={handleDownloadPNG}
          disabled={!qrDataUrl}
          className="flex-1 btn-ghost text-xs py-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Download PNG
        </button>
      </div>
    </div>
  );
}
