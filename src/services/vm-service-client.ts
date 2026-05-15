import WebSocket from "ws";
import { EventEmitter } from "events";

/**
 * JSON-RPC 2.0 请求对象接口
 */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 响应对象接口
 */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * JSON-RPC 2.0 通知对象接口 (无 id)
 */
interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Dart Isolate 的引用信息
 */
export interface IsolateRef {
  type: string;
  id: string;
  name: string;
  number: string;
  isSystemIsolate: boolean;
}

/**
 * Dart VM 虚拟机信息
 */
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

/**
 * Timeline 时间线事件数据结构
 */
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

/**
 * 类的内存堆分配统计信息
 */
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

/**
 * 内存分配概要
 */
export interface AllocationProfile {
  members: ClassHeapStats[];
  memoryUsage: {
    externalUsage: number;
    heapCapacity: number;
    heapUsage: number;
  };
}

/**
 * Flutter VM Service 客户端
 * 封装了与 Dart VM Service 的 WebSocket 通信逻辑，提供了各类调试和状态获取的方法
 */
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

  /**
   * 当前是否已连接到 VM Service
   */
  get connected(): boolean {
    return this._connected;
  }

  /**
   * 当前连接的 VM Service URI
   */
  get vmServiceUri(): string | null {
    return this._vmServiceUri;
  }

  /**
   * 主 Isolate (Flutter UI 线程) 的 ID
   */
  get mainIsolateId(): string | null {
    return this._mainIsolateId;
  }

  /**
   * 连接到指定的 VM Service URI
   * @param vmServiceUri VM Service 的 HTTP 或 WebSocket URI
   * @returns 包含 VM 信息的 Promise
   */
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
          // 查找非系统 Isolate，通常第一个即为 Flutter 的主 Isolate
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

  /**
   * 断开与 VM Service 的连接
   */
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

  /**
   * 调用 VM Service 原生方法 (如 getVM, getIsolate 等)
   * @param method 方法名
   * @param params 附加参数
   * @returns 方法执行结果
   */
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

  /**
   * 调用 Flutter 扩展服务方法 (如 ext.flutter.inspector.getRootWidgetTree)
   * @param method 服务扩展名
   * @param isolateId 可选的目标 Isolate ID（默认使用主 Isolate）
   * @param args 扩展方法的其他参数
   * @returns 扩展执行结果
   */
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

  /**
   * 获取 Dart VM 基础信息
   */
  async getVM(): Promise<VMInfo> {
    return (await this.callMethod("getVM")) as VMInfo;
  }

  /**
   * 获取指定 Isolate 的详细信息
   */
  async getIsolate(isolateId?: string): Promise<unknown> {
    const id = isolateId ?? this._mainIsolateId;
    if (!id) throw new Error("No isolate ID available");
    return this.callMethod("getIsolate", { isolateId: id });
  }

  /**
   * 在给定的 Isolate（或帧栈）中计算 Dart 表达式
   * @param expression Dart 表达式
   * @param isolateId Isolate ID
   * @param frameIndex (可选) 帧栈索引，如果提供则在指定帧下执行
   * @returns 表达式计算结果
   */
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

  /**
   * 获取 Flutter 应用程序的根 Widget 树
   * @param isolateId Isolate ID
   * @param maxDepth 最大遍历深度，默认 20
   * @returns 包含 Widget 树结构的对象
   */
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

  /**
   * 递归展开 Widget 树的子节点
   * @param node 当前 Widget 节点
   * @param isolateId Isolate ID
   * @param objectGroup 检查器对象组
   * @param depth 当前深度
   * @param maxDepth 最大允许深度
   */
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

  /**
   * 获取特定 Widget 的详细属性信息
   * @param widgetId Widget 的标识 ID
   * @param isolateId Isolate ID
   * @returns 包含 Widget 属性细节的对象
   */
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

  /**
   * 获取当前启用的 Timeline 标志（追踪类别）
   */
  async getTimelineFlags(): Promise<unknown> {
    return this.callMethod("getVMTimelineFlags");
  }

  /**
   * 设置需要记录的 Timeline 标志
   * @param recordedStreams 要记录的流列表 (如 "Dart", "Embedder", "GC")
   */
  async setTimelineFlags(recordedStreams: string[]): Promise<void> {
    await this.callMethod("setVMTimelineFlags", { recordedStreams });
  }

  /**
   * 抓取 Timeline 数据（性能分析时间线）
   * @param timeOriginMicros 可选，起始时间 (微秒)
   * @param timeExtentMicros 可选，时间范围 (微秒)
   * @returns 包含 Timeline 事件数组的对象
   */
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

  /**
   * 清空现有的 Timeline 数据缓存
   */
  async clearTimeline(): Promise<void> {
    await this.callMethod("clearVMTimeline");
  }

  /**
   * 获取内存分配的剖析数据
   * @param isolateId Isolate ID
   * @param gc 是否在获取前触发一次垃圾回收
   * @returns 类的内存占用及堆使用情况
   */
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

  /**
   * 执行热重载 (Hot Reload)
   */
  async hotReload(isolateId?: string): Promise<unknown> {
    const id = isolateId ?? this._mainIsolateId;
    if (!id) throw new Error("No isolate ID available");
    return this.callServiceExtension("ext.flutter.reassemble", id);
  }

  /**
   * 执行热重启 (Hot Restart)
   */
  async hotRestart(): Promise<unknown> {
    return this.callServiceExtension("ext.flutter.restart");
  }

  /**
   * 切换界面 Debug 绘制模式 (显示布局边界)
   */
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

  /**
   * 截取当前 App 屏幕画面
   */
  async screenshot(): Promise<unknown> {
    return this.callServiceExtension(
      "ext.flutter.debugAllowBanner",
      undefined,
      { enabled: false }
    )
      .catch(() => {})
      .then(() => this.callServiceExtension("_flutter.screenshot"));
  }

  /**
   * 开启 Widget 重建(Rebuild)追踪
   */
  async startTrackingRebuilds(isolateId?: string): Promise<void> {
    const id = isolateId ?? this._mainIsolateId;
    if (!id) throw new Error("No isolate ID available");

    await this.callServiceExtension(
      "ext.flutter.inspector.trackRebuildDirtyWidgets",
      id,
      { enabled: true }
    );
  }

  /**
   * 关闭 Widget 重建追踪
   */
  async stopTrackingRebuilds(isolateId?: string): Promise<void> {
    const id = isolateId ?? this._mainIsolateId;
    if (!id) throw new Error("No isolate ID available");

    await this.callServiceExtension(
      "ext.flutter.inspector.trackRebuildDirtyWidgets",
      id,
      { enabled: false }
    );
  }

  /**
   * 获取 Widget 创建位置的文件映射
   */
  async getWidgetLocationMap(isolateId?: string): Promise<unknown> {
    const id = isolateId ?? this._mainIsolateId;
    if (!id) throw new Error("No isolate ID available");

    const response: any = await this.callServiceExtension(
      "ext.flutter.inspector.widgetLocationIdMap",
      id
    );
    return response?.result ?? response;
  }

  /**
   * 获取设备/屏幕的显示刷新率 (FPS)
   */
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

  /**
   * 订阅相关的 VM 事件流 (如 GC, 日志, Timeline 等)
   */
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

  /**
   * 处理 WebSocket 接收到的 JSON 消息
   * @param data 从 WebSocket 接收的原始字符串数据
   */
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

  /**
   * 拒绝所有处于 pending 状态的请求
   * 主要在连接断开或异常时调用
   * @param reason 拒绝的错误原因
   */
  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingRequests.delete(id);
    }
  }

  /**
   * 规范化 VM Service 的连接 URL 为 WebSocket URL 格式
   * @param uri 输入的原始 URI (如 http://127.0.0.1:...)
   * @returns 转换后的 WebSocket URI
   */
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
