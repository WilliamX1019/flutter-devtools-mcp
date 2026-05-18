import { FlutterVmServiceClient, TimelineEvent } from "./vm-service-client.js";
import { DiagnosticSeverity } from "../types/diagnostics.js";
import { isFrameEvent } from "./profiling-analysis.js";

export type RuntimeAlertType = "disconnect" | "exception" | "gc" | "jank";

export interface RuntimeMonitorThresholds {
  jankFrameThresholdMs: number;
  consecutiveJankFrames: number;
  gcHeapUsageThresholdBytes?: number;
  maxAlerts: number;
}

export interface RuntimeAlert {
  id: string;
  timestamp: number;
  type: RuntimeAlertType;
  severity: DiagnosticSeverity;
  message: string;
  data?: unknown;
}

export interface RuntimeMonitorStatus {
  active: boolean;
  startedAt?: number;
  thresholds: RuntimeMonitorThresholds;
  alertCount: number;
  recentAlerts: RuntimeAlert[];
  trend: {
    jankAlerts: number;
    gcAlerts: number;
    exceptionAlerts: number;
    disconnectAlerts: number;
  };
}

export type RuntimeAlertNotifier = (alert: RuntimeAlert) => void | Promise<void>;

const DEFAULT_THRESHOLDS: RuntimeMonitorThresholds = {
  jankFrameThresholdMs: 50,
  consecutiveJankFrames: 3,
  maxAlerts: 50,
};

export class RuntimeMonitor {
  private active = false;
  private startedAt?: number;
  private alertSequence = 0;
  private consecutiveJankCount = 0;
  private alerts: RuntimeAlert[] = [];
  private thresholds: RuntimeMonitorThresholds = { ...DEFAULT_THRESHOLDS };

  constructor(
    private readonly client: FlutterVmServiceClient,
    private readonly notify?: RuntimeAlertNotifier
  ) {}

  start(thresholds: Partial<RuntimeMonitorThresholds> = {}): RuntimeMonitorStatus {
    if (this.active) {
      throw new Error("Runtime monitoring is already active.");
    }

    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...thresholds,
      maxAlerts: thresholds.maxAlerts ?? DEFAULT_THRESHOLDS.maxAlerts,
    };
    this.alerts = [];
    this.alertSequence = 0;
    this.consecutiveJankCount = 0;
    this.startedAt = Date.now();
    this.active = true;
    this.attachListeners();

    return this.status();
  }

  stop(): RuntimeMonitorStatus {
    if (!this.active) {
      throw new Error("Runtime monitoring is not active.");
    }

    this.detachListeners();
    this.active = false;
    return this.status();
  }

  status(): RuntimeMonitorStatus {
    return {
      active: this.active,
      startedAt: this.startedAt,
      thresholds: this.thresholds,
      alertCount: this.alerts.length,
      recentAlerts: [...this.alerts],
      trend: {
        jankAlerts: this.countAlerts("jank"),
        gcAlerts: this.countAlerts("gc"),
        exceptionAlerts: this.countAlerts("exception"),
        disconnectAlerts: this.countAlerts("disconnect"),
      },
    };
  }

  private attachListeners(): void {
    this.client.on("disconnected", this.onDisconnected);
    this.client.on("stream:Debug", this.onDebugEvent);
    this.client.on("stream:GC", this.onGcEvent);
    this.client.on("stream:Timeline", this.onTimelineEvent);
  }

  private detachListeners(): void {
    this.client.off("disconnected", this.onDisconnected);
    this.client.off("stream:Debug", this.onDebugEvent);
    this.client.off("stream:GC", this.onGcEvent);
    this.client.off("stream:Timeline", this.onTimelineEvent);
  }

  private onDisconnected = () => {
    this.recordAlert({
      type: "disconnect",
      severity: "critical",
      message: "Flutter VM Service disconnected during monitoring.",
    });
  };

  private onDebugEvent = (event: unknown) => {
    if (!isExceptionEvent(event)) return;

    this.recordAlert({
      type: "exception",
      severity: "critical",
      message: "Debug stream reported an exception or isolate pause.",
      data: event,
    });
  };

  private onGcEvent = (event: unknown) => {
    const heapUsage = extractHeapUsage(event);
    if (
      this.thresholds.gcHeapUsageThresholdBytes !== undefined &&
      (heapUsage === undefined || heapUsage < this.thresholds.gcHeapUsageThresholdBytes)
    ) {
      return;
    }

    this.recordAlert({
      type: "gc",
      severity:
        heapUsage !== undefined &&
        this.thresholds.gcHeapUsageThresholdBytes !== undefined &&
        heapUsage >= this.thresholds.gcHeapUsageThresholdBytes
          ? "high"
          : "info",
      message:
        heapUsage === undefined
          ? "GC event observed during monitoring."
          : `GC event observed with heap usage ${heapUsage.toLocaleString()} bytes.`,
      data: event,
    });
  };

  private onTimelineEvent = (event: unknown) => {
    const frameDurations = extractFrameDurations(event);
    for (const durationMs of frameDurations) {
      if (durationMs > this.thresholds.jankFrameThresholdMs) {
        this.consecutiveJankCount++;
      } else {
        this.consecutiveJankCount = 0;
      }

      if (this.consecutiveJankCount >= this.thresholds.consecutiveJankFrames) {
        this.recordAlert({
          type: "jank",
          severity:
            durationMs > this.thresholds.jankFrameThresholdMs * 2 ? "critical" : "high",
          message: `${this.consecutiveJankCount} consecutive janky frame(s) observed; latest frame ${durationMs.toFixed(2)}ms.`,
          data: { durationMs, thresholdMs: this.thresholds.jankFrameThresholdMs },
        });
        this.consecutiveJankCount = 0;
      }
    }
  };

  private recordAlert(input: Omit<RuntimeAlert, "id" | "timestamp">): void {
    if (!this.active) return;

    const alert: RuntimeAlert = {
      id: `alert_${++this.alertSequence}`,
      timestamp: Date.now(),
      ...input,
    };
    this.alerts.push(alert);
    this.alerts = this.alerts.slice(-this.thresholds.maxAlerts);
    void this.notify?.(alert);
  }

  private countAlerts(type: RuntimeAlertType): number {
    return this.alerts.filter((alert) => alert.type === type).length;
  }
}

function isExceptionEvent(event: unknown): boolean {
  if (!isRecord(event)) return false;
  const kind = String(event.kind ?? event.type ?? "");
  return (
    kind.includes("PauseException") ||
    kind.includes("Exception") ||
    kind.includes("PauseExit") ||
    "exception" in event
  );
}

function extractHeapUsage(event: unknown): number | undefined {
  if (!isRecord(event)) return undefined;
  const candidates = [
    event.heapUsage,
    event.used,
    valueAtPath(event, ["new", "used"]),
    valueAtPath(event, ["old", "used"]),
    valueAtPath(event, ["isolateGroup", "heapUsage"]),
  ];

  const numbers = candidates.filter(
    (value): value is number => typeof value === "number"
  );
  if (numbers.length === 0) return undefined;
  return numbers.reduce((sum, value) => sum + value, 0);
}

function extractFrameDurations(event: unknown): number[] {
  const events = extractTimelineEvents(event);
  return events
    .filter(
      (item) => item.ph === "X" && item.dur !== undefined && isFrameEvent(item.name)
    )
    .map((item) => item.dur! / 1000)
    .filter((duration) => duration > 0);
}

function extractTimelineEvents(event: unknown): TimelineEvent[] {
  if (!isRecord(event)) return [];
  const timelineEvents = event.timelineEvents ?? event.traceEvents;
  if (!Array.isArray(timelineEvents)) {
    return isTimelineEvent(event) ? [event] : [];
  }
  return timelineEvents.filter(isTimelineEvent);
}

function isTimelineEvent(value: unknown): value is TimelineEvent {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.ph === "string" &&
    typeof value.ts === "number" &&
    typeof value.pid === "number" &&
    typeof value.tid === "number"
  );
}

function valueAtPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
