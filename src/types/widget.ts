export interface WidgetNode {
  description?: string;
  type?: string;
  widgetRuntimeType?: string;
  children?: WidgetNode[];
  valueId?: string;
  createdByLocalProject?: boolean;
  hasChildren?: boolean;
  creationLocation?: {
    file?: string;
    line?: number;
    column?: number;
    name?: string;
  };
  properties?: Array<{
    name: string;
    description?: string;
    value?: unknown;
  }>;
}

export interface FlatWidget {
  type: string;
  depth: number;
  id?: string;
  isProjectWidget: boolean;
  childCount: number;
  sourceFile?: string;
  sourceLine?: number;
  properties?: Array<{ name: string; value: string }>;
}
