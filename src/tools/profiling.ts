import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FlutterVmServiceClient } from "../services/vm-service-client.js";
import { Profiler } from "../services/profiler.js";
import {
  appendDiagnosticFindings,
  createFindingId,
} from "../utils/diagnostic-findings.js";
import { DiagnosticFinding } from "../types/diagnostics.js";

function buildProfilingFindings(result: Awaited<ReturnType<Profiler["stop"]>>) {
  const findings: DiagnosticFinding[] = [];

  if (result.frameAnalysis.jankPercentage > 10) {
    findings.push({
      id: createFindingId("performance", "jank-rate"),
      severity: result.frameAnalysis.jankPercentage > 25 ? "critical" : "high",
      category: "performance",
      title: "Significant frame jank detected",
      evidence: `${result.frameAnalysis.jankFrames} of ${result.frameAnalysis.totalFrames} frames were janky (${result.frameAnalysis.jankPercentage.toFixed(1)}%).`,
      metric: {
        name: "jankPercentage",
        value: Number(result.frameAnalysis.jankPercentage.toFixed(1)),
        unit: "percent",
        threshold: 10,
      },
      recommendation:
        "Inspect phase breakdown and CPU hotspots, then run rebuild tracking if build time is high.",
      nextTool: "start_tracking_rebuilds",
    });
  }

  if (result.buildPhaseAnalysis.maxBuildTimeMs > 16) {
    findings.push({
      id: createFindingId("performance", "slow-build-phase"),
      severity: "high",
      category: "performance",
      title: "Build phase exceeds frame budget",
      evidence: `Max build phase time is ${result.buildPhaseAnalysis.maxBuildTimeMs.toFixed(2)}ms.`,
      metric: {
        name: "maxBuildTimeMs",
        value: Number(result.buildPhaseAnalysis.maxBuildTimeMs.toFixed(2)),
        unit: "ms",
        threshold: 16,
      },
      recommendation:
        "Run rebuild tracking and inspect high-rebuild widgets before changing state management or widget boundaries.",
      nextTool: "start_tracking_rebuilds",
    });
  }

  for (const hotspot of result.cpuHotspots.filter(
    (h) => h.severity === "critical" || h.severity === "high"
  )) {
    findings.push({
      id: createFindingId("performance", `hotspot-${hotspot.name}`),
      severity: hotspot.severity,
      category: "performance",
      title: `CPU hotspot: ${hotspot.name}`,
      evidence: `${hotspot.name} took ${hotspot.maxDurationMs.toFixed(1)}ms max across ${hotspot.callCount} calls.`,
      metric: {
        name: "maxDurationMs",
        value: hotspot.maxDurationMs,
        unit: "ms",
        threshold: hotspot.severity === "critical" ? 100 : 32,
      },
      recommendation:
        "Inspect the source path for this work if available in Timeline details, or narrow with targeted reproduction.",
    });
  }

  return findings;
}

/**
 * 注册 Flutter 性能分析相关的 MCP 工具
 * 包括启动和停止性能剖析会话
 * @param server MCP 服务器实例
 * @param client Flutter VM Service 客户端实例
 * @param profiler Profiler 分析引擎实例
 */
export function registerProfilingTools(
  server: McpServer,
  client: FlutterVmServiceClient,
  profiler: Profiler
) {
  // 注册 "start_profiling" 工具：启动性能剖析会话
  server.registerTool(
    "start_profiling",
    {
      description:
        "Start a performance profiling session. After starting, interact with the app (scroll, tap, navigate) to generate activity, then call stop_profiling to get the analysis. The app should be running in profile mode (`flutter run --profile`) for accurate results.",
    },
    async () => {
      if (!client.connected) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Not connected. Use the `connect` tool first.",
            },
          ],
          isError: true,
        };
      }

      if (profiler.isActive) {
        return {
          content: [
            {
              type: "text" as const,
              text: "A profiling session is already active. Call stop_profiling first.",
            },
          ],
          isError: true,
        };
      }

      try {
        await profiler.start();
        return {
          content: [
            {
              type: "text" as const,
              text: "✅ Profiling started. Interact with the app now (scroll, tap, navigate), then call `stop_profiling` to get the analysis.",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to start profiling: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 "stop_profiling" 工具：停止当前的剖析会话，并生成性能分析报告
  server.registerTool(
    "stop_profiling",
    {
      description:
        "Stop the current profiling session and get a detailed performance analysis including frame timing, jank detection, CPU hotspots, build/layout/paint phase analysis, and actionable recommendations.",
    },
    async () => {
      if (!client.connected) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Not connected. Use the `connect` tool first.",
            },
          ],
          isError: true,
        };
      }

      if (!profiler.isActive) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No active profiling session. Call start_profiling first.",
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await profiler.stop();

        const output = [
          "═══════════════════════════════════════════════════════════",
          "  FLUTTER PERFORMANCE ANALYSIS REPORT",
          "═══════════════════════════════════════════════════════════",
          "",
          "📊 SUMMARY",
          "───────────────────────────────────────────────────────────",
          ...result.summary,
          "",
          "📈 FRAME ANALYSIS",
          "───────────────────────────────────────────────────────────",
          `Total frames: ${result.frameAnalysis.totalFrames}`,
          `Average frame time: ${result.frameAnalysis.averageFrameTimeMs.toFixed(2)}ms`,
          `P90 frame time: ${result.frameAnalysis.p90FrameTimeMs.toFixed(2)}ms`,
          `P99 frame time: ${result.frameAnalysis.p99FrameTimeMs.toFixed(2)}ms`,
          `Max frame time: ${result.frameAnalysis.maxFrameTimeMs.toFixed(2)}ms`,
          `Jank frames: ${result.frameAnalysis.jankFrames} (${result.frameAnalysis.jankPercentage.toFixed(1)}%)`,
          `Target: ${result.frameAnalysis.targetFrameTimeMs.toFixed(1)}ms (${Math.round(1000 / result.frameAnalysis.targetFrameTimeMs)}fps)`,
          "",
          "🔧 PHASE BREAKDOWN",
          "───────────────────────────────────────────────────────────",
          `Build:  avg ${result.buildPhaseAnalysis.avgBuildTimeMs.toFixed(2)}ms | max ${result.buildPhaseAnalysis.maxBuildTimeMs.toFixed(2)}ms | ${result.buildPhaseAnalysis.buildCount} calls`,
          `Layout: avg ${result.layoutPhaseAnalysis.avgLayoutTimeMs.toFixed(2)}ms | max ${result.layoutPhaseAnalysis.maxLayoutTimeMs.toFixed(2)}ms | ${result.layoutPhaseAnalysis.layoutCount} calls`,
          `Paint:  avg ${result.paintPhaseAnalysis.avgPaintTimeMs.toFixed(2)}ms | max ${result.paintPhaseAnalysis.maxPaintTimeMs.toFixed(2)}ms | ${result.paintPhaseAnalysis.paintCount} calls`,
          "",
        ];

        if (result.cpuHotspots.length > 0) {
          output.push("🔥 CPU HOTSPOTS");
          output.push("───────────────────────────────────────────────────────────");
          for (const h of result.cpuHotspots.slice(0, 10)) {
            const severityIcon =
              h.severity === "critical"
                ? "🔴"
                : h.severity === "high"
                  ? "🟠"
                  : h.severity === "medium"
                    ? "🟡"
                    : "🟢";
            output.push(`${severityIcon} ${h.name} [${h.severity.toUpperCase()}]`);
            output.push(
              `   Total: ${h.totalDurationMs.toFixed(1)}ms | Avg: ${h.avgDurationMs.toFixed(1)}ms | Max: ${h.maxDurationMs.toFixed(1)}ms | Calls: ${h.callCount}`
            );
          }
          output.push("");
        }

        output.push("💡 RECOMMENDATIONS");
        output.push("───────────────────────────────────────────────────────────");
        for (const rec of result.recommendations) {
          output.push(`• ${rec}`);
        }

        appendDiagnosticFindings(output, buildProfilingFindings(result));

        return {
          content: [
            {
              type: "text" as const,
              text: output.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to stop profiling: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
