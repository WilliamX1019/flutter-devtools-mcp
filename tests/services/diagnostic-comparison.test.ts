import { describe, expect, it } from "vitest";
import { compareDiagnosticRuns } from "../../src/services/diagnostic-comparison.js";
import { DiagnosticSessionStore } from "../../src/services/diagnostic-session.js";
import { DiagnosticFinding } from "../../src/types/diagnostics.js";

function finding(id: string, metricName: string, value: number): DiagnosticFinding {
  return {
    id,
    severity: value > 10 ? "high" : "low",
    category: "performance",
    title: id,
    evidence: `${metricName}=${value}`,
    metric: {
      name: metricName,
      value,
      unit: "percent",
      threshold: 10,
    },
  };
}

describe("compareDiagnosticRuns", () => {
  it("compares baseline against the latest verification run by default", () => {
    const store = new DiagnosticSessionStore();
    const session = store.start({ problemType: "jank" });

    const baseline = store.record({
      sessionId: session.id,
      role: "baseline",
      sourceTool: "stop_profiling",
      findings: [finding("performance.jank-rate", "jankPercentage", 18)],
    });
    const verification = store.record({
      sessionId: session.id,
      role: "verification",
      sourceTool: "stop_profiling",
      findings: [finding("performance.jank-rate", "jankPercentage", 4)],
    });

    const comparison = compareDiagnosticRuns(session);

    expect(comparison.beforeObservationId).toBe(baseline.id);
    expect(comparison.afterObservationId).toBe(verification.id);
    expect(comparison.verdict).toBe("improved");
    expect(comparison.metricComparisons).toMatchObject([
      {
        name: "jankPercentage",
        delta: -14,
        verdict: "improved",
      },
    ]);
  });

  it("marks new findings as a regression", () => {
    const store = new DiagnosticSessionStore();
    const session = store.start({ problemType: "rebuild" });

    store.record({
      sessionId: session.id,
      role: "baseline",
      sourceTool: "stop_tracking_rebuilds",
      findings: [],
    });
    store.record({
      sessionId: session.id,
      role: "verification",
      sourceTool: "stop_tracking_rebuilds",
      findings: [finding("rebuild.feed-row", "rebuildCount", 120)],
    });

    const comparison = compareDiagnosticRuns(session);

    expect(comparison.verdict).toBe("regressed");
    expect(comparison.newFindingIds).toEqual(["rebuild.feed-row"]);
  });

  it("supports explicit before and after observation IDs", () => {
    const store = new DiagnosticSessionStore();
    const session = store.start({ problemType: "memory-leak" });

    const before = store.record({
      sessionId: session.id,
      sourceTool: "runtime_health_check",
      findings: [finding("memory.high-heap-utilization", "heapUtilization", 80)],
    });
    const after = store.record({
      sessionId: session.id,
      sourceTool: "runtime_health_check",
      findings: [finding("memory.high-heap-utilization", "heapUtilization", 80)],
    });

    const comparison = compareDiagnosticRuns(session, {
      beforeObservationId: before.id,
      afterObservationId: after.id,
    });

    expect(comparison.verdict).toBe("unchanged");
    expect(comparison.metricComparisons[0].verdict).toBe("unchanged");
  });

  it("requires different before and after observations", () => {
    const store = new DiagnosticSessionStore();
    const session = store.start({ problemType: "layout" });

    const observation = store.record({
      sessionId: session.id,
      sourceTool: "runtime_health_check",
      findings: [],
    });

    expect(() =>
      compareDiagnosticRuns(session, {
        beforeObservationId: observation.id,
        afterObservationId: observation.id,
      })
    ).toThrow("Before and after observations must be different");
  });
});
