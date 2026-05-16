# Flutter DevTools MCP 最佳实践指南

在使用 `flutter-devtools-mcp` 对 Flutter 应用进行性能诊断、调试和优化时，单独使用某个工具往往只能看到问题的“冰山一角”。为了充分发挥 AI 辅助排查的优势，建议根据具体的开发场景，**组合使用**多个工具。

本指南梳理了 5 种最常见的开发场景，并提供了推荐的工具组合与标准化排查流程。

---

## 通用入口：先建立运行时基线

任何专项诊断之前，建议先让 AI Agent 执行：

`discover_apps` 或 `connect` ➡️ `runtime_health_check`

`runtime_health_check` 的作用不是替代专项工具，而是帮助 Agent 快速判断：

1. 当前是否已经连接到正确的 Flutter VM Service。
2. 主 Isolate 是否处于可采集状态。
3. Flutter Inspector、重建追踪、Hot Reload、截图等扩展是否可用。
4. 当前页面是否能采集到项目 Widget。
5. 是否已经出现明显的内存压力。
6. 下一步应该进入 Widget、Rebuild、Profiling、Memory 还是 Network 诊断。

如果你希望 Agent 在改代码后验证修复效果，使用 `mode: "deep"` 建立更完整的基线。修复后再执行同样的工具组合，比较前后输出，而不是只依赖静态代码判断。

---

## 场景一：UI 卡顿与滑动掉帧 (UI Jank & Dropped Frames)

当你在滑动列表或切换页面时感觉到肉眼可见的卡顿（帧率低于目标刷新率）。

**🔧 推荐工具组合：**
`runtime_health_check` ➡️ `start_profiling` ➡️ `stop_profiling` ➡️ `start_tracking_rebuilds` ➡️ `stop_tracking_rebuilds`

**📋 最佳实践步骤：**
1. **宏观把脉**：确保 App 处于 Profile 模式。调用 `start_profiling` 开始录制，执行卡顿操作后，调用 `stop_profiling`。
2. **分析阶段耗时**：查看报告中的 `Phase Breakdown`（阶段细分）：
   - 如果 **Build** 时间过长：说明构建逻辑太重。通常是因为非必要 Widget 重建。
   - 如果 **Layout** 时间过长：说明布局约束过于复杂，可能存在深层级的嵌套或昂贵的内在尺寸计算（Intrinsic dimensions）。
   - 如果 **Paint** 时间过长：说明绘制过于复杂，可能滥用了阴影、裁剪（Clip）或图层混合（Opacity）。
   - 查看 **CPU Hotspots**，看是哪个具体的 Dart 方法占用了大量 CPU 时间。
3. **微观定位（针对 Build 过长）**：如果诊断出是 Build 问题，立即使用 `start_tracking_rebuilds`，再次执行卡顿操作，然后 `stop_tracking_rebuilds`。
4. **实施修复**：根据 Rebuild Tracker 输出的具体文件路径和行号（如 `[home_page.dart:45]` 重建了 200 次），让 AI 定位到该文件，通过抽离组件、补充 `const` 或将 `context.watch()` 改为 `context.select()` 进行修复。

---

## 场景二：内存泄漏与 OOM 风险排查 (Memory Leaks)

应用长时间运行后越来越卡，或者由于内存激增（Out of Memory）导致崩溃崩溃。

**🔧 推荐工具组合：**
`runtime_health_check` (`mode: "deep"`) ➡️ `save_snapshot` (baseline) ➡️ 页面反复进退 ➡️ `save_snapshot` (after) ➡️ `compare_snapshots`

**📋 最佳实践步骤：**
1. **设置基准线 (Baseline)**：在 App 刚启动并静止时，调用 `save_snapshot`（例如命名为 `baseline`），记得将 `forceGC` 设为 `true` 以排除游离垃圾。
2. **复现动作**：在涉嫌泄漏的页面反复进入、退出数次。
3. **抓取差异 (After)**：回到上一个安全页面，再次调用 `save_snapshot`（例如命名为 `after-test`）。
4. **对比分析**：调用 `compare_snapshots`，传入 `baseline` 和 `after-test`。
5. **定位泄漏源**：在输出的对比报告中，重点观察 **“📈 GREW (top 10)”** 区域。如果你的业务层类（如 `VideoPlayerController` 或某个 `State` 类）的 Instances（实例数）不断增加而不减少，说明发生了明确的内存泄漏。让 AI 重点检查对应类的 `dispose()` 方法，查看是否有未取消的监听器 (Listeners)、定时器 (Timers) 或动画控制器。

---

## 场景三：复杂页面重构与“巨神”组件瘦身 (Page Refactoring)

接手了一个遗留代码，某个页面非常臃肿（几千行代码），牵一发而动全身。

**🔧 推荐工具组合：**
`runtime_health_check` ➡️ `get_widget_tree` ➡️ `inspect_widget` ➡️ 代码编辑 ➡️ `hot_reload` ➡️ `runtime_health_check`

**📋 最佳实践步骤：**
1. **获取树状结构**：打开需要重构的页面，调用 `get_widget_tree`（设置 `projectOnly: true`）。
2. **识别“坏味道”**：
   - 查看 **深度 (Depth)**：如果某些分支深度超过 15 层，说明存在嵌套地狱。
   - 查看 **子节点数 (Child Count)**：如果某个 Widget 直接挂载了几十个组件，说明该页面没有进行合理的模块化拆分（上帝组件）。
3. **针对性拆分**：根据返回的文件行号映射，让 AI 将树状图中臃肿的部分拆分成多个独立、内聚的小 Widget 类。
4. **热重载验证**：修改完成后，直接调用 `hot_reload` 验证 UI 表现是否正常，无需重新编译。

---

## 场景四：网络请求缓慢与接口异常定位 (Network Troubleshooting)

拉取数据缓慢，或者疑似接口报错，需要查看真实的请求耗时和报文大小。

**🔧 推荐工具组合：**
`runtime_health_check` ➡️ `start_network_capture` ➡️ `stop_network_capture`

**📋 最佳实践步骤：**
1. **开启抓包**：调用 `start_network_capture` 开始监控底层网络流水。
2. **触发动作**：在 App 中触发相关的 API 拉取动作（如下拉刷新）。
3. **停止并排序输出**：调用 `stop_network_capture`。
   - 如果怀疑拉取的数据太大：将参数 `sortBy` 设置为 `"size"`。
   - 如果怀疑接口响应太慢：将参数 `sortBy` 设置为 `"duration"`。
4. **深度分析**：
   - 检查是否有**串行**引发的瀑布流请求（后一个请求非得等前一个请求完才发）。如果有，建议 AI 将其重构为 `Future.wait()` 并发请求。
   - 检查 Response Size，如果拉取了数 MB 的数据，可能需要和后端沟通增加分页或字段裁剪。
   - 检查报错的 Status Code，让 AI 直接根据报错原因修改相关网络解析层代码。

---

## 场景五：UI 错位排查与运行时状态窥探 (Visual Debugging & State Inspection)

页面元素越界（Overflow）、约束错误，或者想要知道此时某个全局单例/静态变量的真实值，不想重新编译打断点。

**🔧 推荐工具组合：**
`runtime_health_check` ➡️ `toggle_debug_paint` ➡️ `take_screenshot` ➡️ `evaluate_expression`

**📋 最佳实践步骤：**
1. **看清约束**：调用 `toggle_debug_paint`，这会在整个屏幕上画出所有的 Widget 边界、边距和对齐指引线。
2. **视觉抓取**：调用 `take_screenshot`，让 AI 通过图像直接看到发生越界的 UI 部分以及各种辅助线的状态。
3. **免断点探针**：想知道特定变量为什么不对？调用 `evaluate_expression`。你可以动态输入表达式，如 `UserManager.instance.currentUser?.id` 或 `MediaQuery.of(context).size.width`，VM 会立刻返回当前的运行时数值，而不用插一条 `print` 然后傻傻等待重启。

---

**核心秘诀**：MCP 工具本质上是你（开发者）与底层 Dart VM 之间的桥梁。遇到问题时，**“先建立运行时基线（runtime_health_check），再宏观定性（Profiling/Snapshot），再微观定点（Rebuild Tracker/Tree/Evaluate），最后实施代码修改并复测”** 是让 IDE AI Agent 真正形成调试闭环的关键。
