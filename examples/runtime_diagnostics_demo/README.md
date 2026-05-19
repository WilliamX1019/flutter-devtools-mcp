# Runtime Diagnostics Demo

这个示例用于校准 `flutter-devtools-mcp` 的端到端诊断闭环：

```text
运行示例 -> start_diagnostic_session -> runtime_health_check
-> 采集专项证据 -> 修复或切换 Fixed mode -> hot_reload
-> 复测 -> compare_diagnostic_runs -> export_report
```

示例只提交 Dart/Flutter 源码和 `pubspec.yaml`，不提交平台壳。首次运行时在本目录生成平台文件：

```bash
flutter create . --platforms=macos,linux
flutter pub get
flutter run -d macos --profile
```

连接 MCP：

```text
discover_apps -> connect -> runtime_health_check
```

## 场景矩阵

| 场景 | 复现步骤 | 预期工具 | 预期 finding / 证据 | 修复验证 |
|---|---|---|---|---|
| 过度 rebuild | 关闭 Fixed mode，进入 Excessive rebuilds，停留并滚动列表 5-10 秒 | `start_tracking_rebuilds` -> `stop_tracking_rebuilds` | `rebuildCount` 高，列表行或页面频繁重建 | 打开 Fixed mode，hot reload，重复采集，`compare_diagnostic_runs` 应显示 rebuild 指标下降 |
| 未 dispose controller | 关闭 Fixed mode，反复进入并返回 Leaky controller 5 次 | `save_snapshot` before/after -> `compare_snapshots` | `TextEditingController` 或相关对象实例增长 | 打开 Fixed mode，重复导航和快照，增长应消失或显著下降 |
| 首帧 shader jank | 关闭 Fixed mode，进入 Shader jank，点击 Trigger paint | `start_profiling` -> `stop_profiling` | `shader-compilation-jank` 或 shader / renderer pipeline 区域出现高耗时事件 | 打开 Fixed mode，重复 profiling，shader 区域耗时下降 |
| 大图片/大对象内存压力 | 关闭 Fixed mode，进入 Memory pressure，多次点击 Allocate 8 MB | `runtime_health_check mode=deep`、`save_snapshot`、`compare_snapshots` | heap usage、large typed data 或 retained buffers 增长 | 点击 Clear retained buffers 或打开 Fixed mode，复测 heap delta |
| 慢网络 / 大响应体 | 关闭 Fixed mode，进入 Slow network，点击 Simulate request | `start_network_capture` -> `stop_network_capture sortBy=duration` | dart:io / timeline HTTP 请求耗时高；报告包含 coverage note | 打开 Fixed mode，重复请求，duration 应下降 |
| 布局 overflow | 关闭 Fixed mode，进入 Layout overflow，并缩窄窗口 | `take_screenshot savePath=...`，必要时 `toggle_debug_paint` | 截图可见溢出或 debug paint 边界异常 | 打开 Fixed mode，hot reload，保存 after 截图并 `compare_screenshots` |

## 推荐回归脚本

1. 运行 app 并连接 VM Service。
2. 创建 session：`start_diagnostic_session(problemType=<scenario>)`。
3. 记录 baseline：`runtime_health_check` 后用 `record_diagnostic_observation(role=baseline)`。
4. 执行场景对应工具，把 structured findings 记录到 session。
5. 打开 Fixed mode 或修改代码，执行 `hot_reload`。
6. 重复同一组工具并记录 `role=verification`。
7. 调用 `compare_diagnostic_runs`。
8. 调用 `export_report(format=markdown)`。

## 能力边界

- `Slow network` 使用 `dart:io` `HttpClient`，适合 macOS/Linux profile 调试；不面向 Web。
- Shader 事件是否出现取决于 Flutter engine、渲染后端和设备缓存状态。首次运行或清缓存后更容易复现。
- Memory 场景依赖 VM heap snapshot，可用 `forceGC=true` 降低噪音。
- Layout 场景建议配合 `take_screenshot savePath` 做 before/after 视觉证据。
