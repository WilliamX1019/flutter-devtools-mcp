import { describe, expect, it } from "vitest";
import {
  analyzeFrames,
  analyzePhase,
  analyzeTimeline,
  findCpuHotspots,
} from "../../src/services/profiling-analysis.js";
import { TimelineEvent } from "../../src/services/vm-service-client.js";

const event = (partial: Partial<TimelineEvent>): TimelineEvent => ({
  name: partial.name ?? "event",
  cat: partial.cat ?? "Dart",
  ph: partial.ph ?? "X",
  ts: partial.ts ?? 0,
  dur: partial.dur,
  pid: partial.pid ?? 1,
  tid: partial.tid ?? 1,
  args: partial.args,
});

describe("analyzeFrames", () => {
  it("uses complete duration frame events and detects jank", () => {
    const result = analyzeFrames(
      [
        event({ name: "Frame", dur: 8000 }),
        event({ name: "Frame", dur: 20000 }),
        event({ name: "Frame", dur: 40000 }),
      ],
      16.67
    );

    expect(result.totalFrames).toBe(3);
    expect(result.jankFrames).toBe(2);
    expect(result.averageFrameTimeMs).toBeCloseTo(22.67, 2);
    expect(result.maxFrameTimeMs).toBe(40);
  });

  it("pairs begin and end frame events when duration events are unavailable", () => {
    const result = analyzeFrames(
      [
        event({ name: "Frame", ph: "B", ts: 1000 }),
        event({ name: "Frame", ph: "E", ts: 19000 }),
      ],
      16.67
    );

    expect(result.totalFrames).toBe(1);
    expect(result.maxFrameTimeMs).toBe(18);
    expect(result.jankFrames).toBe(1);
  });
});

describe("findCpuHotspots", () => {
  it("aggregates repeated complete events and assigns severity", () => {
    const hotspots = findCpuHotspots([
      event({ name: "expensiveWork", cat: "Dart", dur: 120000 }),
      event({ name: "expensiveWork", cat: "Dart", dur: 20000 }),
      event({ name: "smallWork", cat: "Dart", dur: 1000 }),
    ]);

    expect(hotspots[0]).toMatchObject({
      name: "expensiveWork",
      totalDurationMs: 140,
      callCount: 2,
      maxDurationMs: 120,
      severity: "critical",
    });
  });
});

describe("analyzePhase", () => {
  it("summarizes matching build phase events", () => {
    const result = analyzePhase(
      [
        event({ name: "buildScope", dur: 12000 }),
        event({ name: "performLayout", dur: 9000 }),
      ],
      "Build"
    );

    expect(result).toEqual({
      totalTimeMs: 12,
      avgTimeMs: 12,
      maxTimeMs: 12,
      count: 1,
    });
  });
});

describe("analyzeTimeline", () => {
  it("filters metadata events and returns actionable recommendations", () => {
    const result = analyzeTimeline(
      [
        event({ name: "metadata", ph: "M" }),
        event({ name: "Frame", dur: 40000 }),
        event({ name: "buildScope", dur: 20000 }),
      ],
      1000,
      16.67
    );

    expect(result.totalEventsCollected).toBe(3);
    expect(result.frameAnalysis.jankFrames).toBe(1);
    expect(result.buildPhaseAnalysis.maxBuildTimeMs).toBe(20);
    expect(result.recommendations).toContain(
      "HIGH: Build phase exceeds frame budget. Consider using const constructors, breaking up large widget trees, or using RepaintBoundary."
    );
  });
});
