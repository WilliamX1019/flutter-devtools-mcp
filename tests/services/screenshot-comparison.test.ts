import { describe, expect, it } from "vitest";
import {
  base64ToBuffer,
  compareScreenshotBuffers,
  screenshotMetadata,
} from "../../src/services/screenshot-comparison.js";

function pngBuffer(width: number, height: number, tail: number[] = []): Buffer {
  const buffer = Buffer.alloc(24 + tail.length);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  Buffer.from(tail).copy(buffer, 24);
  return buffer;
}

describe("screenshotMetadata", () => {
  it("extracts PNG dimensions and hash metadata", () => {
    const metadata = screenshotMetadata(pngBuffer(390, 844, [1, 2, 3]));

    expect(metadata).toMatchObject({
      bytes: 27,
      width: 390,
      height: 844,
    });
    expect(metadata.sha256).toHaveLength(64);
  });

  it("omits dimensions for non-PNG buffers", () => {
    const metadata = screenshotMetadata(Buffer.from("not a png"));

    expect(metadata.width).toBeUndefined();
    expect(metadata.height).toBeUndefined();
  });
});

describe("compareScreenshotBuffers", () => {
  it("marks identical screenshots as exact matches", () => {
    const before = pngBuffer(100, 200, [1, 2, 3]);
    const comparison = compareScreenshotBuffers(before, Buffer.from(before));

    expect(comparison.exactMatch).toBe(true);
    expect(comparison.byteDiffCount).toBe(0);
    expect(comparison.byteDiffRatio).toBe(0);
    expect(comparison.summary).toBe("Screenshots are byte-identical.");
  });

  it("reports byte and dimension differences", () => {
    const comparison = compareScreenshotBuffers(
      pngBuffer(100, 200, [1, 2, 3]),
      pngBuffer(120, 200, [1, 9, 3, 4])
    );

    expect(comparison.exactMatch).toBe(false);
    expect(comparison.dimensionsChanged).toBe(true);
    expect(comparison.sizeChanged).toBe(true);
    expect(comparison.byteDiffCount).toBeGreaterThan(0);
    expect(comparison.summary).toContain("Dimensions changed");
  });
});

describe("base64ToBuffer", () => {
  it("decodes plain and data URL base64 PNG payloads", () => {
    const source = pngBuffer(1, 1, [7]);
    const base64 = source.toString("base64");

    expect(base64ToBuffer(base64)).toEqual(source);
    expect(base64ToBuffer(`data:image/png;base64,${base64}`)).toEqual(source);
  });
});
