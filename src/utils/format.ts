export interface FormatBytesOptions {
  decimals?: number;
  maxUnit?: "B" | "KB" | "MB" | "GB";
}

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number, options: FormatBytesOptions = {}): string {
  if (bytes === 0) return "0 B";

  const decimals = options.decimals ?? 2;
  const maxUnit = options.maxUnit ?? "GB";
  const maxUnitIndex = BYTE_UNITS.indexOf(maxUnit);
  const sign = bytes < 0 ? "-" : "";
  const abs = Math.abs(bytes);
  const unitIndex = Math.min(Math.floor(Math.log(abs) / Math.log(1024)), maxUnitIndex);

  return `${sign}${(abs / Math.pow(1024, unitIndex)).toFixed(decimals)} ${BYTE_UNITS[unitIndex]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function pctChange(before: number, after: number): string {
  if (before === 0) return after > 0 ? "+∞%" : "0%";
  const pct = ((after - before) / before) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}
