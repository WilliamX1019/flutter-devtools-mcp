import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FlutterVmServiceClient } from "../services/vm-service-client.js";

/**
 * 注册与连接相关的 MCP 工具
 * 包括：连接到 App、断开连接、获取 App 详情
 * @param server MCP 服务器实例
 * @param client Flutter VM Service 客户端实例
 */
export function registerConnectionTools(
  server: McpServer,
  client: FlutterVmServiceClient
) {
  // 注册 "connect" 工具：连接到指定的 Flutter 应用程序
  server.registerTool(
    "connect",
    {
      description:
        "Connect to a running Flutter app via its VM Service URI. The URI is printed when you run `flutter run` (e.g., http://127.0.0.1:50000/xxxxx=/). You must connect before using any other tool.",
      inputSchema: {
        vmServiceUri: z
          .string()
          .describe(
            "The VM Service URI of the running Flutter app (e.g., http://127.0.0.1:50000/AbCdEf=/)"
          ),
        autoReconnect: z
          .boolean()
          .default(true)
          .describe("Automatically reconnect if the VM Service socket closes."),
        maxReconnectAttempts: z
          .number()
          .min(0)
          .max(20)
          .default(5)
          .describe(
            "Maximum automatic reconnect attempts after an unexpected disconnect."
          ),
        reconnectBaseDelayMs: z
          .number()
          .min(100)
          .max(30000)
          .default(1000)
          .describe(
            "Base reconnect delay in milliseconds. Backoff doubles per attempt."
          ),
      },
    },
    async ({
      vmServiceUri,
      autoReconnect,
      maxReconnectAttempts,
      reconnectBaseDelayMs,
    }) => {
      try {
        // 尝试建立连接并获取 VM 信息
        const vmInfo = await client.connect(vmServiceUri, {
          autoReconnect,
          maxReconnectAttempts,
          reconnectBaseDelayMs,
        });
        const mainIsolate = vmInfo.isolates.find((i) => !i.isSystemIsolate);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "connected",
                  vm: {
                    name: vmInfo.name,
                    version: vmInfo.version,
                    os: vmInfo.operatingSystem,
                    targetCPU: vmInfo.targetCPU,
                    pid: vmInfo.pid,
                  },
                  mainIsolate: mainIsolate
                    ? {
                        id: mainIsolate.id,
                        name: mainIsolate.name,
                      }
                    : null,
                  isolateCount: vmInfo.isolates.length,
                  connection: client.connectionStatus,
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
              text: `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "reconnect",
    {
      description:
        "Manually reconnect to the last known Flutter VM Service URI and re-enable automatic reconnect.",
    },
    async () => {
      const vmServiceUri = client.vmServiceUri;
      if (!vmServiceUri) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No previous VM Service URI is available. Use the `connect` tool first.",
            },
          ],
          isError: true,
        };
      }

      try {
        const vmInfo = await client.connect(vmServiceUri, { autoReconnect: true });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "reconnected",
                  vm: {
                    name: vmInfo.name,
                    version: vmInfo.version,
                    os: vmInfo.operatingSystem,
                    pid: vmInfo.pid,
                  },
                  connection: client.connectionStatus,
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
              text: `Failed to reconnect: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // 注册 "disconnect" 工具：断开当前连接
  server.registerTool(
    "disconnect",
    {
      description: "Disconnect from the currently connected Flutter app.",
    },
    async () => {
      if (!client.connected) {
        return {
          content: [{ type: "text" as const, text: "Not connected to any app." }],
        };
      }

      await client.disconnect();
      return {
        content: [
          {
            type: "text" as const,
            text: "Disconnected from Flutter app. Automatic reconnect is disabled until `connect` or `reconnect` is called.",
          },
        ],
      };
    }
  );

  // 注册 "get_app_info" 工具：获取当前连接 App 的详细信息
  server.registerTool(
    "get_app_info",
    {
      description:
        "Get detailed information about the connected Flutter app including VM info, isolates, and available extensions.",
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

      try {
        const vmInfo = await client.getVM();
        const isolateDetails = await client.getIsolate();
        const isolate = isolateDetails as {
          rootLib?: { uri: string };
          libraries?: Array<{ uri: string }>;
          extensionRPCs?: string[];
          pauseEvent?: { kind: string };
        };

        const fps = await client.getDisplayRefreshRate();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  vm: {
                    name: vmInfo.name,
                    version: vmInfo.version,
                    os: vmInfo.operatingSystem,
                    hostCPU: vmInfo.hostCPU,
                    targetCPU: vmInfo.targetCPU,
                    architectureBits: vmInfo.architectureBits,
                    pid: vmInfo.pid,
                  },
                  app: {
                    rootLibrary: isolate.rootLib?.uri ?? "unknown",
                    libraryCount: isolate.libraries?.length ?? 0,
                    pauseState: isolate.pauseEvent?.kind ?? "unknown",
                    displayRefreshRate: fps,
                  },
                  flutterExtensions: (isolate.extensionRPCs ?? []).filter((e: string) =>
                    e.startsWith("ext.flutter.")
                  ),
                  isolates: vmInfo.isolates.map((i) => ({
                    id: i.id,
                    name: i.name,
                    isSystem: i.isSystemIsolate,
                  })),
                  connection: client.connectionStatus,
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
              text: `Failed to get app info: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
