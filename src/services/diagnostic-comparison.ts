import {
  DiagnosticFinding,
  DiagnosticMetricComparison,
  DiagnosticObservation,
  DiagnosticRunComparison,
  DiagnosticSession,
  DiagnosticVerdict,
} from "../types/diagnostics.js";

export interface CompareDiagnosticRunsInput {
  beforeObservationId?: string;
  afterObservationId?: string;
}

const LOWER_IS_BETTER_METRICS = new Set([
  "jankPercentage",
  "maxBuildTimeMs",
  "maxDurationMs",
  "rebuildCount",
  "heapUtilization",
  "heapUsage",
  "heapDelta",
  "durationMs",
  "responseSize",
]);

export function compareDiagnosticRuns(
  session: DiagnosticSession,
  input: CompareDiagnosticRunsInput = {}
): DiagnosticRunComparison {
  const before = selectBeforeObservation(session, input.beforeObservationId);
  const after = selectAfterObservation(session, input.afterObservationId);

  if (!before) {
    throw new Error(
      "No before observation found. Record a baseline or pass beforeObservationId."
    );
  }
  if (!after) {
    throw new Error(
      "No after observation found. Record a verification run or pass afterObservationId."
    );
  }
  if (before.id === after.id) {
    throw new Error("Before and after observations must be different.");
  }

  const metricComparisons = compareMetrics(before, after);
  const resolvedFindingIds = diffFindingIds(
    before.findings,
    after.findings,
    "resolved"
  );
  const newFindingIds = diffFindingIds(before.findings, after.findings, "new");
  const unchangedFindingIds = diffFindingIds(
    before.findings,
    after.findings,
    "unchanged"
  );
  const verdict = determineOverallVerdict(
    metricComparisons,
    resolvedFindingIds.length,
    newFindingIds.length,
    before.findings.length,
    after.findings.length
  );

  return {
    sessionId: session.id,
    beforeObservationId: before.id,
    afterObservationId: after.id,
    verdict,
    summary: buildSummary({
      verdict,
      metricComparisons,
      resolvedFindingIds,
      newFindingIds,
      beforeFindingCount: before.findings.length,
      afterFindingCount: after.findings.length,
    }),
    metricComparisons,
    beforeFindingCount: before.findings.length,
    afterFindingCount: after.findings.length,
    resolvedFindingIds,
    newFindingIds,
    unchangedFindingIds,
  };
}

function selectBeforeObservation(
  session: DiagnosticSession,
  observationId?: string
): DiagnosticObservation | undefined {
  if (observationId) return findObservation(session, observationId);
  return session.baseline ?? session.observations[0];
}

function selectAfterObservation(
  session: DiagnosticSession,
  observationId?: string
): DiagnosticObservation | undefined {
  if (observationId) return findObservation(session, observationId);
  return (
    session.verificationRuns[session.verificationRuns.length - 1] ??
    findLastNonBaselineObservation(session)
  );
}

function findObservation(
  session: DiagnosticSession,
  observationId: string
): DiagnosticObservation | undefined {
  return session.observations.find((item) => item.id === observationId);
}

function findLastNonBaselineObservation(
  session: DiagnosticSession
): DiagnosticObservation | undefined {
  for (let index = session.observations.length - 1; index >= 0; index--) {
    const observation = session.observations[index];
    if (observation.id !== session.baseline?.id) return observation;
  }
  return undefined;
}

function compareMetrics(
  before: DiagnosticObservation,
  after: DiagnosticObservation
): DiagnosticMetricComparison[] {
  const beforeMetrics = metricsByKey(before.findings);
  const afterMetrics = metricsByKey(after.findings);
  const comparisons: DiagnosticMetricComparison[] = [];

  for (const [key, beforeFinding] of beforeMetrics) {
    const afterFinding = afterMetrics.get(key);
    if (!beforeFinding.metric || !afterFinding?.metric) continue;

    const delta = afterFinding.metric.value - beforeFinding.metric.value;
    const deltaPercent =
      beforeFinding.metric.value === 0
        ? null
        : (delta / Math.abs(beforeFinding.metric.value)) * 100;

    comparisons.push({
      key,
      name: beforeFinding.metric.name,
      category: beforeFinding.category,
      before: beforeFinding.metric,
      after: afterFinding.metric,
      delta,
      deltaPercent,
      verdict: metricVerdict(beforeFinding.metric.name, delta),
      location: beforeFinding.location ?? afterFinding.location,
      title: beforeFinding.title,
    });
  }

  return comparisons.sort((a, b) => severityRank(b.verdict) - severityRank(a.verdict));
}

function metricsByKey(findings: DiagnosticFinding[]): Map<string, DiagnosticFinding> {
  const result = new Map<string, DiagnosticFinding>();

  for (const finding of findings) {
    if (!finding.metric) continue;
    result.set(metricKey(finding), finding);
  }

  return result;
}

function metricKey(finding: DiagnosticFinding): string {
  const location = finding.location
    ? `${finding.location.file ?? ""}:${finding.location.line ?? ""}:${finding.location.symbol ?? ""}`
    : "";
  return [finding.category, finding.metric?.name ?? "", finding.id, location].join("|");
}

function metricVerdict(name: string, delta: number): DiagnosticVerdict {
  if (Math.abs(delta) < 0.0001) return "unchanged";

  const lowerIsBetter = LOWER_IS_BETTER_METRICS.has(name);
  if (!lowerIsBetter) return "inconclusive";

  return delta < 0 ? "improved" : "regressed";
}

function diffFindingIds(
  beforeFindings: DiagnosticFinding[],
  afterFindings: DiagnosticFinding[],
  mode: "resolved" | "new" | "unchanged"
): string[] {
  const beforeIds = new Set(beforeFindings.map((finding) => finding.id));
  const afterIds = new Set(afterFindings.map((finding) => finding.id));

  if (mode === "resolved") {
    return [...beforeIds].filter((id) => !afterIds.has(id)).sort();
  }
  if (mode === "new") {
    return [...afterIds].filter((id) => !beforeIds.has(id)).sort();
  }
  return [...beforeIds].filter((id) => afterIds.has(id)).sort();
}

function determineOverallVerdict(
  metricComparisons: DiagnosticMetricComparison[],
  resolvedCount: number,
  newCount: number,
  beforeFindingCount: number,
  afterFindingCount: number
): DiagnosticVerdict {
  const regressedMetrics = metricComparisons.filter(
    (comparison) => comparison.verdict === "regressed"
  ).length;
  const improvedMetrics = metricComparisons.filter(
    (comparison) => comparison.verdict === "improved"
  ).length;

  if (regressedMetrics > 0 || newCount > 0) return "regressed";
  if (
    improvedMetrics > 0 ||
    resolvedCount > 0 ||
    afterFindingCount < beforeFindingCount
  ) {
    return "improved";
  }
  if (
    metricComparisons.length > 0 &&
    metricComparisons.every((comparison) => comparison.verdict === "unchanged")
  ) {
    return "unchanged";
  }
  return "inconclusive";
}

function buildSummary(args: {
  verdict: DiagnosticVerdict;
  metricComparisons: DiagnosticMetricComparison[];
  resolvedFindingIds: string[];
  newFindingIds: string[];
  beforeFindingCount: number;
  afterFindingCount: number;
}): string {
  const parts = [
    `Verdict: ${args.verdict}.`,
    `Findings: ${args.beforeFindingCount} before, ${args.afterFindingCount} after.`,
  ];

  if (args.metricComparisons.length > 0) {
    const improved = args.metricComparisons.filter(
      (comparison) => comparison.verdict === "improved"
    ).length;
    const regressed = args.metricComparisons.filter(
      (comparison) => comparison.verdict === "regressed"
    ).length;
    const unchanged = args.metricComparisons.filter(
      (comparison) => comparison.verdict === "unchanged"
    ).length;
    parts.push(
      `Metrics: ${improved} improved, ${regressed} regressed, ${unchanged} unchanged.`
    );
  } else {
    parts.push("Metrics: no comparable metric pairs found.");
  }

  if (args.resolvedFindingIds.length > 0) {
    parts.push(`Resolved findings: ${args.resolvedFindingIds.length}.`);
  }
  if (args.newFindingIds.length > 0) {
    parts.push(`New findings: ${args.newFindingIds.length}.`);
  }

  return parts.join(" ");
}

function severityRank(verdict: DiagnosticVerdict): number {
  switch (verdict) {
    case "regressed":
      return 4;
    case "improved":
      return 3;
    case "unchanged":
      return 2;
    default:
      return 1;
  }
}
