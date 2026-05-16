import { DiagnosticFinding } from "../types/diagnostics.js";

export function diagnosticFindingsJson(findings: DiagnosticFinding[]): string {
  return JSON.stringify({ findings }, null, 2);
}

export function appendDiagnosticFindings(
  output: string[],
  findings: DiagnosticFinding[]
): void {
  output.push("");
  output.push("DIAGNOSTIC FINDINGS JSON");
  output.push("───────────────────────────────────────────────────────────");
  output.push(diagnosticFindingsJson(findings));
}

export function createFindingId(prefix: string, stablePart: string): string {
  return `${prefix}.${stablePart}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
