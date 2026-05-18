import { createHash } from "node:crypto";

export interface ScreenshotMetadata {
  bytes: number;
  sha256: string;
  width?: number;
  height?: number;
}

export interface ScreenshotComparison {
  before: ScreenshotMetadata;
  after: ScreenshotMetadata;
  exactMatch: boolean;
  byteDiffCount: number;
  byteDiffRatio: number;
  sizeChanged: boolean;
  dimensionsChanged: boolean;
  summary: string;
}

const PNG_SIGNATURE = "89504e470d0a1a0a";

export function screenshotMetadata(buffer: Buffer): ScreenshotMetadata {
  return {
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    ...pngDimensions(buffer),
  };
}

export function compareScreenshotBuffers(
  before: Buffer,
  after: Buffer
): ScreenshotComparison {
  const beforeMetadata = screenshotMetadata(before);
  const afterMetadata = screenshotMetadata(after);
  const byteDiffCount = countByteDifferences(before, after);
  const exactMatch = beforeMetadata.sha256 === afterMetadata.sha256;
  const sizeChanged = beforeMetadata.bytes !== afterMetadata.bytes;
  const dimensionsChanged =
    beforeMetadata.width !== afterMetadata.width ||
    beforeMetadata.height !== afterMetadata.height;
  const byteDiffRatio =
    Math.max(beforeMetadata.bytes, afterMetadata.bytes) === 0
      ? 0
      : byteDiffCount / Math.max(beforeMetadata.bytes, afterMetadata.bytes);

  return {
    before: beforeMetadata,
    after: afterMetadata,
    exactMatch,
    byteDiffCount,
    byteDiffRatio,
    sizeChanged,
    dimensionsChanged,
    summary: buildSummary({
      exactMatch,
      byteDiffCount,
      byteDiffRatio,
      sizeChanged,
      dimensionsChanged,
      before: beforeMetadata,
      after: afterMetadata,
    }),
  };
}

export function base64ToBuffer(base64: string): Buffer {
  const normalized = base64.replace(/^data:image\/png;base64,/, "");
  return Buffer.from(normalized, "base64");
}

function countByteDifferences(before: Buffer, after: Buffer): number {
  const minLength = Math.min(before.length, after.length);
  let diff = Math.abs(before.length - after.length);

  for (let index = 0; index < minLength; index++) {
    if (before[index] !== after[index]) diff++;
  }

  return diff;
}

function pngDimensions(buffer: Buffer): Pick<ScreenshotMetadata, "width" | "height"> {
  if (buffer.length < 24) return {};
  if (buffer.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) return {};

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function buildSummary(args: {
  before: ScreenshotMetadata;
  after: ScreenshotMetadata;
  exactMatch: boolean;
  byteDiffCount: number;
  byteDiffRatio: number;
  sizeChanged: boolean;
  dimensionsChanged: boolean;
}): string {
  if (args.exactMatch) {
    return "Screenshots are byte-identical.";
  }

  const parts = [
    `Screenshots differ in ${args.byteDiffCount.toLocaleString()} bytes (${(args.byteDiffRatio * 100).toFixed(2)}%).`,
  ];

  if (args.dimensionsChanged) {
    parts.push(
      `Dimensions changed from ${formatDimensions(args.before)} to ${formatDimensions(args.after)}.`
    );
  }

  if (args.sizeChanged) {
    parts.push(
      `File size changed from ${args.before.bytes.toLocaleString()} to ${args.after.bytes.toLocaleString()} bytes.`
    );
  }

  return parts.join(" ");
}

function formatDimensions(metadata: ScreenshotMetadata): string {
  if (metadata.width === undefined || metadata.height === undefined) {
    return "unknown";
  }
  return `${metadata.width}x${metadata.height}`;
}
