import { describe, expect, it } from "vitest";
import { renderDiagnosticReport } from "../../src/services/report-export.js";
import { DiagnosticSessionStore } from "../../src/services/diagnostic-session.js";
import { DiagnosticFinding } from "../../src/types/diagnostics.js";

function finding(value: number): DiagnosticFinding {
  return {
    id: "performance.jank-rate",
    severity: value > 10 ? "high" : "low",
    category: "performance",
    title: "Significant frame jank detected",
    evidence: `${value}% jank`,
    metric: {
      name: "jankPercentage",
      value,
      unit: "percent",
      threshold: 10,
    },
    recommendation: "Profile the interaction and reduce frame work.",
    nextTool: "start_profiling",
  };
}

function sessionWithVerification() {
  const store = new DiagnosticSessionStore();
  const session = store.start({ problemType: "jank", note: "Feed scroll" });
  store.record({
    sessionId: session.id,
    role: "baseline",
    sourceTool: "stop_profiling",
    label: "before",
    findings: [finding(20)],
  });
  store.record({
    sessionId: session.id,
    role: "verification",
    sourceTool: "stop_profiling",
    label: "after",
    findings: [finding(4)],
  });
  return session;
}

describe("renderDiagnosticReport", () => {
  it("renders a markdown report with findings and verification metrics", () => {
    const report = renderDiagnosticReport(sessionWithVerification(), "markdown");

    expect(report.format).toBe("markdown");
    expect(report.comparison?.verdict).toBe("improved");
    expect(report.content).toContain("# Flutter Diagnostic Report: jank");
    expect(report.content).toContain("## Runtime Baseline");
    expect(report.content).toContain("Significant frame jank detected");
    expect(report.content).toContain("| jankPercentage | 20 percent | 4 percent");
    expect(report.content).toContain("Profile the interaction and reduce frame work.");
  });

  it("renders an html report", () => {
    const report = renderDiagnosticReport(sessionWithVerification(), "html");

    expect(report.format).toBe("html");
    expect(report.content).toContain("<!doctype html>");
    expect(report.content).toContain("<h1>Flutter Diagnostic Report: jank</h1>");
    expect(report.content).toContain("<code>diag_1</code>");
  });

  it("handles sessions without before/after comparison", () => {
    const store = new DiagnosticSessionStore();
    const session = store.start({ problemType: "layout" });

    const report = renderDiagnosticReport(session, "markdown");

    expect(report.comparison).toBeUndefined();
    expect(report.content).toContain("No before/after comparison is available");
  });
});
