import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, pctChange } from "../../src/utils/format.js";

describe("formatBytes", () => {
  it("formats zero bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats positive byte values with the default precision", () => {
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
  });

  it("formats negative byte values", () => {
    expect(formatBytes(-1536)).toBe("-1.50 KB");
  });

  it("supports precision and max unit options", () => {
    expect(formatBytes(1024 * 1024 * 3, { decimals: 1, maxUnit: "MB" })).toBe("3.0 MB");
    expect(formatBytes(1024 * 1024 * 3, { decimals: 1, maxUnit: "KB" })).toBe(
      "3072.0 KB"
    );
  });
});

describe("formatDuration", () => {
  it("formats sub-millisecond, millisecond, and second durations", () => {
    expect(formatDuration(0.5)).toBe("<1ms");
    expect(formatDuration(42.2)).toBe("42ms");
    expect(formatDuration(1234)).toBe("1.23s");
  });
});

describe("pctChange", () => {
  it("formats regular percentage changes", () => {
    expect(pctChange(100, 125)).toBe("+25.0%");
    expect(pctChange(100, 75)).toBe("-25.0%");
  });

  it("handles zero baselines", () => {
    expect(pctChange(0, 10)).toBe("+∞%");
    expect(pctChange(0, 0)).toBe("0%");
  });
});
