import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { RuntimeAlert, RuntimeMonitor } from "../../src/services/runtime-monitor.js";
import { FlutterVmServiceClient } from "../../src/services/vm-service-client.js";

function client(): FlutterVmServiceClient {
  return new EventEmitter() as FlutterVmServiceClient;
}

function frame(durationMs: number) {
  return {
    name: "Frame",
    cat: "Embedder",
    ph: "X",
    ts: 1,
    dur: durationMs * 1000,
    pid: 1,
    tid: 1,
  };
}

describe("RuntimeMonitor", () => {
  it("records and notifies consecutive jank alerts", () => {
    const vmClient = client();
    const alerts: RuntimeAlert[] = [];
    const monitor = new RuntimeMonitor(vmClient, (alert) => alerts.push(alert));

    monitor.start({ jankFrameThresholdMs: 16, consecutiveJankFrames: 2 });
    vmClient.emit("stream:Timeline", { timelineEvents: [frame(20), frame(24)] });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      type: "jank",
      severity: "high",
    });
    expect(monitor.status().trend.jankAlerts).toBe(1);
  });

  it("records exception and disconnect alerts", () => {
    const vmClient = client();
    const monitor = new RuntimeMonitor(vmClient);

    monitor.start();
    vmClient.emit("stream:Debug", {
      kind: "PauseException",
      exception: { message: "boom" },
    });
    vmClient.emit("disconnected");

    expect(monitor.status().trend).toMatchObject({
      exceptionAlerts: 1,
      disconnectAlerts: 1,
    });
  });

  it("filters GC alerts below the configured threshold", () => {
    const vmClient = client();
    const monitor = new RuntimeMonitor(vmClient);

    monitor.start({ gcHeapUsageThresholdBytes: 100 });
    vmClient.emit("stream:GC", { new: { used: 40 }, old: { used: 50 } });
    vmClient.emit("stream:GC", { new: { used: 60 }, old: { used: 50 } });

    expect(monitor.status().trend.gcAlerts).toBe(1);
    expect(monitor.status().recentAlerts[0]).toMatchObject({
      type: "gc",
      severity: "high",
    });
  });

  it("detaches listeners when stopped", () => {
    const vmClient = client();
    const monitor = new RuntimeMonitor(vmClient);

    monitor.start({ consecutiveJankFrames: 1 });
    monitor.stop();
    vmClient.emit("stream:Timeline", { timelineEvents: [frame(80)] });

    expect(monitor.status().alertCount).toBe(0);
    expect(monitor.status().active).toBe(false);
  });
});
