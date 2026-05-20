# Flutter DevTools MCP 最佳实践指南

`flutter-devtools-mcp` 的定位不是把 DevTools UI 搬进 IDE，而是让 IDE 里的 AI Agent 能完成一条可验证的调试链路：

```text
连接运行态 -> 建立诊断会话 -> 采集基线 -> 复现问题 -> 归档证据 -> 修改代码 -> Hot Reload -> 复测 -> 对比结论
```

单独调用某个工具只能得到一段观察结果。真实项目中更可靠的做法，是把每次诊断都组织成 diagnostic session，并让核心工具把结果自动写入 session，避免 Agent 只靠聊天上下文记忆证据。

---

## 一、通用闭环

### 1. 先连接，并开启自动重连

推荐优先使用 `discover_apps`，无法自动发现时再使用 `connect`：

```text
discover_apps
或
connect(vmServiceUri, autoReconnect=true, maxReconnectAttempts=5, reconnectBaseDelayMs=1000)
```

连接后读取 `flutter://connection/status`，确认：

1. `state` 是 `connected`。
2. `mainIsolateId` 不为空。
3. `autoReconnect` 为 `true`。
4. 长时间监控或性能采集时，如果 `state` 变成 `reconnecting`，先等待重连完成，不要立刻判定工具失效。

如果 VM Service 意外断开，可调用 `reconnect` 回到最近一次连接的 URI。手动 `disconnect` 会关闭自动重连，适合结束诊断或切换 App。

### 2. 每个问题都建立 diagnostic session

开始排查前先调用：

```text
start_diagnostic_session(problemType, note)
```

建议 `problemType` 使用稳定分类，例如：

| 类型 | 建议值 |
|------|--------|
| UI 卡顿 | `jank` |
| 内存泄漏 | `memory-leak` |
| 布局错位 | `layout` |
| 网络慢或失败 | `network` |
| 组件重构验证 | `refactor` |

后续核心工具尽量传入：

```text
sessionId=<diag_x>
observationRole=baseline | observation | verification
observationLabel=<简短标签>
```

目前 `runtime_health_check`、`stop_profiling`、`stop_tracking_rebuilds` 已支持自动写入 diagnostic session。内存、网络、截图等结果如需进入 session，可继续使用 `record_diagnostic_observation` 手动归档。

### 3. 先建立运行时基线

任何专项诊断之前，先执行：

```text
runtime_health_check(mode="quick", sessionId=<diag_x>, observationRole="baseline")
```

如果怀疑内存问题，使用：

```text
runtime_health_check(mode="deep", forceGC=true, sessionId=<diag_x>, observationRole="baseline")
```

`runtime_health_check` 不是专项诊断工具，它负责告诉 Agent 当前是否具备继续排查的条件：

1. App 是否连接到正确 VM Service。
2. 主 Isolate 是否正常运行。
3. Flutter Inspector、重建追踪、Hot Reload、截图等扩展是否可用。
4. 当前页面能否采集项目 Widget。
5. 是否已出现明显内存压力。
6. 下一步应进入 Widget、Rebuild、Profiling、Memory 还是 Network 诊断。

### 4. 修改后必须复测并比较

修复后不要只让 Agent 静态解释代码。标准动作是：

```text
hot_reload
重复同一诊断工具，传 observationRole="verification"
compare_diagnostic_runs(sessionId=<diag_x>)
```

只有 before/after 指标改善，才算完成一轮有效修复。若结论是 `inconclusive`，说明证据不足，应补一次更稳定的复现或扩大采集窗口。

---

## 二、场景一：UI 卡顿与滑动掉帧

适用：滑动列表、页面切换、动画过程中出现肉眼可见卡顿。

推荐流程：

```text
start_diagnostic_session(problemType="jank")
connect(autoReconnect=true)
runtime_health_check(sessionId, observationRole="baseline")
start_profiling
复现卡顿
stop_profiling(sessionId, observationRole="observation", observationLabel="jank reproduction")
必要时 start_tracking_rebuilds -> 复现 -> stop_tracking_rebuilds(sessionId)
修改代码
hot_reload
start_profiling -> 复现同一动作 -> stop_profiling(sessionId, observationRole="verification")
compare_diagnostic_runs(sessionId)
```

判断顺序：

1. 先看 `stop_profiling` 的 jank percentage、P90/P99、max frame time。
2. 如果 Build 阶段高，继续看 `stop_tracking_rebuilds`，定位具体 Widget 和文件行号。
3. 如果 Layout 阶段高，优先排查深层嵌套、Intrinsic 计算、约束反复测量。
4. 如果 Paint 或 shader 区域高，优先排查复杂裁剪、阴影、Opacity、首帧 shader 编译。
5. 如果 CPU hotspots 指向业务方法，先减少同步计算，再考虑 isolate 或缓存。

修复建议优先级：

1. 缩小状态监听范围，例如 `context.select()` 替代过宽的 `context.watch()`。
2. 抽出稳定子树并补 `const`。
3. 避免在 `build` 中做排序、过滤、大对象创建或同步 IO。
4. 对首帧 shader jank，先预热关键交互路径或降低首次绘制复杂度。

---

## 三、场景二：内存泄漏与 OOM 风险

适用：页面反复进出后越来越卡、图片/列表页面内存持续增长、长时间运行后崩溃。

推荐流程：

```text
start_diagnostic_session(problemType="memory-leak")
runtime_health_check(mode="deep", forceGC=true, sessionId, observationRole="baseline")
save_snapshot(name="before", forceGC=true)
反复进入/退出可疑页面
save_snapshot(name="after", forceGC=true)
compare_snapshots(before="before", after="after")
record_diagnostic_observation(sessionId, sourceTool="compare_snapshots", role="observation")
修改 dispose / cache / listener 相关代码
hot_reload 或 hot_restart
重复 before/after snapshot
compare_diagnostic_runs(sessionId)
```

判断重点：

1. Heap usage 是否持续增长且 GC 后不回落。
2. 业务类、Controller、Subscription、Timer、Image buffer 实例是否只增不减。
3. `State` 对象是否在页面退出后仍被持有。
4. 外部内存增长时，重点排查图片、视频、WebView、native texture。

不要只看单次 snapshot。内存问题必须用 before/after 差异判断，否则容易把正常缓存误判为泄漏。

---

## 四、场景三：Widget 重构与大页面瘦身

适用：遗留页面过大、状态边界混乱、一次改动导致大量 Widget 重建。

推荐流程：

```text
start_diagnostic_session(problemType="refactor")
runtime_health_check(sessionId, observationRole="baseline")
get_widget_tree(projectOnly=true, maxDepth=20)
start_tracking_rebuilds
执行核心交互
stop_tracking_rebuilds(sessionId, observationRole="baseline", observationLabel="before refactor")
按树结构拆分 Widget
hot_reload
start_tracking_rebuilds
执行同一交互
stop_tracking_rebuilds(sessionId, observationRole="verification", observationLabel="after refactor")
compare_diagnostic_runs(sessionId)
```

判断重点：

1. 直接子节点过多的 Widget 是拆分候选。
2. 深度过深的分支优先检查布局职责是否混杂。
3. 重建次数高但视觉不变的区域，应抽成更小的监听边界。
4. 重构后必须用 rebuild count 验证，不要只看代码结构变“更漂亮”。

---

## 五、场景四：网络请求慢、失败或响应过大

适用：下拉刷新慢、接口偶发失败、页面首屏等待过长、响应体异常膨胀。

推荐流程：

```text
start_diagnostic_session(problemType="network")
runtime_health_check(sessionId, observationRole="baseline")
start_network_capture(includeHeaders=false)
触发网络动作
stop_network_capture(sortBy="duration" 或 "size")
record_diagnostic_observation(sessionId, sourceTool="stop_network_capture", role="observation")
修改网络层或并发策略
hot_reload
重复网络采集
record_diagnostic_observation(sessionId, sourceTool="stop_network_capture", role="verification")
```

判断重点：

1. 慢请求看 duration，响应过大看 size，失败请求看 status/error。
2. 多个独立接口串行返回时，优先改成并发，例如 `Future.wait()`。
3. 大响应体优先推动分页、字段裁剪或懒加载。
4. 如果报告显示无请求，不要立刻判定没有网络行为。当前 VM Service 主要观察 `dart:io` 和 Timeline 中可见的 HTTP-like 事件，WebView、native SDK、platform channel、部分自定义 client 可能不可见。

---

## 六、场景五：布局错位、Overflow 与视觉回归

适用：元素错位、越界、尺寸不符合预期、修复后需要视觉确认。

推荐流程：

```text
start_diagnostic_session(problemType="layout")
runtime_health_check(sessionId, observationRole="baseline")
get_widget_tree(projectOnly=true)
toggle_debug_paint
take_screenshot(savePath="before.png")
inspect_widget(widgetId)
修改布局代码
hot_reload
take_screenshot(savePath="after.png")
compare_screenshots(beforePath="before.png", afterPath="after.png")
runtime_health_check(sessionId, observationRole="verification")
compare_diagnostic_runs(sessionId)
```

判断重点：

1. 先通过 Widget Tree 找到可疑节点，再用 screenshot 观察真实屏幕。
2. Overflow 类问题重点检查约束链，不要只加 `Expanded` 或 `SingleChildScrollView` 掩盖问题。
3. 修复前后截图要保存为文件，便于报告引用和视觉复核。

---

## 七、场景六：长时间运行监控

适用：偶发卡顿、偶发异常、GC 压力、运行一段时间后才出现的问题。

推荐流程：

```text
connect(autoReconnect=true)
start_diagnostic_session(problemType="runtime-monitoring")
runtime_health_check(sessionId, observationRole="baseline")
start_monitoring
持续使用 App 或执行自动化场景
get_monitoring_status
必要时读取 flutter://monitoring/status
stop_monitoring
record_diagnostic_observation(sessionId, sourceTool="stop_monitoring", role="observation")
```

监控会通过 MCP logging notification 向 Agent 反馈 jank、GC 压力、异常和断连。自动重连打开时，短暂 VM Service 断开不应立即终止诊断；先读取 `flutter://connection/status` 判断是否已经恢复。

---

## 八、Agent 操作准则

1. **先证据，后修改**：没有运行时证据时，只能称为静态推断。
2. **同一动作复现两次**：before 和 after 必须执行同一交互路径，否则对比结论不可靠。
3. **核心工具都带 sessionId**：能自动写入 session 的工具必须传 `sessionId`。
4. **文本报告给人看，finding 给 Agent 用**：排序和验证以结构化 finding 的 metric 为准。
5. **断连先看状态资源**：读 `flutter://connection/status`，必要时调用 `reconnect`。
6. **复测失败要记录**：失败也是证据，应写入 session，避免下一轮重复踩同一条件。
7. **结束时导出报告**：问题修复或暂停时使用 `export_report` 输出 Markdown/HTML，保留基线、发现、修复建议和复测结论。

---

## 九、最小推荐 Prompt

可以直接让 IDE AI Agent 执行：

```text
请使用 flutter-devtools-mcp 排查这个 Flutter 问题。
先 start_diagnostic_session，再 connect 并保持 autoReconnect=true。
先运行 runtime_health_check 作为 baseline。
根据 finding 选择 profiling、rebuild、memory、network 或 screenshot 工具。
修改代码后 hot_reload，并用相同工具以 observationRole=verification 复测。
最后 compare_diagnostic_runs，只有指标改善才给出完成结论。
```

核心原则：让 Agent 从“读代码后猜测”转为“采集证据、定位原因、修改代码、复测验证”。这才是运行时调试代理相对普通代码助手的真正价值。
