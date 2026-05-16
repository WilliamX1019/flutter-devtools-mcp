import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FlutterVmServiceClient } from "../services/vm-service-client.js";
import { FlatWidget, WidgetNode } from "../types/widget.js";

/**
 * 递归展开并扁平化 Widget 树
 * @param node 当前 Widget 节点
 * @param depth 当前深度
 * @param maxDepth 最大允许展开深度
 * @param projectOnly 是否仅保留本地项目创建的 Widget
 * @returns 扁平化的 Widget 列表
 */
function flattenWidgetTree(
  node: WidgetNode,
  depth: number = 0,
  maxDepth: number = 15,
  projectOnly: boolean = false
): FlatWidget[] {
  if (depth > maxDepth) return [];

  const isProjectWidget = node.createdByLocalProject ?? false;

  if (projectOnly && !isProjectWidget && depth > 2) {
    const childResults: FlatWidget[] = [];
    for (const child of node.children ?? []) {
      childResults.push(
        ...flattenWidgetTree(child, depth, maxDepth, projectOnly)
      );
    }
    return childResults;
  }

  const widgetName =
    node.creationLocation?.name ??
    node.widgetRuntimeType ??
    node.description ??
    node.type ??
    "Unknown";

  const flat: FlatWidget = {
    type: widgetName,
    depth,
    id: node.valueId,
    isProjectWidget,
    childCount: node.children?.length ?? 0,
  };

  if (isProjectWidget && node.creationLocation?.file) {
    const file = node.creationLocation.file.replace(/^file:\/\//, "");
    const shortFile = file.split("/lib/").pop() ?? file.split("/").pop() ?? file;
    flat.sourceFile = shortFile;
    flat.sourceLine = node.creationLocation.line;
  }

  if (node.properties && node.properties.length > 0) {
    flat.properties = node.properties
      .filter((p) => p.description && p.description !== "null")
      .slice(0, 10)
      .map((p) => ({
        name: p.name,
        value: String(p.description ?? p.value ?? ""),
      }));
  }

  const results = [flat];

  for (const child of node.children ?? []) {
    results.push(
      ...flattenWidgetTree(child, depth + 1, maxDepth, projectOnly)
    );
  }

  return results;
}

/**
 * 将扁平化的 Widget 列表格式化为易读的文本树结构
 * @param widgets 扁平化的 Widget 列表
 * @returns 格式化后的树状文本
 */
function formatTreeAsText(widgets: FlatWidget[]): string {
  return widgets
    .map((w) => {
      const indent = "  ".repeat(w.depth);
      const projectMarker = w.isProjectWidget ? " ★" : "";
      const childInfo = w.childCount > 0 ? ` (${w.childCount} children)` : "";
      const sourceInfo =
        w.sourceFile ? ` [${w.sourceFile}:${w.sourceLine}]` : "";
      let line = `${indent}${w.type}${projectMarker}${childInfo}${sourceInfo}`;

      if (w.properties && w.properties.length > 0) {
        const props = w.properties.map((p) => `${p.name}: ${p.value}`).join(", ");
        line += ` [${props}]`;
      }

      return line;
    })
    .join("\n");
}

/**
 * 注册与 Widget 树视图相关的 MCP 工具
 * 包括获取屏幕当前 Widget 树以及探测特定 Widget
 * @param server MCP 服务器实例
 * @param client Flutter VM Service 客户端实例
 */
export function registerWidgetTreeTools(
  server: McpServer,
  client: FlutterVmServiceClient
) {
  // 注册 "get_widget_tree" 工具：获取当前 Flutter 应用程序页面的 Widget 树
  server.registerTool("get_widget_tree", {
                description: "Get the current widget tree of the running Flutter app. Returns a structured representation of all widgets on screen. Widgets marked with ★ are from your project code (not framework widgets).",
    inputSchema: {
          maxDepth: z
            .number()
            .min(1)
            .max(50)
            .default(15)
            .describe("Maximum depth of the widget tree to return (default: 15)"),
          projectOnly: z
            .boolean()
            .default(false)
            .describe(
              "If true, only show widgets created by the project (skip framework internals)"
            ),
        }
              }, async ({ maxDepth, projectOnly }) => {
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
            const tree = (await client.getWidgetTree()) as WidgetNode;
            const flattened = flattenWidgetTree(tree, 0, maxDepth, projectOnly);
            const text = formatTreeAsText(flattened);

            const stats = {
              totalWidgets: flattened.length,
              projectWidgets: flattened.filter((w) => w.isProjectWidget).length,
              maxDepthReached: Math.max(...flattened.map((w) => w.depth)),
            };

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Widget Tree (${stats.totalWidgets} widgets, ${stats.projectWidgets} from project, depth: ${stats.maxDepthReached})\n${"─".repeat(60)}\n${text}`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Failed to get widget tree: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        });

  // 注册 "inspect_widget" 工具：根据 widgetId 提取具体 Widget 的详细属性
  server.registerTool("inspect_widget", {
                description: "Get detailed information about a specific widget by its ID (obtained from get_widget_tree). Returns render details, constraints, size, and state.",
    inputSchema: {
          widgetId: z
            .string()
            .describe("The widget ID from the widget tree (valueId field)"),
        }
              }, async ({ widgetId }) => {
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
            const details = await client.getWidgetDetails(widgetId);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(details, null, 2),
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Failed to inspect widget: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        });
}
