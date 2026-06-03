import React from "react";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { StatementData } from "./types";

/**
 * Affiliate statement PDF — matches Kashu Statement Skin (Jun 2026).
 *
 * Layout:
 *   - Header: Kashu logo (left) + big "Statement" title with accent-green
 *     statement number (right)
 *   - Metadata rows (label left, value right): Statement Date, Period,
 *     Affiliate Tier (pill), Eligible Transactions
 *   - Two-column block: ISSUED BY (Kashu) | PAID TO (Affiliate)
 *   - Transactions table: DATE · CLIENT · FEE COLLECTED · COMMISSION (X%)
 *   - Totals stacked bottom-right (Fees small, Commission Due big bold)
 *   - Notes block (light-green bg + green left border)
 */

const COLORS = {
  // Brand
  brand600: "#0C5147",     // Kashu dark teal — wordmark, headings, body strong
  accent: "#00DE8F",       // Kashu mint — statement number, NOTES border, accent text
  // Surfaces
  white: "#FFFFFF",
  borderStrong: "#111827", // dark rule under table header / above totals row
  borderSoft: "#D1D5DB",   // light rule under metadata
  // Text
  textPrimary: "#111827",
  textBody: "#374151",
  textMuted: "#6B7280",
  // Tier pills
  amberBg: "#FEF3C7",
  amberText: "#92400E",
  amberDot: "#F59E0B",
  slateBg: "#E2E8F0",
  slateText: "#334155",
  slateDot: "#64748B",
  // Notes block
  notesBg: "#F0FDF4",      // very light green tint
  notesBorder: "#0C5147",  // brand-600 left bar
};

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: COLORS.textPrimary,
  },

  // ── Header row ──────────────────────────────────────────────────
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 28,
  },
  logo: { width: 110, height: 26 },
  headerRight: { alignItems: "flex-end" },
  statementTitle: {
    fontSize: 32,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  },
  statementNumber: {
    fontSize: 10,
    fontFamily: "Helvetica-BoldOblique",
    color: COLORS.accent,
    marginTop: 2,
  },

  // ── Metadata rows ──────────────────────────────────────────────
  metaBlock: { marginBottom: 14 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  metaLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: COLORS.textPrimary,
  },
  metaValue: {
    fontSize: 10,
    color: COLORS.textBody,
    textAlign: "right",
  },
  metaValueAccent: {
    fontSize: 10,
    fontFamily: "Helvetica-BoldOblique",
    color: COLORS.accent,
    textAlign: "right",
  },

  hr: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSoft,
    marginVertical: 8,
  },

  // ── Tier pill ──────────────────────────────────────────────────
  tierPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tierDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    marginRight: 6,
  },
  tierText: { fontSize: 9, fontFamily: "Helvetica-Bold" },

  // ── Issued / Paid two-column block ─────────────────────────────
  twoCol: {
    flexDirection: "row",
    marginTop: 12,
    marginBottom: 18,
  },
  colLeft: { width: "50%", paddingRight: 12 },
  colRight: { width: "50%", paddingLeft: 12 },
  sectionLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: COLORS.brand600,
    letterSpacing: 1,
    marginBottom: 6,
  },
  blockName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  blockLine: {
    fontSize: 10,
    color: COLORS.textBody,
    lineHeight: 1.4,
  },
  blockAcct: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 4,
  },

  // ── Transactions table ─────────────────────────────────────────
  table: { marginTop: 10 },
  tableHeader: {
    flexDirection: "row",
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderStrong,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 14,
  },
  tableRowLast: {
    flexDirection: "row",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderStrong,
  },
  th: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textMuted,
    letterSpacing: 1,
  },
  td: {
    fontSize: 10,
    color: COLORS.textPrimary,
  },
  tdMuted: {
    fontSize: 10,
    color: COLORS.textBody,
  },
  colDate: { width: "20%" },
  colClient: { width: "35%" },
  colFee: { width: "22.5%", textAlign: "right" },
  colCommission: { width: "22.5%", textAlign: "right" },

  // ── Totals ─────────────────────────────────────────────────────
  totalsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingVertical: 8,
  },
  totalsLabel: {
    width: "60%",
    textAlign: "right",
    fontSize: 10,
    color: COLORS.textBody,
    paddingRight: 14,
  },
  totalsValue: {
    width: "22.5%",
    textAlign: "right",
    fontSize: 10,
    fontFamily: "Helvetica-BoldOblique",
    color: COLORS.textPrimary,
  },
  commissionDueRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingVertical: 8,
    marginTop: 4,
  },
  commissionDueLabel: {
    width: "60%",
    textAlign: "right",
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: COLORS.textPrimary,
    paddingRight: 14,
  },
  commissionDueValue: {
    width: "22.5%",
    textAlign: "right",
    fontSize: 14,
    fontFamily: "Helvetica-BoldOblique",
    color: COLORS.textPrimary,
  },

  // ── Notes ──────────────────────────────────────────────────────
  notesBlock: {
    marginTop: 30,
    flexDirection: "row",
    backgroundColor: COLORS.notesBg,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.notesBorder,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 2,
  },
  notesBody: { flex: 1 },
  notesHeading: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: COLORS.brand600,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  notesText: {
    fontSize: 9,
    color: COLORS.textBody,
    lineHeight: 1.5,
  },
  notesLink: {
    fontFamily: "Helvetica-Bold",
    color: COLORS.brand600,
  },
});

// Money formatter — keep this file self-contained; fmt.* helpers are
// client-only and React-PDF renders server-side.
const moneyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
function fmtMoney(n: number): string {
  return moneyFmt.format(n);
}

interface TierStyle {
  bg: string;
  text: string;
  dot: string;
  label: string;
}
function tierStyle(tier: "gold" | "platinum"): TierStyle {
  if (tier === "platinum") {
    return {
      bg: COLORS.slateBg,
      text: COLORS.slateText,
      dot: COLORS.slateDot,
      label: "Platinum",
    };
  }
  return {
    bg: COLORS.amberBg,
    text: COLORS.amberText,
    dot: COLORS.amberDot,
    label: "Gold",
  };
}

interface Props {
  data: StatementData;
  /** Public URL to the Kashu logo PNG. Defaults to /kashu-logo-statement.png on aff.kashupay.com. */
  logoUrl?: string;
}

const ASSET_URL = "https://aff.kashupay.com/kashu-logo-statement.png";

export function StatementDocument({ data, logoUrl = ASSET_URL }: Props) {
  const tier = tierStyle(data.affiliate.tier);
  const ratePct = data.totals.commission_rate_pct;

  return (
    <Document
      title={`${data.statement_number} — Affiliate Statement`}
      author="Kashu, Inc."
      subject={`Affiliate statement for ${data.affiliate.name} — ${data.period_label}`}
    >
      <Page size="LETTER" style={styles.page}>
        {/* ── Header ─────────────────────────────────────────── */}
        <View style={styles.headerRow}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={logoUrl} style={styles.logo} />
          <View style={styles.headerRight}>
            <Text style={styles.statementTitle}>Statement</Text>
            <Text style={styles.statementNumber}>#{data.statement_number}</Text>
          </View>
        </View>

        {/* ── Metadata rows ──────────────────────────────────── */}
        <View style={styles.metaBlock}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Statement Date</Text>
            <Text style={styles.metaValueAccent}>{data.statement_date}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Period</Text>
            <Text style={styles.metaValueAccent}>{data.period_label}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Affiliate Tier</Text>
            <View style={[styles.tierPill, { backgroundColor: tier.bg }]}>
              <View style={[styles.tierDot, { backgroundColor: tier.dot }]} />
              <Text style={[styles.tierText, { color: tier.text }]}>{tier.label}</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Eligible Transactions</Text>
            <Text style={styles.metaValueAccent}>{data.totals.eligible_count}</Text>
          </View>
        </View>

        <View style={styles.hr} />

        {/* ── Issued / Paid blocks ──────────────────────────── */}
        <View style={styles.twoCol}>
          <View style={styles.colLeft}>
            <Text style={styles.sectionLabel}>ISSUED BY</Text>
            <Text style={styles.blockName}>Kashu, Inc.</Text>
            <Text style={styles.blockLine}>1603 Capitol Ave Ste 415 #674380</Text>
            <Text style={styles.blockLine}>Cheyenne, Wyoming 82001</Text>
            <Text style={styles.blockLine}>(888) 900-5056</Text>
            <Text style={styles.blockLine}>help@kashupay.com</Text>
          </View>
          <View style={styles.colRight}>
            <Text style={styles.sectionLabel}>PAID TO</Text>
            <Text style={styles.blockName}>{data.affiliate.name}</Text>
            <Text style={styles.blockLine}>{data.affiliate.address1}</Text>
            {data.affiliate.address2 ? <Text style={styles.blockLine}>{data.affiliate.address2}</Text> : null}
            <Text style={styles.blockLine}>
              {data.affiliate.city}, {data.affiliate.region} {data.affiliate.postal_code}
            </Text>
            {data.affiliate.phone ? <Text style={styles.blockLine}>{data.affiliate.phone}</Text> : null}
            <Text style={styles.blockLine}>{data.affiliate.email}</Text>
            <Text style={styles.blockAcct}>Acct •••• {data.affiliate.account_last4}</Text>
          </View>
        </View>

        {/* ── Transactions table ────────────────────────────── */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.colDate]}>DATE</Text>
            <Text style={[styles.th, styles.colClient]}>CLIENT</Text>
            <Text style={[styles.th, styles.colFee]}>FEE COLLECTED</Text>
            <Text style={[styles.th, styles.colCommission]}>
              COMMISSION ({ratePct}%)
            </Text>
          </View>

          {data.transactions.length === 0 ? (
            <View style={styles.tableRow} wrap={false}>
              <Text
                style={[
                  styles.tdMuted,
                  { width: "100%", textAlign: "center" },
                ]}
              >
                No eligible transactions for this period.
              </Text>
            </View>
          ) : (
            data.transactions.map((t, i) => {
              const isLast = i === data.transactions.length - 1;
              return (
                <View
                  key={i}
                  style={isLast ? styles.tableRowLast : styles.tableRow}
                  wrap={false}
                >
                  <Text style={[styles.td, styles.colDate]}>{t.date}</Text>
                  <Text style={[styles.td, styles.colClient]}>{t.client}</Text>
                  <Text style={[styles.td, styles.colFee]}>
                    {fmtMoney(t.fee_collected)}
                  </Text>
                  <Text style={[styles.td, styles.colCommission]}>
                    {fmtMoney(t.commission)}
                  </Text>
                </View>
              );
            })
          )}

          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Total Fees Collected</Text>
            <Text style={styles.totalsValue}>{fmtMoney(data.totals.total_fees)}</Text>
          </View>
          <View style={styles.commissionDueRow}>
            <Text style={styles.commissionDueLabel}>Commission Due</Text>
            <Text style={styles.commissionDueValue}>
              {fmtMoney(data.totals.commission_due)}
            </Text>
          </View>
        </View>

        {/* ── Notes ─────────────────────────────────────────── */}
        <View style={styles.notesBlock}>
          <View style={styles.notesBody}>
            <Text style={styles.notesHeading}>NOTES</Text>
            <Text style={styles.notesText}>
              This statement reflects all eligible affiliate transactions for the
              period shown. Commission is calculated at {ratePct}% of the platform
              service fee collected on each referred user&apos;s transaction per the{" "}
              {tier.label} tier affiliate agreement. Payment will be processed
              according to the standard payout schedule. View your full payout
              history at{" "}
              <Text style={styles.notesLink}>aff.kashupay.com/dashboard/payouts</Text>.
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
