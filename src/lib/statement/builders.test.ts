import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildStatementNumber, formatPeriodLabel, commissionRatePct } from "./builders";

describe("buildStatementNumber", () => {
  it("is deterministic per (period, affiliate)", () => {
    const a = buildStatementNumber("2026-04", "a7b3c1d2-1234-5678-9abc-def012345678");
    const b = buildStatementNumber("2026-04", "a7b3c1d2-1234-5678-9abc-def012345678");
    assert.equal(a, b);
    assert.equal(a, "KS-2026-04-A7B3C1");
  });

  it("uppercases the affiliate id chunk", () => {
    assert.equal(
      buildStatementNumber("2026-12", "deadbeef-1111-2222-3333-444455556666"),
      "KS-2026-12-DEADBE",
    );
  });
});

describe("formatPeriodLabel", () => {
  it("converts YYYY-MM to long month + year", () => {
    assert.equal(formatPeriodLabel("2026-04"), "April 2026");
    assert.equal(formatPeriodLabel("2025-12"), "December 2025");
  });

  it("returns the input verbatim for malformed period", () => {
    assert.equal(formatPeriodLabel("not-a-period"), "not-a-period");
    assert.equal(formatPeriodLabel(""), "");
  });
});

describe("commissionRatePct", () => {
  it("returns 5 for gold tier with no override", () => {
    assert.equal(commissionRatePct("gold", null), 5);
  });
  it("returns 10 for platinum tier with no override", () => {
    assert.equal(commissionRatePct("platinum", null), 10);
  });
  it("uses custom rate when set", () => {
    assert.equal(commissionRatePct("gold", 0.075), 7.5);
    assert.equal(commissionRatePct("platinum", 0.15), 15);
  });
  it("rounds custom rate to 1 decimal", () => {
    // 0.1234 * 100 = 12.34 → 12.3
    assert.equal(commissionRatePct("gold", 0.1234), 12.3);
  });
});
