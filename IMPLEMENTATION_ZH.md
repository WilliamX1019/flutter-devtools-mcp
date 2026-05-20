# Flutter DevTools MCP - 项目实现与架构分析

## 1. 项目定位

`flutter-devtools-mcp` 是一个基于 Model Context Protocol (MCP) 的 Node.js 服务端应用。它把 Flutter App 在 debug/profile 模式下暴露的 Dart VM Service 能力，包装成 IDE AI Agent 可调用的 Tools、Resources 和 Prompts。

项目目标不是复刻 Flutter DevTools 图形界面，而是让 Agent 从“只会读代码”升级为“能观察运行中的 Flutter 应用、提出诊断、修改代码、验证修复结果”的运行时调试代理。

核心闭环如下：

```text
AI Agent
  -> MCP stdio
  -> flutter-devtools-mcp
  -> Dart VM Service WebSocket / JSON-RPC
  -> Running Flutter App
  -> Runtime evidence
  -> Diagnostic session
  -> Code fix
  -> Hot reload
  -> Verification run
  -> Before/after verdict
```

## 2. 总体架构

源码主要集中在 `src/` 目录，按职责拆分为入口层、VM 通信层、分析服务层、MCP 工具层、Resources/Prompts 层和共享类型/工具层。

当前 MCP、IDE Agent 与真实 Flutter 项目之间的数据关系流转图维护在 [`ARCHITECTURE_FLOW_ZH.md`](ARCHITECTURE_FLOW_ZH.md)。当 Tools、Resources、Prompts、诊断会话、运行时监控或修复验证闭环发生结构性变化时，需要同步更新该流转图。

```text
src/
  index.ts
  services/
    vm-service-client.ts
    profiler.ts
    diagnostic-session.ts
    diagnostic-comparison.ts
    runtime-monitor.ts
    report-export.ts
    ...
  tools/
    connection.ts
    runtime-health.ts
    profiling.ts
    rebuild-tracker.ts
    memory.ts
    network.ts
    diagnostic-session.ts
    monitoring.ts
    ...
  resources/
    diagnostic-resources.ts
  prompts/
    diagnostic-prompts.ts
  types/
    diagnostics.ts
    runtime.ts
    widget.ts
  utils/
    diagnostic-findings.ts
    diagnostic-recording.ts
    format.ts
    widget-stats.ts
```

### 2.1 入口层：`src/index.ts`

入口文件负责组装整个 MCP Server：

1. 创建 `McpServer`。
2. 初始化共享服务实例：
   - `FlutterVmServiceClient`
   - `Profiler`
   - `DiagnosticSessionStore`
   - `MemorySnapshotStore`
   - `RuntimeHealthStore`
   - `RuntimeMonitor`
3. 注册 Tools、Resources 和 Prompts。
4. 监听 VM Service 事件，如 error、disconnect、reconnecting、reconnected、reconnect_failed。
5. 使用 `StdioServerTransport` 与 IDE 里的 MCP Client 通信。

这里的关键设计是：所有工具共享同一个 VM Service Client 和诊断状态存储，因此一次 Agent 调试过程中的 runtime health、profiling、rebuild、snapshot、report 可以归档到同一个 diagnostic session。

## 3. VM Service 通信层

### 3.1 核心模块：`src/services/vm-service-client.ts`

`FlutterVmServiceClient` 是项目最底层的运行时能力入口。它负责把 Dart VM Service 的 WebSocket JSON-RPC 调用封装成 TypeScript 方法。

主要能力：

| 能力 | 实现方式 |
|------|----------|
| VM 信息 | `getVM` |
| Isolate 信息 | `getIsolate` |
| Flutter service extension | `callServiceExtension` |
| Widget Tree | `ext.flutter.inspector.*` |
| Timeline | `getVMTimeline`, `setVMTimelineFlags`, `clearVMTimeline` |
| Heap Profile | `getAllocationProfile` |
| Hot Reload | `ext.flutter.reassemble` |
| Hot Restart | `ext.flutter.restart` |
| Screenshot | `_flutter.screenshot` |
| Debug Paint | `ext.flutter.debugPaint` |
| Widget rebuild tracking | `ext.flutter.inspector.trackRebuildDirtyWidgets` |
| Runtime event streams | `streamListen` for `Isolate`, `Debug`, `GC`, `Timeline`, `Logging`, `Stdout`, `Stderr` |

### 3.2 连接状态机与自动重连

当前实现已经从简单的 connected/disconnected 标志升级为显式状态机：

```ts
type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";
```

`connect` 支持以下策略参数：

| 参数 | 默认值 | 作用 |
|------|--------|------|
| `autoReconnect` | `true` | VM Service socket 意外关闭后自动恢复 |
| `maxReconnectAttempts` | `5` | 最大重连次数 |
| `reconnectBaseDelayMs` | `1000` | 指数退避的基础延迟 |

连接状态通过 `connectionStatus` 暴露，并同步到 Resource `flutter://connection/status`。这让 Agent 在长时间 profiling、monitoring 或用户切换页面时，可以先判断连接是否处于 `reconnecting`，而不是立即误判为工具失败。

断连策略：

1. 手动 `disconnect` 会关闭自动重连。
2. 意外 `close` 后，如果连接已成功建立且 `autoReconnect=true`，进入 `reconnecting`。
3. 重连成功后触发 `reconnected` 事件。
4. 达到上限后触发 `reconnect_failed`。

## 4. MCP Tools 层

`src/tools/` 将底层 VM Service 能力转为 Agent 可理解的 MCP Tool。所有工具遵守两个约束：

1. 保持现有工具名和必填参数兼容。
2. 新增能力优先使用可选参数或新增工具。

### 4.1 发现与连接

文件：

- `src/tools/discover.ts`
- `src/tools/connection.ts`

工具：

| 工具 | 作用 |
|------|------|
| `discover_apps` | 扫描本地 Flutter VM Service 入口并辅助连接 |
| `connect` | 连接指定 VM Service URI，并支持自动重连参数 |
| `reconnect` | 使用最近一次 VM Service URI 手动恢复连接 |
| `disconnect` | 主动断开连接并关闭自动重连 |
| `get_app_info` | 获取 VM、Isolate、扩展能力和连接状态 |

连接工具输出包含 `connection` 字段，便于 Agent 直接读取当前状态机快照。

### 4.2 运行时健康检查

文件：`src/tools/runtime-health.ts`

`runtime_health_check` 是连接后的首个诊断入口。它采集：

1. VM / Dart / PID / 平台信息。
2. 主 Isolate、pause state、root library。
3. Flutter service extensions 可用性。
4. 浅层 Widget 基线。
5. deep 模式下的内存概要。
6. 下一步推荐工具。
7. 结构化 `DiagnosticFinding`。

最新实现支持自动写入 diagnostic session：

```text
runtime_health_check(
  sessionId=<diag_x>,
  observationRole="baseline",
  observationLabel="initial health"
)
```

这使 runtime baseline 不再只停留在聊天上下文里，而是进入可比较、可导出的诊断模型。

### 4.3 性能 Profiling

文件：

- `src/tools/profiling.ts`
- `src/services/profiler.ts`
- `src/services/profiling-analysis.ts`

流程：

```text
start_profiling
用户复现卡顿
stop_profiling
```

`Profiler` 负责：

1. 设置 Timeline flags。
2. 清理并采集 Timeline。
3. 解析 Frame、Build、Layout、Paint 事件。
4. 检测 jank percentage、P90/P99、max frame time。
5. 识别 CPU hotspot。
6. 检测 shader / renderer pipeline jank。

`stop_profiling` 会生成文本报告和结构化 findings，并可自动写入 session：

```text
stop_profiling(
  sessionId=<diag_x>,
  observationRole="observation" | "verification"
)
```

### 4.4 Widget Tree 与 Rebuild Tracker

文件：

- `src/tools/widget-tree.ts`
- `src/tools/rebuild-tracker.ts`
- `src/utils/widget-stats.ts`

Widget Tree 通过 Flutter Inspector service extension 递归展开树结构，并支持项目 Widget 过滤、源码位置输出和节点详情检查。

Rebuild Tracker 通过 `Flutter.RebuiltWidgets` 扩展事件收集重建次数，并结合 widget location map 输出：

1. Widget 名称。
2. 文件路径和行号。
3. 重建次数。
4. severity。
5. 修复建议。

`stop_tracking_rebuilds` 同样支持自动归档：

```text
stop_tracking_rebuilds(
  sessionId=<diag_x>,
  observationRole="baseline" | "verification"
)
```

这是验证重构是否真的减少 rebuild 的关键工具。

### 4.5 内存、快照与 Diff

文件：

- `src/tools/memory.ts`
- `src/tools/snapshot-diff.ts`
- `src/services/memory-snapshot-store.ts`

核心工具：

| 工具 | 作用 |
|------|------|
| `get_memory_snapshot` | 获取当前 heap profile |
| `save_snapshot` | 保存命名快照 |
| `compare_snapshots` | 比较 before/after 快照 |
| `list_snapshots` | 列出当前进程内保存的快照 |

内存分析重点在 before/after 差异，而不是单次绝对值。`compare_snapshots` 会给出类级别 bytes 和 instances 的增长/下降，用于定位泄漏或缓存膨胀。

### 4.6 网络诊断

文件：

- `src/tools/network.ts`
- `src/services/network-analysis.ts`

网络捕获结合 VM Service stream 和 Timeline HTTP-like 事件，用于识别：

1. 慢请求。
2. 大响应体。
3. HTTP error。
4. 请求方法、URL、状态码、耗时、大小。

能力边界也在工具输出中明确：WebView、native SDK、platform channel 或绕开 `dart:io` instrumentation 的自定义网络栈可能不可见。

### 4.7 调试动作与视觉验证

文件：

- `src/tools/debug-actions.ts`
- `src/services/screenshot-comparison.ts`

工具能力：

| 工具 | 作用 |
|------|------|
| `hot_reload` | 应用代码修改，保留状态 |
| `hot_restart` | 重启 Flutter runtime |
| `take_screenshot` | 截图并可保存到文件 |
| `compare_screenshots` | 对比 before/after PNG |
| `toggle_debug_paint` | 开启/关闭布局边界绘制 |
| `evaluate_expression` | 在运行时执行 Dart 表达式 |

这部分让 Agent 能验证 UI 修复，而不是只依赖代码 diff。

## 5. Diagnostic Session 与结构化诊断模型

### 5.1 诊断会话存储

文件：`src/services/diagnostic-session.ts`

`DiagnosticSessionStore` 维护进程内诊断会话：

```ts
interface DiagnosticSession {
  id: string;
  problemType: string;
  startedAt: number;
  endedAt?: number;
  status: "active" | "ended";
  baseline?: DiagnosticObservation;
  observations: DiagnosticObservation[];
  verificationRuns: DiagnosticObservation[];
  notes: string[];
}
```

配套工具在 `src/tools/diagnostic-session.ts` 中：

| 工具 | 作用 |
|------|------|
| `start_diagnostic_session` | 开始一次问题排查 |
| `record_diagnostic_observation` | 手动记录工具结果或外部观察 |
| `compare_diagnostic_runs` | 比较 baseline 与 verification |
| `export_report` | 导出 Markdown / HTML 报告 |
| `list_diagnostic_sessions` | 列出会话 |
| `end_diagnostic_session` | 结束会话 |

### 5.2 自动归档工具

文件：`src/utils/diagnostic-recording.ts`

该模块把“工具输出写入 session”的逻辑统一封装，避免每个工具重复处理：

```text
autoRecordDiagnosticObservation
appendAutoRecordStatus
```

当前已接入：

1. `runtime_health_check`
2. `stop_profiling`
3. `stop_tracking_rebuilds`

工具返回文本中会追加 `DIAGNOSTIC SESSION` 区块，明确写入成功或失败原因。

### 5.3 结构化 Finding

文件：

- `src/types/diagnostics.ts`
- `src/utils/diagnostic-findings.ts`

核心类型：

```ts
interface DiagnosticFinding {
  id: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  category: "runtime" | "widget" | "rebuild" | "performance" | "memory" | "network";
  title: string;
  evidence: string;
  metric?: {
    name: string;
    value: number;
    unit: string;
    threshold?: number;
  };
  location?: {
    file?: string;
    line?: number;
    column?: number;
    symbol?: string;
  };
  recommendation?: string;
  nextTool?: string;
}
```

文本报告面向人，finding 面向 Agent。后续 compare、report、verification 都应优先依赖 finding 中的 metric 和 id。

## 6. Resources 与 Prompts

### 6.1 MCP Resources

文件：`src/resources/diagnostic-resources.ts`

Resources 让 Agent 不必每次都调用工具，就能读取当前服务器状态：

| Resource | 内容 |
|----------|------|
| `flutter://connection/status` | 连接状态机、VM URI、isolate、重连策略 |
| `flutter://runtime/health/latest` | 最近一次 runtime health check |
| `flutter://monitoring/status` | 当前监控状态和告警窗口 |
| `flutter://profiling/status` | profiling 是否进行中 |
| `flutter://snapshots` | 已保存内存快照列表 |
| `flutter://diagnostic-sessions` | 当前诊断会话摘要 |

### 6.2 MCP Prompts

文件：`src/prompts/diagnostic-prompts.ts`

内置 Prompts 把专家排查流程固化为 Agent 可调用模板：

| Prompt | 目标 |
|--------|------|
| `diagnose_jank` | 卡顿 / 掉帧 |
| `diagnose_memory_leak` | 内存泄漏 |
| `diagnose_layout_issue` | 布局错位 |
| `diagnose_network_issue` | 网络问题 |
| `verify_fix` | 修复后验证 |

Prompts 的价值是减少 Agent 临场编排错误，强制它按 baseline -> observation -> fix -> verification 的闭环执行。

## 7. Continuous Monitoring 与异步通知

文件：

- `src/services/runtime-monitor.ts`
- `src/tools/monitoring.ts`

Runtime Monitor 订阅 VM Service 事件并持续分析：

| 事件类型 | 来源 | 用途 |
|----------|------|------|
| jank | Timeline / frame events | 识别持续掉帧 |
| GC pressure | GC stream / memory usage | 判断频繁 GC 或堆压力 |
| exception | Isolate / Debug stream | 捕获运行时异常 |
| disconnect | VM client event | 感知连接中断 |

监控告警通过 MCP logging notification 发送给 Agent，同时保存在窗口内，可通过 `get_monitoring_status` 或 `flutter://monitoring/status` 读取。

自动重连和 monitoring 组合后，Agent 能处理更真实的长时间诊断场景：短暂断连进入 `reconnecting`，恢复后继续采集；如果达到重连上限，才认为诊断链路中断。

## 8. 报告导出

文件：`src/services/report-export.ts`

`export_report` 将 diagnostic session 输出为 Markdown 或 HTML。报告包含：

1. 问题类型和 session 元信息。
2. Runtime baseline。
3. Findings。
4. Before/after metric comparison。
5. 修复建议。
6. 复测结论。

这让一次 Agent 调试过程可以从临时对话变成可分享、可复盘、可审计的诊断记录。

## 9. 测试与质量门禁

项目使用 Vitest、ESLint、Prettier 和 TypeScript build 作为基础质量门禁。

当前测试覆盖重点：

1. 格式化工具。
2. Widget stats。
3. Profiler timeline 解析。
4. Network analysis。
5. Runtime monitor。
6. Diagnostic session。
7. Diagnostic comparison。
8. Report export。
9. Screenshot comparison。
10. Diagnostic recording。

推荐提交前执行：

```bash
npm run lint
npm run format:check
npm test
npm run build
```

## 10. 设计取舍

### 10.1 为什么不复刻 DevTools UI

AI Agent 不需要图表和面板，它需要稳定、可解析、可比较的证据。因此工具输出优先考虑：

1. 明确 severity。
2. 明确 evidence。
3. 明确 metric。
4. 尽可能带 file/line。
5. 给出 nextTool。

### 10.2 为什么使用进程内存储

当前 `DiagnosticSessionStore`、snapshot store、runtime health store 都是进程内存储。这降低了部署复杂度，适合 MCP Server 与 IDE 会话绑定的使用方式。代价是 MCP Server 重启后历史会话丢失。

后续如需跨会话保留，可增加可选持久化层，但不应影响现有工具 API。

### 10.3 为什么自动归档只先接入核心工具

`runtime_health_check`、`stop_profiling`、`stop_tracking_rebuilds` 是最常见的 baseline / performance / rebuild 证据来源，且已经输出结构化 findings。先接入这些工具可以形成最小闭环。

内存、网络、截图工具目前仍可通过 `record_diagnostic_observation` 手动归档。后续可以在不破坏兼容性的前提下继续接入自动归档。

## 11. 当前架构能力总结

当前项目已经具备一条完整的运行时调试代理链路：

1. 自动发现并连接 Flutter App。
2. VM Service 断连后自动重连。
3. 建立 runtime baseline。
4. 通过 profiling、rebuild、memory、network、screenshot 采集专项证据。
5. 将核心工具结果自动写入 diagnostic session。
6. 通过 hot reload/hot restart 应用修复。
7. 复测并比较 before/after 指标。
8. 导出诊断报告。
9. 持续监控 jank、GC、异常和断连。

这使 `flutter-devtools-mcp` 不只是“AI 可以调用 DevTools”，而是把 Flutter 运行时证据组织成 Agent 能执行、能复测、能审计的工程化调试流程。




