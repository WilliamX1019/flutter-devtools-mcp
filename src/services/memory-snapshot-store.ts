export interface MemorySnapshot {
  name: string;
  timestamp: number;
  memory: {
    heapUsage: number;
    heapCapacity: number;
    externalUsage: number;
    topClasses: Array<{
      name: string;
      bytes: number;
      instances: number;
    }>;
  };
}

export class MemorySnapshotStore {
  private snapshots = new Map<string, MemorySnapshot>();

  save(snapshot: MemorySnapshot): void {
    this.snapshots.set(snapshot.name, snapshot);
  }

  get(name: string): MemorySnapshot | undefined {
    return this.snapshots.get(name);
  }

  names(): string[] {
    return Array.from(this.snapshots.keys());
  }

  list(): MemorySnapshot[] {
    return Array.from(this.snapshots.values()).sort(
      (a, b) => b.timestamp - a.timestamp
    );
  }

  get size(): number {
    return this.snapshots.size;
  }
}
