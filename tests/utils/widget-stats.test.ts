import { describe, expect, it } from "vitest";
import {
  collectWidgetStats,
  getWidgetName,
  shortWidgetLocation,
} from "../../src/utils/widget-stats.js";
import { WidgetNode } from "../../src/types/widget.js";

describe("getWidgetName", () => {
  it("prefers creation location names over runtime type and description", () => {
    const node: WidgetNode = {
      description: "DescriptionName",
      widgetRuntimeType: "RuntimeName",
      creationLocation: { name: "SourceName" },
    };

    expect(getWidgetName(node)).toBe("SourceName");
  });

  it("falls back to Unknown when no naming fields exist", () => {
    expect(getWidgetName({})).toBe("Unknown");
  });
});

describe("shortWidgetLocation", () => {
  it("returns lib-relative file locations when possible", () => {
    const node: WidgetNode = {
      creationLocation: {
        file: "file:///Users/example/app/lib/features/home/home_page.dart",
        line: 42,
      },
    };

    expect(shortWidgetLocation(node)).toBe("features/home/home_page.dart:42");
  });

  it("returns undefined when no file is available", () => {
    expect(shortWidgetLocation({})).toBeUndefined();
  });
});

describe("collectWidgetStats", () => {
  it("counts widgets, project widgets, depth, unresolved children, and top project widgets", () => {
    const root: WidgetNode = {
      widgetRuntimeType: "Root",
      children: [
        {
          createdByLocalProject: true,
          widgetRuntimeType: "HomePage",
          creationLocation: {
            file: "file:///repo/app/lib/home_page.dart",
            line: 10,
          },
          children: [
            {
              createdByLocalProject: true,
              creationLocation: {
                name: "OrderCard",
                file: "file:///repo/app/lib/widgets/order_card.dart",
                line: 24,
              },
            },
          ],
        },
        {
          widgetRuntimeType: "ListView",
          hasChildren: true,
        },
      ],
    };

    expect(collectWidgetStats(root)).toEqual({
      totalWidgets: 4,
      projectWidgets: 2,
      unresolvedChildren: 1,
      deepestLevel: 2,
      topProjectWidgets: [
        { name: "HomePage", location: "home_page.dart:10" },
        { name: "OrderCard", location: "widgets/order_card.dart:24" },
      ],
    });
  });
});
