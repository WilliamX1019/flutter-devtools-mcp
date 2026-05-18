import { DiagnosticFinding } from "../types/diagnostics.js";
import { WidgetStats } from "../utils/widget-stats.js";

export interface RuntimeHealthSnapshot {
  timestamp: number;
  mode: "quick" | "deep";
  forceGC: boolean;
  widgetDepth: number;
  connection: {
    connected: boolean;
    vmServiceUri?: string;
    process?: {
      pid?: number;
      operatingSystem?: string;
      targetCPU?: string;
      dartVersion?: string;
    };
    mainIsolate?: {
      id?: string;
      name?: string;
      pauseState: string;
      rootLibrary?: string;
    };
    displayRefreshRate: number;
  };
  serviceExtensions: {
    inspector: boolean;
    rebuildTracking: boolean;
    hotReload: boolean;
    screenshot: boolean;
    debugPaint: boolean;
    displayRefreshRate: boolean;
    total: number;
  };
  widgetStats?: WidgetStats;
  memory?: {
    heapUsage: number;
    heapCapacity: number;
    externalUsage: number;
    heapUtilization: number;
    topClasses: Array<{
      name: string;
      bytes: number;
      instances: number;
    }>;
  };
  nextSteps: string[];
  findings: DiagnosticFinding[];
}

export class RuntimeHealthStore {
  private latestSnapshot?: RuntimeHealthSnapshot;

  save(snapshot: RuntimeHealthSnapshot): void {
    this.latestSnapshot = snapshot;
  }

  latest(): RuntimeHealthSnapshot | undefined {
    return this.latestSnapshot;
  }
}
