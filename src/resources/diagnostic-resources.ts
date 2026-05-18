import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DiagnosticSessionStore } from "../services/diagnostic-session.js";
import { MemorySnapshotStore } from "../services/memory-snapshot-store.js";
import { Profiler } from "../services/profiler.js";
import { RuntimeHealthStore } from "../services/runtime-health-store.js";
import { FlutterVmServiceClient } from "../services/vm-service-client.js";

function jsonResource(uri: URL, value: unknown) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function registerDiagnosticResources(
  server: McpServer,
  client: FlutterVmServiceClient,
  profiler: Profiler,
  sessions: DiagnosticSessionStore,
  snapshots: MemorySnapshotStore,
  runtimeHealth: RuntimeHealthStore
) {
  server.registerResource(
    "connection-status",
    "flutter://connection/status",
    {
      title: "Flutter Connection Status",
      description: "Current VM Service connection state and isolate pointer.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(uri, {
        connected: client.connected,
        vmServiceUri: client.vmServiceUri,
        mainIsolateId: client.mainIsolateId,
      })
  );

  server.registerResource(
    "runtime-health-latest",
    "flutter://runtime/health/latest",
    {
      title: "Latest Runtime Health Check",
      description:
        "Most recent successful runtime_health_check result captured in this server process.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(uri, {
        latest: runtimeHealth.latest() ?? null,
      })
  );

  server.registerResource(
    "profiling-status",
    "flutter://profiling/status",
    {
      title: "Flutter Profiling Status",
      description: "Whether a Timeline profiling session is active.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(uri, {
        active: profiler.isActive,
      })
  );

  server.registerResource(
    "memory-snapshots",
    "flutter://snapshots",
    {
      title: "Saved Memory Snapshots",
      description: "Named heap snapshots available for comparison.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(
        uri,
        snapshots.list().map((snapshot) => ({
          name: snapshot.name,
          timestamp: snapshot.timestamp,
          heapUsage: snapshot.memory.heapUsage,
          heapCapacity: snapshot.memory.heapCapacity,
          externalUsage: snapshot.memory.externalUsage,
          trackedClasses: snapshot.memory.topClasses.length,
        }))
      )
  );

  server.registerResource(
    "diagnostic-sessions",
    "flutter://diagnostic-sessions",
    {
      title: "Diagnostic Sessions",
      description: "Current in-memory diagnostic sessions and observation counts.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(
        uri,
        sessions.list().map((session) => ({
          id: session.id,
          problemType: session.problemType,
          status: session.status,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          baseline: session.baseline?.id,
          observations: session.observations.length,
          verificationRuns: session.verificationRuns.length,
          notes: session.notes,
        }))
      )
  );
}
