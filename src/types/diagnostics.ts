export type DiagnosticSeverity = "info" | "low" | "medium" | "high" | "critical";

export type DiagnosticCategory =
  | "runtime"
  | "widget"
  | "rebuild"
  | "performance"
  | "memory"
  | "network";

export type DiagnosticVerdict = "improved" | "regressed" | "unchanged" | "inconclusive";

export interface DiagnosticMetric {
  name: string;
  value: number;
  unit: string;
  threshold?: number;
}

export interface DiagnosticLocation {
  file?: string;
  line?: number;
  column?: number;
  symbol?: string;
}

export interface DiagnosticFinding {
  id: string;
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  title: string;
  evidence: string;
  metric?: DiagnosticMetric;
  location?: DiagnosticLocation;
  recommendation?: string;
  nextTool?: string;
}

export interface DiagnosticObservation {
  id: string;
  sourceTool: string;
  label?: string;
  capturedAt: number;
  text?: string;
  findings: DiagnosticFinding[];
  raw?: unknown;
}

export interface DiagnosticSession {
  id: string;
  problemType: string;
  startedAt: number;
  endedAt?: number;
  status: "active" | "ended";
  baseline?: DiagnosticObservation;
  observations: DiagnosticObservation[];
  verificationRuns: DiagnosticObservation[];
  notes: string[];
}

export interface DiagnosticMetricComparison {
  key: string;
  name: string;
  category: DiagnosticCategory;
  before: DiagnosticMetric;
  after: DiagnosticMetric;
  delta: number;
  deltaPercent: number | null;
  verdict: DiagnosticVerdict;
  location?: DiagnosticLocation;
  title: string;
}

export interface DiagnosticRunComparison {
  sessionId: string;
  beforeObservationId: string;
  afterObservationId: string;
  verdict: DiagnosticVerdict;
  summary: string;
  metricComparisons: DiagnosticMetricComparison[];
  beforeFindingCount: number;
  afterFindingCount: number;
  resolvedFindingIds: string[];
  newFindingIds: string[];
  unchangedFindingIds: string[];
}
