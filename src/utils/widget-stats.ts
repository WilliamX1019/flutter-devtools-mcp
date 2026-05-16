import { WidgetNode } from "../types/widget.js";

export interface WidgetStats {
  totalWidgets: number;
  projectWidgets: number;
  unresolvedChildren: number;
  deepestLevel: number;
  topProjectWidgets: Array<{
    name: string;
    location?: string;
  }>;
}

export function getWidgetName(node: WidgetNode): string {
  return (
    node.creationLocation?.name ??
    node.widgetRuntimeType ??
    node.description ??
    node.type ??
    "Unknown"
  );
}

export function shortWidgetLocation(node: WidgetNode): string | undefined {
  const file = node.creationLocation?.file;
  const line = node.creationLocation?.line;
  if (!file) return undefined;

  const normalized = file.replace(/^file:\/\//, "");
  const shortFile =
    normalized.split("/lib/").pop() ?? normalized.split("/").pop() ?? normalized;
  return line ? `${shortFile}:${line}` : shortFile;
}

export function collectWidgetStats(root: WidgetNode): WidgetStats {
  const stats: WidgetStats = {
    totalWidgets: 0,
    projectWidgets: 0,
    unresolvedChildren: 0,
    deepestLevel: 0,
    topProjectWidgets: [],
  };

  const visit = (node: WidgetNode, depth: number) => {
    stats.totalWidgets += 1;
    stats.deepestLevel = Math.max(stats.deepestLevel, depth);

    if (node.createdByLocalProject) {
      stats.projectWidgets += 1;
      if (stats.topProjectWidgets.length < 10) {
        stats.topProjectWidgets.push({
          name: getWidgetName(node),
          location: shortWidgetLocation(node),
        });
      }
    }

    if (node.hasChildren && (!node.children || node.children.length === 0)) {
      stats.unresolvedChildren += 1;
    }

    for (const child of node.children ?? []) {
      visit(child, depth + 1);
    }
  };

  visit(root, 0);
  return stats;
}
