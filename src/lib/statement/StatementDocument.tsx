import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { StatementData } from "./types";

const COLORS = {
  brand600: "#0C5147",
  accent: "#00DE8F",
  amberBg: "#FEF3C7",
  amberText: "#92400E",
  textPrimary: "#111827",
  textMuted: "#6B7280",
  border: "#E5E7EB",
  noteBg: "#ECFDF5",
};

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: COLORS.textPrimary,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  logoText: { fontSize: 18, fontWeight: 700, color: COLORS.brand600 },
  statementTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: COLORS.textPrimary,
    textAlign: "right",
  },
  statementNumber: {
    fontSize: 9,
    color: COLORS.textMuted,
    textAlign: "right",
    marginTop: 2,
  },
  headerFieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 2,
  },
  headerFieldLabel: { fontWeight: 700 },
  headerFieldValue: { textAlign: "right" },
  tierPill: {
    backgroundColor: COLORS.amberBg,
    color: COLORS.amberText,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    fontSize: 9,
    fontWeight: 700,
  },
  hr: {
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    marginVertical: 12,
  },
  twoCol: { flexDirection: "row", marginBottom: 18 },
  col: { flex: 1 },
  sectionLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: COLORS.brand600,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  addressLine: { lineHeight: 1.4 },
  table: { marginTop: 8 },
  tableHeader: {
    flexDirection: "row",
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    paddingVertical: 6,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    paddingVertical: 8,
  },
  th: {
    fontSize: 8,
    fontWeight: 700,
    color: COLORS.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  td: { fontSize: 10 },
  colDate: { width: "15%" },
  colClient: { width: "28%" },
  colTxn: { width: "19%", textAlign: "right" },
  colFee: { width: "19%", textAlign: "right" },
  colCommission: { width: "19%", textAlign: "right", fontWeight: 700 },
  totalsBlock: { marginTop: 14, alignItems: "flex-end" },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "50%",
    paddingVertical: 4,
  },
  totalsLabel: { color: COLORS.textMuted },
  totalsValue: { fontWeight: 700 },
  commissionDueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "50%",
    paddingVertical: 8,
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    marginTop: 4,
  },
  commissionDueLabel: { fontSize: 13, fontWeight: 700 },
  commissionDueValue: { fontSize: 13, fontWeight: 700 },
  notesBlock: {
    marginTop: 24,
    padding: 14,
    backgroundColor: COLORS.noteBg,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.accent,
  },
  notesLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: COLORS.brand600,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  notesText: { fontSize: 9, lineHeight: 1.5, color: COLORS.textMuted },
});

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

export function StatementDocument({ data }: { data: StatementData }) {
  const tierLabel = data.affiliate.tier === "platinum" ? "Platinum" : "Gold";
  return (
    <Document title={data.statement_number} author="Kashu, Inc.">
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.logoText}>Kashu</Text>
          </View>
          <View>
            <Text style={styles.statementTitle}>Statement</Text>
            <Text style={styles.statementNumber}>#{data.statement_number}</Text>
          </View>
        </View>

        <View>
          <View style={styles.headerFieldRow}>
            <Text style={styles.headerFieldLabel}>Statement Date</Text>
            <Text style={styles.headerFieldValue}>{data.statement_date}</Text>
          </View>
          <View style={styles.headerFieldRow}>
            <Text style={styles.headerFieldLabel}>Period</Text>
            <Text style={styles.headerFieldValue}>{data.period_label}</Text>
          </View>
          <View style={styles.headerFieldRow}>
            <Text style={styles.headerFieldLabel}>Affiliate Tier</Text>
            <Text style={styles.tierPill}>{tierLabel}</Text>
          </View>
          <View style={styles.headerFieldRow}>
            <Text style={styles.headerFieldLabel}>Eligible Transactions</Text>
            <Text style={styles.headerFieldValue}>
              {data.totals.eligible_count}
            </Text>
          </View>
        </View>

        <View style={styles.hr} />

        <View style={styles.twoCol}>
          <View style={styles.col}>
            <Text style={styles.sectionLabel}>Issued By</Text>
            <Text style={{ fontWeight: 700 }}>Kashu, Inc.</Text>
            <Text style={styles.addressLine}>
              1603 Capitol Ave Ste 415 #674380
            </Text>
            <Text style={styles.addressLine}>Cheyenne, Wyoming 82001</Text>
            <Text style={styles.addressLine}>(888) 900-5056</Text>
            <Text style={styles.addressLine}>help@kashupay.com</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.sectionLabel}>Paid To</Text>
            <Text style={{ fontWeight: 700 }}>{data.affiliate.name}</Text>
            <Text style={styles.addressLine}>{data.affiliate.address1}</Text>
            {data.affiliate.address2 ? (
              <Text style={styles.addressLine}>{data.affiliate.address2}</Text>
            ) : null}
            <Text style={styles.addressLine}>
              {data.affiliate.city}, {data.affiliate.region}{" "}
              {data.affiliate.postal_code}
            </Text>
            {data.affiliate.phone ? (
              <Text style={styles.addressLine}>{data.affiliate.phone}</Text>
            ) : null}
            <Text style={styles.addressLine}>{data.affiliate.email}</Text>
            <Text
              style={{
                ...styles.addressLine,
                color: COLORS.textMuted,
                marginTop: 4,
              }}
            >
              Acct •••• {data.affiliate.account_last4}
            </Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.colDate]}>Date</Text>
            <Text style={[styles.th, styles.colClient]}>Client</Text>
            <Text style={[styles.th, styles.colTxn]}>Transaction</Text>
            <Text style={[styles.th, styles.colFee]}>Fee Collected</Text>
            <Text style={[styles.th, styles.colCommission]}>
              Commission ({data.totals.commission_rate_pct}%)
            </Text>
          </View>
          {data.transactions.map((t, i) => (
            <View key={i} style={styles.tableRow} wrap={false}>
              <Text style={[styles.td, styles.colDate]}>{t.date}</Text>
              <Text style={[styles.td, styles.colClient]}>{t.client}</Text>
              <Text style={[styles.td, styles.colTxn]}>
                {fmtMoney(t.transaction_amount)}
              </Text>
              <Text style={[styles.td, styles.colFee]}>
                {fmtMoney(t.fee_collected)}
              </Text>
              <Text style={[styles.td, styles.colCommission]}>
                {fmtMoney(t.commission)}
              </Text>
            </View>
          ))}
          {data.transactions.length === 0 ? (
            <View style={styles.tableRow}>
              <Text
                style={[
                  styles.td,
                  {
                    textAlign: "center",
                    width: "100%",
                    color: COLORS.textMuted,
                  },
                ]}
              >
                No eligible transactions for this period.
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Total Fees Collected</Text>
            <Text style={styles.totalsValue}>
              {fmtMoney(data.totals.total_fees)}
            </Text>
          </View>
          <View style={styles.commissionDueRow}>
            <Text style={styles.commissionDueLabel}>Commission Due</Text>
            <Text style={styles.commissionDueValue}>
              {fmtMoney(data.totals.commission_due)}
            </Text>
          </View>
        </View>

        <View style={styles.notesBlock}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text style={styles.notesText}>
            This statement reflects all eligible affiliate transactions for the
            period shown. Commission is calculated at{" "}
            {data.totals.commission_rate_pct}% of the platform service fee
            collected on each referred user&apos;s transaction per the{" "}
            {tierLabel} tier affiliate agreement. Payment will be processed
            according to the standard payout schedule.{"\n\n"}
            View your full payout history at aff.kashupay.com/dashboard/payouts.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
