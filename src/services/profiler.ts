import { FlutterVmServiceClient } from "./vm-service-client.js";
import { analyzeTimeline, ProfilingResult } from "./profiling-analysis.js";

export type {
  CpuHotspot,
  FrameAnalysis,
  PhaseAnalysis,
  ProfilingResult,
} from "./profiling-analysis.js";

/**
 * 性能分析会话记录
 */
export interface ProfilingSession {
  startTime: number;
  endTime?: number;
  targetFps: number;
}

/**
 * Flutter 性能分析器
 * 负责采集 VM Timeline 数据，并委托纯分析模块生成性能报告。
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
   * 开启必要的 Timeline 标志并记录起始时间。
   */
  async start(): Promise<void> {
    if (this.isActive) {
      throw new Error("Profiling session already active");
    }

    await this.client.clearTimeline();
    await this.client.setTimelineFlags(["Dart", "Embedder", "GC", "Compiler"]);

    const fps = await this.client.getDisplayRefreshRate();

    this.session = {
      startTime: Date.now(),
      targetFps: fps,
    };
  }

  /**
   * 停止当前性能分析会话并生成报告。
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
    const result = analyzeTimeline(events, durationMs, targetFrameTimeMs);

    this.session = null;
    return result;
  }
}
