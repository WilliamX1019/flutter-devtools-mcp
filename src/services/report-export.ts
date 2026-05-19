import { compareDiagnosticRuns } from "./diagnostic-comparison.js";
import {
  DiagnosticFinding,
  DiagnosticObservation,
  DiagnosticRunComparison,
  DiagnosticSession,
} from "../types/diagnostics.js";

export type DiagnosticReportFormat = "markdown" | "html";

export interface DiagnosticReport {
  format: DiagnosticReportFormat;
  content: string;
  comparison?: DiagnosticRunComparison;
}

export function renderDiagnosticReport(
  session: DiagnosticSession,
  format: DiagnosticReportFormat
): DiagnosticReport {
  const comparison = safeComparison(session);
  const markdown = renderMarkdownReport(session, comparison);

  return {
    format,
    content: format === "html" ? markdownToHtml(markdown) : markdown,
    comparison,
  };
}

function safeComparison(
  session: DiagnosticSession
): DiagnosticRunComparison | undefined {
  try {
    return compareDiagnosticRuns(session);
  } catch {
    return undefined;
  }
}

function renderMarkdownReport(
  session: DiagnosticSession,
  comparison?: DiagnosticRunComparison
): string {
  const lines = [
    `# Flutter Diagnostic Report: ${session.problemType}`,
    "",
    "## Session",
    "",
    `- Session ID: \`${session.id}\``,
    `- Status: \`${session.status}\``,
    `- Started: ${formatDate(session.startedAt)}`,
    `- Ended: ${session.endedAt ? formatDate(session.endedAt) : "not ended"}`,
    `- Observations: ${session.observations.length}`,
    `- Verification runs: ${session.verificationRuns.length}`,
  ];

  if (session.notes.length > 0) {
    lines.push("", "## Notes", "", ...session.notes.map((note) => `- ${note}`));
  }

  if (session.baseline) {
    lines.push("", "## Runtime Baseline", "");
    appendObservationSummary(lines, session.baseline);
  }

  lines.push("", "## Findings", "");
  const findings = session.observations.flatMap((observation) =>
    observation.findings.map((finding) => ({ finding, observation }))
  );
  if (findings.length === 0) {
    lines.push("No structured findings recorded.");
  } else {
    for (const { finding, observation } of findings) {
      appendFinding(lines, finding, observation);
    }
  }

  lines.push("", "## Before / After Verification", "");
  if (comparison) {
    lines.push(
      `- Verdict: \`${comparison.verdict}\``,
      `- Before observation: \`${comparison.beforeObservationId}\``,
      `- After observation: \`${comparison.afterObservationId}\``,
      `- Summary: ${comparison.summary}`,
      `- Resolved findings: ${comparison.resolvedFindingIds.length}`,
      `- New findings: ${comparison.newFindingIds.length}`,
      ""
    );
    if (comparison.metricComparisons.length > 0) {
      lines.push("| Metric | Before | After | Delta | Verdict |");
      lines.push("|---|---:|---:|---:|---|");
      for (const metric of comparison.metricComparisons) {
        lines.push(
          `| ${escapeMarkdown(metric.name)} | ${metric.before.value} ${metric.before.unit} | ${metric.after.value} ${metric.after.unit} | ${formatDelta(metric.delta, metric.after.unit)} | ${metric.verdict} |`
        );
      }
    } else {
      lines.push("No comparable metric pairs were recorded.");
    }
  } else {
    lines.push(
      "No before/after comparison is available. Record a baseline and a verification observation first."
    );
  }

  lines.push("", "## Recommendations", "");
  const recommendations = unique(
    findings
      .map(({ finding }) => finding.recommendation)
      .filter((value): value is string => Boolean(value))
  );
  if (recommendations.length === 0) {
    lines.push("No structured recommendations recorded.");
  } else {
    lines.push(...recommendations.map((recommendation) => `- ${recommendation}`));
  }

  return `${lines.join("\n")}\n`;
}

function appendObservationSummary(
  lines: string[],
  observation: DiagnosticObservation
): void {
  lines.push(
    `- Observation ID: \`${observation.id}\``,
    `- Source tool: \`${observation.sourceTool}\``,
    `- Captured: ${formatDate(observation.capturedAt)}`,
    `- Findings: ${observation.findings.length}`
  );
  if (observation.label) {
    lines.push(`- Label: ${observation.label}`);
  }
}

function appendFinding(
  lines: string[],
  finding: DiagnosticFinding,
  observation: DiagnosticObservation
): void {
  lines.push(
    `### ${finding.title}`,
    "",
    `- ID: \`${finding.id}\``,
    `- Observation: \`${observation.id}\` from \`${observation.sourceTool}\``,
    `- Severity: \`${finding.severity}\``,
    `- Category: \`${finding.category}\``,
    `- Evidence: ${finding.evidence}`
  );

  if (finding.metric) {
    lines.push(
      `- Metric: ${finding.metric.name} = ${finding.metric.value} ${finding.metric.unit}${finding.metric.threshold !== undefined ? ` (threshold ${finding.metric.threshold})` : ""}`
    );
  }
  if (finding.location) {
    lines.push(
      `- Location: ${[
        finding.location.file,
        finding.location.line,
        finding.location.column,
        finding.location.symbol,
      ]
        .filter((value) => value !== undefined)
        .join(":")}`
    );
  }
  if (finding.recommendation) {
    lines.push(`- Recommendation: ${finding.recommendation}`);
  }
  if (finding.nextTool) {
    lines.push(`- Next tool: \`${finding.nextTool}\``);
  }
  lines.push("");
}

function markdownToHtml(markdown: string): string {
  const body = markdown
    .split("\n")
    .map((line) => {
      if (line.startsWith("# ")) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
      if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (line.startsWith("### ")) return `<h3>${escapeHtml(line.slice(4))}</h3>`;
      if (line.startsWith("- "))
        return `<li>${inlineMarkdownToHtml(line.slice(2))}</li>`;
      if (line.startsWith("|")) return `<pre>${escapeHtml(line)}</pre>`;
      if (line.trim() === "") return "";
      return `<p>${inlineMarkdownToHtml(line)}</p>`;
    })
    .join("\n");

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    "<title>Flutter Diagnostic Report</title>",
    "<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.5;max-width:960px;margin:40px auto;padding:0 24px;color:#1f2937}code{background:#f3f4f6;padding:2px 4px;border-radius:4px}pre{background:#f9fafb;padding:8px;border:1px solid #e5e7eb;overflow:auto}</style>",
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function inlineMarkdownToHtml(value: string): string {
  return escapeHtml(value).replace(/`([^`]+)`/g, "<code>$1</code>");
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function formatDelta(value: number, unit: string): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value.toFixed(2))} ${unit}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
