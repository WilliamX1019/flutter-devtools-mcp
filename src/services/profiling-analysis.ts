import { TimelineEvent } from "./vm-service-client.js";

export interface FrameAnalysis {
  totalFrames: number;
  jankFrames: number;
  jankPercentage: number;
  averageFrameTimeMs: number;
  maxFrameTimeMs: number;
  p90FrameTimeMs: number;
  p99FrameTimeMs: number;
  targetFrameTimeMs: number;
}

export interface CpuHotspot {
  name: string;
  category: string;
  totalDurationMs: number;
  callCount: number;
  avgDurationMs: number;
  maxDurationMs: number;
  severity: "low" | "medium" | "high" | "critical";
}

export interface PhaseAnalysis {
  totalTimeMs: number;
  avgTimeMs: number;
  maxTimeMs: number;
  count: number;
}

export interface ProfilingResult {
  durationMs: number;
  totalEventsCollected: number;
  frameAnalysis: FrameAnalysis;
  cpuHotspots: CpuHotspot[];
  buildPhaseAnalysis: {
    totalBuildTimeMs: number;
    avgBuildTimeMs: number;
    maxBuildTimeMs: number;
    buildCount: number;
  };
  layoutPhaseAnalysis: {
    totalLayoutTimeMs: number;
    avgLayoutTimeMs: number;
    maxLayoutTimeMs: number;
    layoutCount: number;
  };
  paintPhaseAnalysis: {
    totalPaintTimeMs: number;
    avgPaintTimeMs: number;
    maxPaintTimeMs: number;
    paintCount: number;
  };
  summary: string[];
  recommendations: string[];
}

type PhaseName = "Build" | "Layout" | "Paint";

const MAX_FRAME_DURATION_MS = 1000;
const MAX_PHASE_DURATION_MS = 5000;

const PHASE_PATTERNS: Record<PhaseName, string[]> = {
  Build: [
    "build",
    "widget",
    "createElement",
    "updateChild",
    "inflateWidget",
    "performRebuild",
    "buildScope",
    "drawFrame",
    "handleBuildScheduled",
  ],
  Layout: [
    "layout",
    "performLayout",
    "flushLayout",
    "RenderFlex",
    "RenderBox",
    "RenderSliver",
    "performResize",
    "markNeedsLayout",
  ],
  Paint: [
    "paint",
    "flushPaint",
    "compositeFrame",
    "rasterizer",
    "compositeLayers",
    "flushCompositingBits",
    "markNeedsPaint",
    "repaintCompositedChild",
  ],
};

export function analyzeTimeline(
  events: TimelineEvent[],
  durationMs: number,
  targetFrameTimeMs: number
): ProfilingResult {
  const realEvents = events.filter(
    (e) => e.ph !== "M" && e.ph !== "s" && e.ph !== "t" && e.ph !== "f"
  );

  const frameAnalysis = analyzeFrames(realEvents, targetFrameTimeMs);
  const cpuHotspots = findCpuHotspots(realEvents);
  const buildPhase = analyzePhase(realEvents, "Build");
  const layoutPhase = analyzePhase(realEvents, "Layout");
  const paintPhase = analyzePhase(realEvents, "Paint");

  const buildPhaseAnalysis = {
    totalBuildTimeMs: buildPhase.totalTimeMs,
    avgBuildTimeMs: buildPhase.avgTimeMs,
    maxBuildTimeMs: buildPhase.maxTimeMs,
    buildCount: buildPhase.count,
  };
  const layoutPhaseAnalysis = {
    totalLayoutTimeMs: layoutPhase.totalTimeMs,
    avgLayoutTimeMs: layoutPhase.avgTimeMs,
    maxLayoutTimeMs: layoutPhase.maxTimeMs,
    layoutCount: layoutPhase.count,
  };
  const paintPhaseAnalysis = {
    totalPaintTimeMs: paintPhase.totalTimeMs,
    avgPaintTimeMs: paintPhase.avgTimeMs,
    maxPaintTimeMs: paintPhase.maxTimeMs,
    paintCount: paintPhase.count,
  };

  const summary = generateSummary(
    frameAnalysis,
    cpuHotspots,
    durationMs,
    events.length,
    realEvents.length
  );
  const recommendations = generateRecommendations(
    frameAnalysis,
    cpuHotspots,
    buildPhaseAnalysis,
    layoutPhaseAnalysis,
    paintPhaseAnalysis,
    realEvents.length
  );

  return {
    durationMs,
    totalEventsCollected: events.length,
    frameAnalysis,
    cpuHotspots,
    buildPhaseAnalysis,
    layoutPhaseAnalysis,
    paintPhaseAnalysis,
    summary,
    recommendations,
  };
}

export function isFrameEvent(name: string): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return (
    n === "frame" ||
    n === "vsync" ||
    n.includes("animator") ||
    n.includes("beginframe") ||
    n.includes("onanimatorbeginframe") ||
    n.includes("shell::onanimatorbeginframe") ||
    n === "gpurasterizer::draw" ||
    n === "rasterizer::dodraw" ||
    n.includes("pipeline produce") ||
    n.includes("pipeline consume")
  );
}

export function analyzeFrames(
  events: TimelineEvent[],
  targetFrameTimeMs: number
): FrameAnalysis {
  const frameDurations = collectDurations(
    events,
    (event) => isFrameEvent(event.name),
    MAX_FRAME_DURATION_MS
  );

  if (frameDurations.length === 0) {
    return {
      totalFrames: 0,
      jankFrames: 0,
      jankPercentage: 0,
      averageFrameTimeMs: 0,
      maxFrameTimeMs: 0,
      p90FrameTimeMs: 0,
      p99FrameTimeMs: 0,
      targetFrameTimeMs,
    };
  }

  frameDurations.sort((a, b) => a - b);

  const jankFrames = frameDurations.filter((d) => d > targetFrameTimeMs).length;

  return {
    totalFrames: frameDurations.length,
    jankFrames,
    jankPercentage: (jankFrames / frameDurations.length) * 100,
    averageFrameTimeMs:
      frameDurations.reduce((a, b) => a + b, 0) / frameDurations.length,
    maxFrameTimeMs: frameDurations[frameDurations.length - 1],
    p90FrameTimeMs: frameDurations[Math.floor(frameDurations.length * 0.9)] ?? 0,
    p99FrameTimeMs: frameDurations[Math.floor(frameDurations.length * 0.99)] ?? 0,
    targetFrameTimeMs,
  };
}

export function findCpuHotspots(events: TimelineEvent[]): CpuHotspot[] {
  const eventMap = new Map<string, { durations: number[]; category: string }>();

  for (const event of events) {
    if (event.ph === "X" && event.dur !== undefined && event.dur > 0) {
      const key = event.name;
      if (!eventMap.has(key)) {
        eventMap.set(key, { durations: [], category: event.cat ?? "unknown" });
      }
      eventMap.get(key)!.durations.push(event.dur / 1000);
    }
  }

  const hotspots: CpuHotspot[] = [];

  for (const [name, data] of eventMap) {
    const totalDurationMs = data.durations.reduce((a, b) => a + b, 0);
    const maxDurationMs = Math.max(...data.durations);
    const avgDurationMs = totalDurationMs / data.durations.length;

    let severity: CpuHotspot["severity"] = "low";
    if (maxDurationMs > 100) severity = "critical";
    else if (maxDurationMs > 32) severity = "high";
    else if (maxDurationMs > 16) severity = "medium";

    hotspots.push({
      name,
      category: data.category,
      totalDurationMs: Math.round(totalDurationMs * 100) / 100,
      callCount: data.durations.length,
      avgDurationMs: Math.round(avgDurationMs * 100) / 100,
      maxDurationMs: Math.round(maxDurationMs * 100) / 100,
      severity,
    });
  }

  return hotspots.sort((a, b) => b.totalDurationMs - a.totalDurationMs).slice(0, 20);
}

export function matchesPhase(eventName: string, phaseName: PhaseName): boolean {
  const lower = eventName.toLowerCase();
  return PHASE_PATTERNS[phaseName].some((p) => lower.includes(p));
}

export function analyzePhase(
  events: TimelineEvent[],
  phaseName: PhaseName
): PhaseAnalysis {
  const durations = collectDurations(
    events,
    (event) => matchesPhase(event.name, phaseName),
    MAX_PHASE_DURATION_MS
  );
  const total = durations.reduce((a, b) => a + b, 0);
  const max = durations.length > 0 ? Math.max(...durations) : 0;
  const avg = durations.length > 0 ? total / durations.length : 0;

  return {
    totalTimeMs: Math.round(total * 100) / 100,
    avgTimeMs: Math.round(avg * 100) / 100,
    maxTimeMs: Math.round(max * 100) / 100,
    count: durations.length,
  };
}

function collectDurations(
  events: TimelineEvent[],
  matches: (event: TimelineEvent) => boolean,
  maxDurationMs: number
): number[] {
  const durations: number[] = [];
  const beginStacks = new Map<string, TimelineEvent[]>();

  const sortedEvents = [...events].sort((a, b) => a.ts - b.ts);

  for (const event of sortedEvents) {
    if (!matches(event)) continue;

    if (event.ph === "X" && event.dur !== undefined) {
      const durationMs = event.dur / 1000;
      if (isValidDuration(durationMs, maxDurationMs)) {
        durations.push(durationMs);
      }
      continue;
    }

    if (event.ph === "B") {
      const key = pairKey(event);
      const stack = beginStacks.get(key) ?? [];
      stack.push(event);
      beginStacks.set(key, stack);
      continue;
    }

    if (event.ph === "E") {
      const stack = beginStacks.get(pairKey(event));
      const begin = stack?.pop();
      if (!begin) continue;

      const durationMs = (event.ts - begin.ts) / 1000;
      if (isValidDuration(durationMs, maxDurationMs)) {
        durations.push(durationMs);
      }
    }
  }

  return durations;
}

function pairKey(event: TimelineEvent): string {
  return `${event.tid}:${event.name}`;
}

function isValidDuration(durationMs: number, maxDurationMs: number): boolean {
  return durationMs > 0 && durationMs < maxDurationMs;
}

function generateSummary(
  frames: FrameAnalysis,
  hotspots: CpuHotspot[],
  durationMs: number,
  totalEvents: number = 0,
  realEvents: number = 0
): string[] {
  const summary: string[] = [];

  summary.push(
    `Profiled for ${(durationMs / 1000).toFixed(1)}s, captured ${frames.totalFrames} frames (${totalEvents} raw events, ${realEvents} meaningful)`
  );

  if (frames.totalFrames > 0) {
    summary.push(
      `Average frame time: ${frames.averageFrameTimeMs.toFixed(2)}ms (target: ${frames.targetFrameTimeMs.toFixed(1)}ms)`
    );

    if (frames.jankFrames > 0) {
      summary.push(
        `⚠️ ${frames.jankFrames} janky frames detected (${frames.jankPercentage.toFixed(1)}% of total)`
      );
      summary.push(
        `Worst frame: ${frames.maxFrameTimeMs.toFixed(2)}ms (${(frames.maxFrameTimeMs / frames.targetFrameTimeMs).toFixed(1)}x target)`
      );
    } else {
      summary.push("✅ No jank detected - all frames within budget");
    }
  }

  const criticalHotspots = hotspots.filter(
    (h) => h.severity === "critical" || h.severity === "high"
  );
  if (criticalHotspots.length > 0) {
    summary.push(`🔥 ${criticalHotspots.length} CPU hotspot(s) found:`);
    for (const h of criticalHotspots.slice(0, 5)) {
      summary.push(
        `  - ${h.name}: ${h.maxDurationMs.toFixed(1)}ms max, ${h.callCount} calls [${h.severity.toUpperCase()}]`
      );
    }
  }

  return summary;
}

function generateRecommendations(
  frames: FrameAnalysis,
  hotspots: CpuHotspot[],
  buildPhase: { buildCount: number; maxBuildTimeMs: number },
  layoutPhase: { layoutCount: number; maxLayoutTimeMs: number },
  paintPhase: { paintCount: number; maxPaintTimeMs: number },
  realEventCount: number = 0
): string[] {
  const recs: string[] = [];

  if (realEventCount === 0) {
    recs.push(
      "INFO: No meaningful timeline events were captured. Make sure you interact with the app (scroll, tap, navigate) while profiling. For best results, run the app with `flutter run --profile`."
    );
    return recs;
  }

  if (frames.totalFrames === 0 && realEventCount > 0) {
    recs.push(
      "INFO: Timeline events were captured but no frames were detected. The app may have been idle during profiling. Try interacting more actively (scrolling a list works best)."
    );
  }

  if (frames.jankPercentage > 10) {
    recs.push(
      "HIGH: Significant jank detected. Profile in release/profile mode to get accurate numbers."
    );
  }

  if (buildPhase.maxBuildTimeMs > 16) {
    recs.push(
      "HIGH: Build phase exceeds frame budget. Consider using const constructors, breaking up large widget trees, or using RepaintBoundary."
    );
  }

  if (buildPhase.buildCount > frames.totalFrames * 3) {
    recs.push(
      "MEDIUM: Excessive widget rebuilds detected. Check for unnecessary setState calls, missing const widgets, or improper use of context.watch()."
    );
  }

  if (layoutPhase.maxLayoutTimeMs > 16) {
    recs.push(
      "HIGH: Layout phase is slow. Look for expensive layout operations like intrinsic dimensions or deeply nested flex widgets."
    );
  }

  if (paintPhase.maxPaintTimeMs > 16) {
    recs.push(
      "HIGH: Paint phase is slow. Consider using RepaintBoundary to isolate repainting, or check for expensive custom painters."
    );
  }

  const criticalHotspots = hotspots.filter((h) => h.severity === "critical");
  for (const h of criticalHotspots.slice(0, 3)) {
    recs.push(
      `CRITICAL: "${h.name}" taking ${h.maxDurationMs.toFixed(1)}ms. This single operation exceeds the entire frame budget.`
    );
  }

  if (recs.length === 0) {
    recs.push("Performance looks good! No major issues detected in this session.");
  }

  return recs;
}
