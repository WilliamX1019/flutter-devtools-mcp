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
import { registerRebuildTrackerTools } from "./tools/rebuild-tracker.js";
import { registerDiscoverTools } from "./tools/discover.js";
import { registerNetworkTools } from "./tools/network.js";
import { registerSnapshotDiffTools } from "./tools/snapshot-diff.js";
import { registerRuntimeHealthTools } from "./tools/runtime-health.js";

/**
 * Flutter DevTools MCP Server
 * 用于通过 Model Context Protocol (MCP) 提供对 Flutter 应用程序进行深度检查、性能分析和调试的工具。
 */
const server = new McpServer({
  name: "flutter-devtools-mcp",
  version: "0.2.0",
});

/**
 * 初始化 Flutter VM 服务客户端
 * 负责与运行中的 Flutter 应用程序的 Dart VM Service 建立 WebSocket 连接
 */
const vmClient = new FlutterVmServiceClient();

/**
 * 初始化性能分析器
 * 依赖于 vmClient，用于收集和分析 Flutter 应用程序的时间线（Timeline）事件
 */
const profiler = new Profiler(vmClient);

// 注册发现和环境探测工具
registerDiscoverTools(server, vmClient);
// 注册设备连接和状态工具
registerConnectionTools(server, vmClient);
// 注册运行时健康检查工具，作为 AI Agent 的首个诊断入口
registerRuntimeHealthTools(server, vmClient);
// 注册 Widget 树检查和操作工具
registerWidgetTreeTools(server, vmClient);
// 注册性能剖析工具
registerProfilingTools(server, vmClient, profiler);
// 注册内存分析和堆栈检查工具
registerMemoryTools(server, vmClient);
// 注册组件重建追踪工具
registerRebuildTrackerTools(server, vmClient);
// 注册网络请求拦截和分析工具
registerNetworkTools(server, vmClient);
// 注册快照对比工具
registerSnapshotDiffTools(server, vmClient);
// 注册调试操作工具 (如热重载、热重启等)
registerDebugActionTools(server, vmClient);

/**
 * 监听 VM Service 错误事件
 */
vmClient.on("error", (err) => {
  console.error("[flutter-devtools-mcp] VM Service error:", err);
});

/**
 * 监听 VM Service 断开连接事件
 */
vmClient.on("disconnected", () => {
  console.error(
    "[flutter-devtools-mcp] Disconnected from Flutter app VM Service"
  );
});

/**
 * 启动 MCP 服务器的主函数
 * 使用标准输入/输出 (stdio) 作为与 MCP 客户端通信的传输层
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[flutter-devtools-mcp] Server started on stdio transport");
}

main().catch((err) => {
  console.error("[flutter-devtools-mcp] Fatal error:", err);
  process.exit(1);
});
