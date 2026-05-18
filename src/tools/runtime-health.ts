import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AllocationProfile,
  FlutterVmServiceClient,
} from "../services/vm-service-client.js";
import { IsolateInfo } from "../types/runtime.js";
import { WidgetNode } from "../types/widget.js";
import { formatBytes } from "../utils/format.js";
import {
  appendDiagnosticFindings,
  createFindingId,
} from "../utils/diagnostic-findings.js";
import { collectWidgetStats, WidgetStats } from "../utils/widget-stats.js";
import { DiagnosticFinding } from "../types/diagnostics.js";
import { RuntimeHealthStore } from "../services/runtime-health-store.js";

function summarizeMemory(profile: AllocationProfile) {
  const { heapUsage, heapCapacity, externalUsage } = profile.memoryUsage;
  const heapUtilization = heapCapacity > 0 ? (heapUsage / heapCapacity) * 100 : 0;

  const topClasses = profile.members
    .filter((m) => m.class?.name && m.bytesCurrent > 0)
    .sort((a, b) => b.bytesCurrent - a.bytesCurrent)
    .slice(0, 5)
    .map((m) => ({
      name: m.class.name,
      bytes: m.bytesCurrent,
      instances: m.instancesCurrent,
    }));

  return {
    heapUsage,
    heapCapacity,
    externalUsage,
    heapUtilization,
    topClasses,
  };
}

function extensionStatus(extensions: string[]) {
  const has = (name: string) => extensions.includes(name);
  return {
    inspector:
      has("ext.flutter.inspector.getRootWidgetSummaryTree") ||
      has("ext.flutter.inspector.getRootWidgetTree"),
    rebuildTracking: has("ext.flutter.inspector.trackRebuildDirtyWidgets"),
    hotReload: has("ext.flutter.reassemble"),
    screenshot: extensions.includes("_flutter.screenshot"),
    debugPaint: has("ext.flutter.debugPaint"),
    displayRefreshRate: has("ext.flutter.getDisplayRefreshRate"),
  };
}

function buildNextSteps(args: {
  pauseState: string;
  widgetStats?: WidgetStats;
  heapUtilization?: number;
  extensions: ReturnType<typeof extensionStatus>;
  mode: "quick" | "deep";
}): string[] {
  const steps: string[] = [];

  if (args.pauseState !== "Resume" && args.pauseState !== "unknown") {
    steps.push(
      `The isolate is not running normally (${args.pauseState}). Resolve the pause or exception state before collecting performance data.`
    );
  }

  if (args.widgetStats && args.widgetStats.projectWidgets === 0) {
    steps.push(
      "Run get_widget_tree with projectOnly=false. No project widgets were detected in the shallow tree."
    );
  } else if (args.extensions.inspector) {
    steps.push(
      "Use get_widget_tree with projectOnly=true before making layout or state-management changes."
    );
  }

  if (args.extensions.rebuildTracking) {
    steps.push(
      "For suspected unnecessary rebuilds, call start_tracking_rebuilds, reproduce the interaction, then stop_tracking_rebuilds."
    );
  }

  steps.push(
    "For scroll, animation, startup, or navigation slowness, call start_profiling, reproduce the issue, then stop_profiling."
  );

  if (args.heapUtilization !== undefined && args.heapUtilization > 75) {
    steps.push(
      "Heap utilization is high. Save a before snapshot, reproduce the leak path, save an after snapshot, then compare_snapshots."
    );
  } else {
    steps.push(
      "For memory regressions, use save_snapshot before and after the fix so the agent can validate the delta."
    );
  }

  if (args.mode === "deep") {
    steps.push(
      "After editing code, trigger hot_reload and rerun the same diagnostic tools to verify the fix against the original baseline."
    );
  }

  return steps;
}

function buildRuntimeFindings(args: {
  pauseState: string;
  widgetStats?: WidgetStats;
  heapUtilization?: number;
  extensions: ReturnType<typeof extensionStatus>;
}): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  if (args.pauseState !== "Resume" && args.pauseState !== "unknown") {
    findings.push({
      id: createFindingId("runtime", "isolate-paused"),
      severity: "high",
      category: "runtime",
      title: "Main isolate is not running normally",
      evidence: `Pause state is ${args.pauseState}. Runtime diagnostics may be incomplete until this is resolved.`,
      recommendation:
        "Resolve the pause or exception state, then rerun runtime_health_check.",
      nextTool: "get_app_info",
    });
  }

  if (!args.extensions.inspector) {
    findings.push({
      id: createFindingId("runtime", "inspector-extension-missing"),
      severity: "medium",
      category: "runtime",
      title: "Flutter inspector extension is unavailable",
      evidence:
        "The connected isolate did not report the expected Flutter inspector service extension.",
      recommendation:
        "Run the app in debug or profile mode and reconnect before widget diagnostics.",
      nextTool: "get_app_info",
    });
  }

  if (args.widgetStats && args.widgetStats.projectWidgets === 0) {
    findings.push({
      id: createFindingId("widget", "no-project-widgets-in-baseline"),
      severity: "low",
      category: "widget",
      title: "No project widgets detected in shallow baseline",
      evidence: `Sampled ${args.widgetStats.totalWidgets} widgets but found 0 project widgets.`,
      metric: {
        name: "projectWidgets",
        value: 0,
        unit: "widgets",
      },
      recommendation:
        "Run get_widget_tree with a deeper maxDepth or projectOnly=false to inspect the full tree.",
      nextTool: "get_widget_tree",
    });
  }

  if (args.heapUtilization !== undefined && args.heapUtilization > 75) {
    findings.push({
      id: createFindingId("memory", "high-heap-utilization"),
      severity: args.heapUtilization > 85 ? "critical" : "high",
      category: "memory",
      title: "Heap utilization is high",
      evidence: `Heap utilization is ${args.heapUtilization.toFixed(1)}%.`,
      metric: {
        name: "heapUtilization",
        value: Number(args.heapUtilization.toFixed(1)),
        unit: "percent",
        threshold: 75,
      },
      recommendation:
        "Save a before snapshot, reproduce the memory path, save an after snapshot, then compare snapshots.",
      nextTool: "save_snapshot",
    });
  }

  return findings;
}

export function registerRuntimeHealthTools(
  server: McpServer,
  client: FlutterVmServiceClient,
  runtimeHealthStore: RuntimeHealthStore = new RuntimeHealthStore()
) {
  server.registerTool(
    "runtime_health_check",
    {
      description:
        "Run an agent-oriented health check for the connected Flutter app. Use this as the first diagnostic step after connect/discover_apps. It summarizes VM state, available Flutter service extensions, shallow widget coverage, memory pressure, and the recommended next tools to call.",
      inputSchema: {
        mode: z
          .enum(["quick", "deep"])
          .default("quick")
          .describe(
            "quick collects VM state and a shallow widget baseline; deep also collects a memory baseline"
          ),
        forceGC: z
          .boolean()
          .default(false)
          .describe("Force GC before memory sampling. Use only for deep checks."),
        widgetDepth: z
          .number()
          .min(1)
          .max(12)
          .default(4)
          .describe("Maximum widget depth for the shallow baseline."),
      },
    },
    async ({ mode, forceGC, widgetDepth }) => {
      if (!client.connected) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Not connected. Use `discover_apps` or `connect` first.",
            },
          ],
          isError: true,
        };
      }

      try {
        const vmInfo = await client.getVM();
        const isolate = (await client.getIsolate()) as IsolateInfo;
        const extensions = isolate.extensionRPCs ?? [];
        const extStatus = extensionStatus(extensions);
        const fps = await client.getDisplayRefreshRate();
        const pauseState = isolate.pauseEvent?.kind ?? "unknown";

        let widgetStats: WidgetStats | undefined;
        let memorySummary: ReturnType<typeof summarizeMemory> | undefined;

        if (mode === "deep" || extStatus.inspector) {
          try {
            const tree = (await client.getWidgetTree(
              undefined,
              widgetDepth
            )) as WidgetNode;
            widgetStats = collectWidgetStats(tree);
          } catch {
            widgetStats = undefined;
          }
        }

        if (mode === "deep") {
          try {
            const profile = await client.getAllocationProfile(undefined, forceGC);
            memorySummary = summarizeMemory(profile);
          } catch {
            memorySummary = undefined;
          }
        }

        const mainIsolate = vmInfo.isolates.find((i) => !i.isSystemIsolate);
        const lines = [
          "===========================================================",
          "  FLUTTER RUNTIME HEALTH CHECK",
          "===========================================================",
          "",
          "CONNECTION",
          "-----------------------------------------------------------",
          `Status: connected`,
          `VM Service URI: ${client.vmServiceUri ?? "unknown"}`,
          `Process: PID ${vmInfo.pid} on ${vmInfo.operatingSystem} (${vmInfo.targetCPU})`,
          `Dart VM: ${vmInfo.version}`,
          `Main isolate: ${mainIsolate?.name ?? "unknown"} (${mainIsolate?.id ?? "unknown"})`,
          `Pause state: ${pauseState}`,
          `Display refresh rate: ${fps} fps`,
          `Root library: ${isolate.rootLib?.uri ?? "unknown"}`,
          "",
          "SERVICE EXTENSIONS",
          "-----------------------------------------------------------",
          `Inspector: ${extStatus.inspector ? "available" : "missing"}`,
          `Rebuild tracking: ${extStatus.rebuildTracking ? "available" : "missing"}`,
          `Hot reload: ${extStatus.hotReload ? "available" : "missing"}`,
          `Screenshot: ${extStatus.screenshot ? "available" : "unknown/missing"}`,
          `Debug paint: ${extStatus.debugPaint ? "available" : "missing"}`,
          `Total extension RPCs: ${extensions.length}`,
        ];

        if (widgetStats) {
          lines.push(
            "",
            "WIDGET BASELINE",
            "-----------------------------------------------------------",
            `Depth sampled: ${widgetStats.deepestLevel}/${widgetDepth}`,
            `Widgets seen: ${widgetStats.totalWidgets}`,
            `Project widgets seen: ${widgetStats.projectWidgets}`,
            `Nodes with unresolved children: ${widgetStats.unresolvedChildren}`
          );

          if (widgetStats.topProjectWidgets.length > 0) {
            lines.push("Top project widgets:");
            for (const widget of widgetStats.topProjectWidgets) {
              lines.push(
                `  - ${widget.name}${widget.location ? ` [${widget.location}]` : ""}`
              );
            }
          }
        } else {
          lines.push(
            "",
            "WIDGET BASELINE",
            "-----------------------------------------------------------",
            "Widget baseline unavailable. Try get_widget_tree for the detailed error."
          );
        }

        if (memorySummary) {
          lines.push(
            "",
            "MEMORY BASELINE",
            "-----------------------------------------------------------",
            `Heap used: ${formatBytes(memorySummary.heapUsage)} / ${formatBytes(memorySummary.heapCapacity)} (${memorySummary.heapUtilization.toFixed(1)}%)`,
            `External: ${formatBytes(memorySummary.externalUsage)}`,
            forceGC ? "GC: forced before sampling" : "GC: not forced",
            "Top classes:"
          );

          for (const cls of memorySummary.topClasses) {
            lines.push(
              `  - ${cls.name}: ${formatBytes(cls.bytes)}, ${cls.instances.toLocaleString()} instances`
            );
          }
        } else if (mode === "deep") {
          lines.push(
            "",
            "MEMORY BASELINE",
            "-----------------------------------------------------------",
            "Memory baseline unavailable. Try get_memory_snapshot for the detailed error."
          );
        }

        const nextSteps = buildNextSteps({
          pauseState,
          widgetStats,
          heapUtilization: memorySummary?.heapUtilization,
          extensions: extStatus,
          mode,
        });
        const findings = buildRuntimeFindings({
          pauseState,
          widgetStats,
          heapUtilization: memorySummary?.heapUtilization,
          extensions: extStatus,
        });

        runtimeHealthStore.save({
          timestamp: Date.now(),
          mode,
          forceGC,
          widgetDepth,
          connection: {
            connected: true,
            vmServiceUri: client.vmServiceUri ?? undefined,
            process: {
              pid: vmInfo.pid,
              operatingSystem: vmInfo.operatingSystem,
              targetCPU: vmInfo.targetCPU,
              dartVersion: vmInfo.version,
            },
            mainIsolate: {
              id: mainIsolate?.id,
              name: mainIsolate?.name,
              pauseState,
              rootLibrary: isolate.rootLib?.uri,
            },
            displayRefreshRate: fps,
          },
          serviceExtensions: {
            ...extStatus,
            total: extensions.length,
          },
          widgetStats,
          memory: memorySummary,
          nextSteps,
          findings,
        });

        lines.push(
          "",
          "AGENT NEXT STEPS",
          "-----------------------------------------------------------",
          ...nextSteps.map((step, index) => `${index + 1}. ${step}`)
        );

        appendDiagnosticFindings(lines, findings);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to run runtime health check: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
