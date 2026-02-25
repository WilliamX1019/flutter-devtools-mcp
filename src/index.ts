#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FlutterVmServiceClient } from "./services/vm-service-client.js";
import { Profiler } from "./services/profiler.js";
import { registerConnectionTools } from "./tools/connection.js";
import { registerWidgetTreeTools } from "./tools/widget-tree.js";
import { registerProfilingTools } from "./tools/profiling.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerDebugActionTools } from "./tools/debug-actions.js";

const server = new McpServer({
  name: "flutter-devtools-mcp",
  version: "0.1.0",
});

const vmClient = new FlutterVmServiceClient();
const profiler = new Profiler(vmClient);

registerConnectionTools(server, vmClient);
registerWidgetTreeTools(server, vmClient);
registerProfilingTools(server, vmClient, profiler);
registerMemoryTools(server, vmClient);
registerDebugActionTools(server, vmClient);

vmClient.on("error", (err) => {
  console.error("[flutter-devtools-mcp] VM Service error:", err);
});

vmClient.on("disconnected", () => {
  console.error(
    "[flutter-devtools-mcp] Disconnected from Flutter app VM Service"
  );
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[flutter-devtools-mcp] Server started on stdio transport");
}

main().catch((err) => {
  console.error("[flutter-devtools-mcp] Fatal error:", err);
  process.exit(1);
});
