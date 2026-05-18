import { describe, expect, it } from "vitest";
import {
  RuntimeHealthSnapshot,
  RuntimeHealthStore,
} from "../../src/services/runtime-health-store.js";

function healthSnapshot(timestamp: number): RuntimeHealthSnapshot {
  return {
    timestamp,
    mode: "quick",
    forceGC: false,
    widgetDepth: 4,
    connection: {
      connected: true,
      vmServiceUri: "ws://127.0.0.1:1234/ws",
      mainIsolate: {
        id: "isolates/1",
        name: "main",
        pauseState: "Resume",
      },
      displayRefreshRate: 60,
    },
    serviceExtensions: {
      inspector: true,
      rebuildTracking: true,
      hotReload: true,
      screenshot: true,
      debugPaint: false,
      displayRefreshRate: true,
      total: 12,
    },
    nextSteps: ["Run profiling"],
    findings: [],
  };
}

describe("RuntimeHealthStore", () => {
  it("starts without a latest snapshot", () => {
    const store = new RuntimeHealthStore();

    expect(store.latest()).toBeUndefined();
  });

  it("returns the most recently saved snapshot", () => {
    const store = new RuntimeHealthStore();
    const first = healthSnapshot(1);
    const second = healthSnapshot(2);

    store.save(first);
    store.save(second);

    expect(store.latest()).toEqual(second);
  });
});
