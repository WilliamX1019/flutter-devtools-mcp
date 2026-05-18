import { describe, expect, it } from "vitest";
import {
  MemorySnapshot,
  MemorySnapshotStore,
} from "../../src/services/memory-snapshot-store.js";

function snapshot(name: string, timestamp: number): MemorySnapshot {
  return {
    name,
    timestamp,
    memory: {
      heapUsage: timestamp * 10,
      heapCapacity: timestamp * 20,
      externalUsage: timestamp,
      topClasses: [
        {
          name: "Example",
          bytes: timestamp * 2,
          instances: timestamp,
        },
      ],
    },
  };
}

describe("MemorySnapshotStore", () => {
  it("saves and retrieves snapshots by name", () => {
    const store = new MemorySnapshotStore();
    const baseline = snapshot("baseline", 1);

    store.save(baseline);

    expect(store.get("baseline")).toEqual(baseline);
    expect(store.get("missing")).toBeUndefined();
    expect(store.size).toBe(1);
  });

  it("lists snapshots newest first", () => {
    const store = new MemorySnapshotStore();

    store.save(snapshot("old", 1));
    store.save(snapshot("new", 3));
    store.save(snapshot("middle", 2));

    expect(store.list().map((item) => item.name)).toEqual(["new", "middle", "old"]);
    expect(store.names()).toEqual(["old", "new", "middle"]);
  });

  it("replaces snapshots with the same name", () => {
    const store = new MemorySnapshotStore();

    store.save(snapshot("same", 1));
    store.save(snapshot("same", 5));

    expect(store.size).toBe(1);
    expect(store.get("same")?.timestamp).toBe(5);
  });
});
