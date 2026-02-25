import WebSocket from "ws";
import { EventEmitter } from "events";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface IsolateRef {
  type: string;
  id: string;
  name: string;
  number: string;
  isSystemIsolate: boolean;
}

export interface VMInfo {
  type: string;
  name: string;
  architectureBits: number;
  hostCPU: string;
  operatingSystem: string;
  targetCPU: string;
  version: string;
  pid: number;
  startTime: number;
  isolates: IsolateRef[];
  isolateGroups: unknown[];
}

export interface TimelineEvent {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: Record<string, unknown>;
}

export interface ClassHeapStats {
  class: {
    name: string;
    id: string;
    library?: { name?: string; uri?: string };
  };
  bytesCurrent: number;
  instancesCurrent: number;
  accumulatedSize: number;
  instancesAccumulated: number;
}

export interface AllocationProfile {
  members: ClassHeapStats[];
  memoryUsage: {
    externalUsage: number;
    heapCapacity: number;
    heapUsage: number;
  };
}

export class FlutterVmServiceClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private _connected = false;
  private _vmServiceUri: string | null = null;
  private _mainIsolateId: string | null = null;

  get connected(): boolean {
    return this._connected;
  }

  get vmServiceUri(): string | null {
    return this._vmServiceUri;
  }

  get mainIsolateId(): string | null {
    return this._mainIsolateId;
  }

  async connect(vmServiceUri: string): Promise<VMInfo> {
    if (this._connected) {
      await this.disconnect();
    }

    const wsUri = this.toWebSocketUri(vmServiceUri);
    this._vmServiceUri = vmServiceUri;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout after 10s to ${wsUri}`));
      }, 10000);

      this.ws = new WebSocket(wsUri);

      this.ws.on("open", async () => {
        clearTimeout(timeout);
        this._connected = true;
        this.emit("connected");

        try {
          const vmInfo = (await this.callMethod("getVM")) as VMInfo;
          const flutterIsolate = vmInfo.isolates.find(
            (i) => !i.isSystemIsolate
          );
          if (flutterIsolate) {
            this._mainIsolateId = flutterIsolate.id;
          }
          await this.subscribeToStreams();
          resolve(vmInfo);
        } catch (err) {
          reject(err);
        }
      });

      this.ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on("error", (err) => {
        clearTimeout(timeout);
        this._connected = false;
        this.emit("error", err);
        reject(err);
      });

      this.ws.on("close", () => {
        this._connected = false;
        this._mainIsolateId = null;
        this.rejectAllPending("Connection closed");
        this.emit("disconnected");
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.rejectAllPending("Disconnecting");
      this.ws.close();
      this.ws = null;
      this._connected = false;
      this._mainIsolateId = null;
      this._vmServiceUri = null;
    }
  }

  async callMethod(
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.ws || !this._connected) {
      throw new Error("Not connected to VM Service");
    }

    const id = String(++this.requestId);
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? {},
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method} (id: ${id})`));
      }, 30000);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify(request));
    });
  }

  async callServiceExtension(
    method: string,
    isolateId?: string,
    args?: Record<string, unknown>
  ): Promise<unknown> {
    const params: Record<string, unknown> = {
      isolateId: isolateId ?? this._mainIsolateId,
      ...args,
    };
    return this.callMethod(method, params);
  }

  async getVM(): Promise<VMInfo> {
    return (await this.callMethod("getVM")) as VMInfo;
  }

  async getIsolate(isolateId?: string): Promise<unknown> {
    const id = isolateId ?? this._mainIsolateId;
    if (!id) throw new Error("No isolate ID available");
    return this.callMethod("getIsolate", { isolateId: id });
  }

  async evaluate(
    expression: string,
    isolateId?: string,
    frameIndex?: number
  ): Promise<unknown> {
    const id = isolateId ?? this._mainIsolateId;
    if (!id) throw new Error("No isolate ID available");

    if (frameIndex !== undefined) {
      return this.callMethod("evaluateInFrame", {
        isolateId: id,
        frameIndex,
        expression,
      });
    }

    const isolate = (await this.getIsolate(id)) as {
      rootLib?: { id: string };
    };
    if (!isolate.rootLib?.id) {
      throw new Error("Cannot find root library for evaluation");
    }

    return this.callMethod("evaluate", {
      isolateId: id,
      targetId: isolate.rootLib.id,
      expression,
    });
  }

  async getWidgetTree(
    isolateId?: string,
    maxDepth: number = 20
  ): Promise<unknown> {
    const id = isolateId ?? this._mainIsolateId;
    if (!id) throw new Error("No isolate ID available");

    const objectGroup = `mcp_inspector_${Date.now()}`;

    let response: any;
    try {
      response = await this.callServiceExtension(
        "ext.flutter.inspector.getRootWidgetSummaryTree",
        id,
        { objectGroup }
      );
    } catch {
      response = await this.callServiceExtension(
        "ext.flutter.inspector.getRootWidgetTree",
        id,
        {
          groupName: objectGroup,
          isSummaryTree: true,
          withPreviews: false,
        }
      );
    }

    const root = response?.result ?? response;
    await this.expandWidgetChildren(root, id, objectGroup, 0, maxDepth);
    return root;
  }

  private async expandWidgetChildren(
    node: any,
    isolateId: string,
    objectGroup: string,
    depth: number,
    maxDepth: number
  ): Promise<void> {
    if (!node || depth >= maxDepth) return;

    if (
      node.hasChildren &&
      (!node.children || node.children.length === 0) &&
      node.valueId
    ) {
      try {
        const response: any = await this.callServiceExtension(
          "ext.flutter.inspector.getChildrenSummaryTree",
          isolateId,
          { arg: node.valueId, objectGroup }
        );
        const children = response?.result ?? response;
        if (Array.isArray(children)) {
          node.children = children;
        }
      } catch {
        // Node may not support children fetching
      }
    }

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        await this.expandWidgetChildren(
          child,
          isolateId,
          objectGroup,
          depth + 1,
          maxDepth
        );
      }
    }
  }

  async getWidgetDetails(
    widgetId: string,
    isolateId?: string
  ): Promise<unknown> {
    const id = isolateId ?? this._mainIsolateId;
    if (!id) throw new Error("No isolate ID available");

    const response: any = await this.callServiceExtension(
      "ext.flutter.inspector.getDetailsSubtree",
      id,
      {
        arg: widgetId,
        objectGroup: `mcp_details_${Date.now()}`,
        subtreeDepth: 2,
      }
    );
    return response?.result ?? response;
  }

  async getTimelineFlags(): Promise<unknown> {
    return this.callMethod("getVMTimelineFlags");
  }

  async setTimelineFlags(recordedStreams: string[]): Promise<void> {
    await this.callMethod("setVMTimelineFlags", { recordedStreams });
  }

  async getTimeline(
    timeOriginMicros?: number,
    timeExtentMicros?: number
  ): Promise<{ traceEvents: TimelineEvent[] }> {
    const params: Record<string, unknown> = {};
    if (timeOriginMicros !== undefined)
      params.timeOriginMicros = timeOriginMicros;
    if (timeExtentMicros !== undefined)
      params.timeExtentMicros = timeExtentMicros;
    return (await this.callMethod("getVMTimeline", params)) as {
      traceEvents: TimelineEvent[];
    };
  }

  async clearTimeline(): Promise<void> {
    await this.callMethod("clearVMTimeline");
  }

  async getAllocationProfile(
    isolateId?: string,
    gc?: boolean
  ): Promise<AllocationProfile> {
    const id = isolateId ?? this._mainIsolateId;
    if (!id) throw new Error("No isolate ID available");

    const params: Record<string, unknown> = { isolateId: id };
    if (gc) params.gc = true;

    return (await this.callMethod(
      "getAllocationProfile",
      params
    )) as AllocationProfile;
  }

  async hotReload(isolateId?: string): Promise<unknown> {
    const id = isolateId ?? this._mainIsolateId;
    if (!id) throw new Error("No isolate ID available");
    return this.callServiceExtension("ext.flutter.reassemble", id);
  }

  async hotRestart(): Promise<unknown> {
    return this.callServiceExtension("ext.flutter.restart");
  }

  async toggleDebugPaint(isolateId?: string): Promise<unknown> {
    const id = isolateId ?? this._mainIsolateId;
    if (!id) throw new Error("No isolate ID available");

    const current = (await this.callServiceExtension(
      "ext.flutter.debugPaint",
      id
    )) as { enabled?: boolean };

    return this.callServiceExtension("ext.flutter.debugPaint", id, {
      enabled: !current.enabled,
    });
  }

  async screenshot(): Promise<unknown> {
    return this.callServiceExtension(
      "ext.flutter.debugAllowBanner",
      undefined,
      { enabled: false }
    )
      .catch(() => {})
      .then(() => this.callServiceExtension("_flutter.screenshot"));
  }

  async getDisplayRefreshRate(): Promise<number> {
    try {
      const result = (await this.callServiceExtension(
        "ext.flutter.getDisplayRefreshRate"
      )) as { fps?: number };
      return result.fps ?? 60;
    } catch {
      return 60;
    }
  }

  private async subscribeToStreams(): Promise<void> {
    const streams = [
      "Isolate",
      "Debug",
      "GC",
      "Extension",
      "Timeline",
      "Logging",
      "Stderr",
      "Stdout",
    ];

    for (const stream of streams) {
      try {
        await this.callMethod("streamListen", { streamId: stream });
      } catch {
        // Some streams may not be available
      }
    }
  }

  private handleMessage(data: string): void {
    let message: JsonRpcResponse | JsonRpcNotification;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }

    if ("id" in message && message.id) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.id);
        const response = message as JsonRpcResponse;
        if (response.error) {
          pending.reject(
            new Error(
              `${response.error.message} (code: ${response.error.code})`
            )
          );
        } else {
          pending.resolve(response.result);
        }
      }
    } else if ("method" in message) {
      this.emit("event", message);
      const notification = message as JsonRpcNotification;
      if (notification.params?.streamId) {
        this.emit(
          `stream:${notification.params.streamId}`,
          notification.params.event
        );
      }
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingRequests.delete(id);
    }
  }

  private toWebSocketUri(uri: string): string {
    let wsUri = uri.replace(/^https?:\/\//, "ws://");

    if (!wsUri.startsWith("ws://") && !wsUri.startsWith("wss://")) {
      wsUri = `ws://${wsUri}`;
    }

    if (!wsUri.endsWith("/ws")) {
      wsUri = wsUri.replace(/\/?$/, "/ws");
    }

    return wsUri;
  }
}
