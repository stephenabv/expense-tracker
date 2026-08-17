import { describe, expect, it } from "vitest";

import {
  formatAmount,
  formatCurrency,
  parseAmount,
  roundCurrency,
} from "@/lib/currency";

describe("formatCurrency", () => {
  it("formats with the peso sign and two decimals", () => {
    expect(formatCurrency(13_000)).toBe("₱13,000.00");
    expect(formatCurrency(500)).toBe("₱500.00");
    expect(formatCurrency(12_500)).toBe("₱12,500.00");
  });

  it("formats negatives", () => {
    expect(formatCurrency(-500)).toBe("-₱500.00");
  });

  it("formats very large values with separators", () => {
    expect(formatCurrency(999_999_999_999.99)).toBe("₱999,999,999,999.99");
  });

  it("falls back to zero for non-finite input", () => {
    expect(formatCurrency(Number.NaN)).toBe("₱0.00");
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe("₱0.00");
  });
});

describe("formatAmount", () => {
  it("omits the currency symbol", () => {
    expect(formatAmount(13_000)).toBe("13,000.00");
  });
});

describe("roundCurrency", () => {
  it("rounds to two decimals", () => {
    expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
    expect(roundCurrency(1.005)).toBe(1.01);
  });

  it("returns zero for non-finite input", () => {
    expect(roundCurrency(Number.NaN)).toBe(0);
  });
});

describe("parseAmount", () => {
  it("parses plain numbers", () => {
    expect(parseAmount("500")).toBe(500);
    expect(parseAmount("500.75")).toBe(500.75);
  });

  it("tolerates currency symbols, spaces and separators", () => {
    expect(parseAmount(" ₱1,234.50 ")).toBe(1_234.5);
  });

  it("rounds to the nearest centavo", () => {
    expect(parseAmount("10.005")).toBe(10.01);
  });

  it("returns null for empty or invalid input", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount(".")).toBeNull();
    expect(parseAmount("-")).toBeNull();
  });

  it("rejects exponent and hex notation", () => {
    expect(parseAmount("1e9")).toBeNull();
    expect(parseAmount("0x10")).toBeNull();
  });

  it("parses negatives so validators can reject them with a clear message", () => {
    expect(parseAmount("-10")).toBe(-10);
  });
});
