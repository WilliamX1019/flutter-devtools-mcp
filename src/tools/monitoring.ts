import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FlutterVmServiceClient } from "../services/vm-service-client.js";
import { RuntimeMonitor } from "../services/runtime-monitor.js";

export function registerMonitoringTools(
  server: McpServer,
  client: FlutterVmServiceClient,
  monitor: RuntimeMonitor
) {
  server.registerTool(
    "start_monitoring",
    {
      description:
        "Start continuous runtime monitoring for jank, GC pressure, exceptions, and disconnects. Alerts are emitted as MCP logging notifications and retained for status reads.",
      inputSchema: {
        jankFrameThresholdMs: z
          .number()
          .min(1)
          .default(50)
          .describe("Frame duration threshold for jank alerts."),
        consecutiveJankFrames: z
          .number()
          .min(1)
          .default(3)
          .describe("Number of consecutive janky frames required before alerting."),
        gcHeapUsageThresholdBytes: z
          .number()
          .min(1)
          .optional()
          .describe(
            "Optional heap usage threshold. When set, GC alerts are emitted only at or above this value."
          ),
        maxAlerts: z
          .number()
          .min(1)
          .max(500)
          .default(50)
          .describe("Maximum number of recent alerts retained in memory."),
      },
    },
    async ({
      jankFrameThresholdMs,
      consecutiveJankFrames,
      gcHeapUsageThresholdBytes,
      maxAlerts,
    }) => {
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

      try {
        const status = monitor.start({
          jankFrameThresholdMs,
          consecutiveJankFrames,
          gcHeapUsageThresholdBytes,
          maxAlerts,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "started",
                  monitor: status,
                  nextSteps: [
                    "Reproduce the suspected runtime issue while monitoring is active.",
                    "Watch for MCP logging notifications.",
                    "Call get_monitoring_status for the current alert window.",
                    "Call stop_monitoring when verification is complete.",
                  ],
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to start monitoring: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "get_monitoring_status",
    {
      description:
        "Read current runtime monitoring status, recent alerts, and alert trend counts.",
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(monitor.status(), null, 2),
        },
      ],
    })
  );

  server.registerTool(
    "stop_monitoring",
    {
      description:
        "Stop continuous runtime monitoring and return the retained alert summary.",
    },
    async () => {
      try {
        const status = monitor.stop();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "stopped",
                  monitor: status,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to stop monitoring: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
