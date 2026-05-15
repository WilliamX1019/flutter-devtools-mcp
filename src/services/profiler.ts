import { FlutterVmServiceClient, TimelineEvent } from "./vm-service-client.js";

/**
 * 性能分析会话记录
 */
export interface ProfilingSession {
  startTime: number;
  endTime?: number;
  targetFps: number;
}

/**
 * 帧率及卡顿分析结果
 */
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

/**
 * CPU 执行热点分析结果
 */
export interface CpuHotspot {
  name: string;
  category: string;
  totalDurationMs: number;
  callCount: number;
  avgDurationMs: number;
  maxDurationMs: number;
  severity: "low" | "medium" | "high" | "critical";
}

/**
 * 综合性能剖析结果
 */
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

/**
 * Flutter 性能分析器
 * 利用 Timeline 数据对应用的帧率、构建阶段、布局、绘制以及 CPU 热点进行深度分析
 */
export class Profiler {
  private session: ProfilingSession | null = null;
  private client: FlutterVmServiceClient;

  constructor(client: FlutterVmServiceClient) {
    this.client = client;
  }

  /**
   * 判断当前是否正在进行性能分析会话
   */
  get isActive(): boolean {
    return this.session !== null && this.session.endTime === undefined;
  }

  /**
   * 启动性能分析会话
   * 开启必要的 Timeline 标志并记录起始时间
   */
  async start(): Promise<void> {
    if (this.isActive) {
      throw new Error("Profiling session already active");
    }

    await this.client.clearTimeline();
    await this.client.setTimelineFlags([
      "Dart",
      "Embedder",
      "GC",
      "Compiler",
    ]);

    const fps = await this.client.getDisplayRefreshRate();

    this.session = {
      startTime: Date.now(),
      targetFps: fps,
    };
  }

  /**
   * 停止当前性能分析会话并生成报告
   * @returns 包含各阶段分析和优化建议的性能剖析结果
   */
  async stop(): Promise<ProfilingResult> {
    if (!this.session || this.session.endTime !== undefined) {
      throw new Error("No active profiling session");
    }

    this.session.endTime = Date.now();
    const durationMs = this.session.endTime - this.session.startTime;

    const timeline = await this.client.getTimeline();
    const events = timeline.traceEvents ?? [];

    await this.client.setTimelineFlags([]);

    const targetFrameTimeMs = 1000 / this.session.targetFps;
    const result = this.analyzeTimeline(events, durationMs, targetFrameTimeMs);

    this.session = null;
    return result;
  }

  /**
   * 核心分析逻辑：处理 Timeline 事件并生成分项统计数据
   * @param events 原始时间线事件列表
   * @param durationMs 分析持续时间
   * @param targetFrameTimeMs 目标单帧耗时阈值
   */
  private analyzeTimeline(
    events: TimelineEvent[],
    durationMs: number,
    targetFrameTimeMs: number
  ): ProfilingResult {
    const realEvents = events.filter(
      (e) => e.ph !== "M" && e.ph !== "s" && e.ph !== "t" && e.ph !== "f"
    );

    const frameAnalysis = this.analyzeFrames(realEvents, targetFrameTimeMs);
    const cpuHotspots = this.findCpuHotspots(realEvents);
    const buildPhaseAnalysis = this.analyzePhase(realEvents, "Build");
    const layoutPhaseAnalysis = this.analyzePhase(realEvents, "Layout");
    const paintPhaseAnalysis = this.analyzePhase(realEvents, "Paint");

    const summary = this.generateSummary(
      frameAnalysis,
      cpuHotspots,
      durationMs,
      events.length,
      realEvents.length
    );
    const recommendations = this.generateRecommendations(
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

  /**
   * 判断给定名称是否属于渲染帧的相关事件
   */
  private isFrameEvent(name: string): boolean {
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

  /**
   * 计算帧率表现及卡顿统计
   */
  private analyzeFrames(
    events: TimelineEvent[],
    targetFrameTimeMs: number
  ): FrameAnalysis {
    const frameDurations: number[] = [];

    const completeDurationEvents = events.filter(
      (e) => e.ph === "X" && e.dur !== undefined && this.isFrameEvent(e.name)
    );

    for (const event of completeDurationEvents) {
      frameDurations.push(event.dur! / 1000);
    }

    const frameBeginEvents = events
      .filter((e) => e.ph === "B" && this.isFrameEvent(e.name))
      .sort((a, b) => a.ts - b.ts);

    const frameEndEvents = events
      .filter((e) => e.ph === "E" && this.isFrameEvent(e.name))
      .sort((a, b) => a.ts - b.ts);

    const minLen = Math.min(frameBeginEvents.length, frameEndEvents.length);
    for (let i = 0; i < minLen; i++) {
      const duration = (frameEndEvents[i].ts - frameBeginEvents[i].ts) / 1000;
      if (duration > 0 && duration < 1000) {
        frameDurations.push(duration);
      }
    }

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

    const jankFrames = frameDurations.filter(
      (d) => d > targetFrameTimeMs
    ).length;

    return {
      totalFrames: frameDurations.length,
      jankFrames,
      jankPercentage: (jankFrames / frameDurations.length) * 100,
      averageFrameTimeMs:
        frameDurations.reduce((a, b) => a + b, 0) / frameDurations.length,
      maxFrameTimeMs: frameDurations[frameDurations.length - 1],
      p90FrameTimeMs:
        frameDurations[Math.floor(frameDurations.length * 0.9)] ?? 0,
      p99FrameTimeMs:
        frameDurations[Math.floor(frameDurations.length * 0.99)] ?? 0,
      targetFrameTimeMs,
    };
  }

  /**
   * 查找 CPU 执行热点，识别耗时较长的操作
   */
  private findCpuHotspots(events: TimelineEvent[]): CpuHotspot[] {
    const eventMap = new Map<
      string,
      { durations: number[]; category: string }
    >();

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

    return hotspots
      .sort((a, b) => b.totalDurationMs - a.totalDurationMs)
      .slice(0, 20);
  }

  /**
   * 定义各个渲染阶段相关的事件名称模式
   */
  private static readonly PHASE_PATTERNS: Record<string, string[]> = {
    Build: [
      "build", "widget", "createElement", "updateChild",
      "inflateWidget", "performRebuild", "buildScope",
      "drawFrame", "handleBuildScheduled",
    ],
    Layout: [
      "layout", "performLayout", "flushLayout",
      "RenderFlex", "RenderBox", "RenderSliver",
      "performResize", "markNeedsLayout",
    ],
    Paint: [
      "paint", "flushPaint", "compositeFrame",
      "rasterizer", "compositeLayers", "flushCompositingBits",
      "markNeedsPaint", "repaintCompositedChild",
    ],
  };

  /**
   * 判断给定事件名称是否匹配指定的渲染阶段
   */
  private matchesPhase(eventName: string, phaseName: string): boolean {
    const patterns = Profiler.PHASE_PATTERNS[phaseName] ?? [phaseName.toLowerCase()];
    const lower = eventName.toLowerCase();
    return patterns.some((p) => lower.includes(p));
  }

  /**
   * 针对特定的渲染阶段 (Build/Layout/Paint) 进行时间消耗分析
   */
  private analyzePhase(
    events: TimelineEvent[],
    phaseName: string
  ): {
    totalLayoutTimeMs: number;
    avgLayoutTimeMs: number;
    maxLayoutTimeMs: number;
    layoutCount: number;
  } & {
    totalBuildTimeMs: number;
    avgBuildTimeMs: number;
    maxBuildTimeMs: number;
    buildCount: number;
  } & {
    totalPaintTimeMs: number;
    avgPaintTimeMs: number;
    maxPaintTimeMs: number;
    paintCount: number;
  } {
    const completeDurations = events
      .filter(
        (e) =>
          e.ph === "X" &&
          e.dur !== undefined &&
          this.matchesPhase(e.name, phaseName)
      )
      .map((e) => e.dur! / 1000);

    const beginEvents = events
      .filter((e) => e.ph === "B" && this.matchesPhase(e.name, phaseName))
      .sort((a, b) => a.ts - b.ts);
    const endEvents = events
      .filter((e) => e.ph === "E" && this.matchesPhase(e.name, phaseName))
      .sort((a, b) => a.ts - b.ts);

    const pairedDurations: number[] = [];
    const minLen = Math.min(beginEvents.length, endEvents.length);
    for (let i = 0; i < minLen; i++) {
      const dur = (endEvents[i].ts - beginEvents[i].ts) / 1000;
      if (dur > 0 && dur < 5000) pairedDurations.push(dur);
    }

    const durations = [...completeDurations, ...pairedDurations];
    const total = durations.reduce((a, b) => a + b, 0);
    const max = durations.length > 0 ? Math.max(...durations) : 0;
    const avg = durations.length > 0 ? total / durations.length : 0;

    const key = phaseName.toLowerCase();
    return {
      [`total${phaseName}TimeMs`]: Math.round(total * 100) / 100,
      [`avg${phaseName}TimeMs`]: Math.round(avg * 100) / 100,
      [`max${phaseName}TimeMs`]: Math.round(max * 100) / 100,
      [`${key}Count`]: durations.length,
    } as any;
  }

  /**
   * 根据各项指标生成文本形式的性能分析摘要
   */
  private generateSummary(
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
      summary.push(
        `🔥 ${criticalHotspots.length} CPU hotspot(s) found:`
      );
      for (const h of criticalHotspots.slice(0, 5)) {
        summary.push(
          `  - ${h.name}: ${h.maxDurationMs.toFixed(1)}ms max, ${h.callCount} calls [${h.severity.toUpperCase()}]`
        );
      }
    }

    return summary;
  }

  /**
   * 根据各项分析数据生成具体的性能优化建议
   */
  private generateRecommendations(
    frames: FrameAnalysis,
    hotspots: CpuHotspot[],
    buildPhase: { buildCount: number; maxBuildTimeMs: number; avgBuildTimeMs: number },
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
      recs.push(
        "Performance looks good! No major issues detected in this session."
      );
    }

    return recs;
  }
}
