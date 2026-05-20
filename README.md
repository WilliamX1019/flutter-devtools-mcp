# flutter-devtools-mcp

**Give AI agents the power to inspect, profile, and debug your Flutter apps at runtime.**

An MCP (Model Context Protocol) server that connects AI coding assistants like **Cursor**, **Claude Code**, **Windsurf**, **GitHub Copilot**, and **Codex** to running Flutter applications through the Dart VM Service Protocol.

Instead of switching between your IDE and DevTools, just tell your AI assistant:

> *"Find my running Flutter app and connect to it"*
>
> *"Track widget rebuilds while I scroll through the feed"*
>
> *"Take a memory snapshot, I'll fix the leak, then compare"*

```
┌─────────────────┐     stdio      ┌──────────────────────┐   WebSocket    ┌─────────────────┐
│  AI Agent        │◄──────────────►│  flutter-devtools-mcp │◄─────────────►│  Flutter App     │
│  (Cursor/Claude) │                │  (MCP Server)         │  VM Service   │  (--profile)     │
└─────────────────┘                └──────────────────────┘               └─────────────────┘
```

## Features

### Auto-Discovery
- Automatically find running Flutter apps on your machine
- No manual URI copying — just say "connect to my Flutter app"
- Scans processes, temp files, and common ports
- Connection state machine with automatic reconnect for long-running diagnostics

### Diagnostic Sessions
- Group runtime health, profiling, rebuild, memory, network, and verification evidence into one investigation
- Core tools can write directly into a diagnostic session with `sessionId`
- Compare before/after observations to verify whether a fix actually improved runtime behavior

### Widget Tree Inspection
- Get the complete widget hierarchy of any screen with source file locations
- Filter to show only your project's widgets (skip framework internals)
- Deep-inspect individual widgets for constraints, size, and state
- Recursively expands the full tree, not just the first level

### Widget Rebuild Tracking
- Track exactly which widgets rebuild and how many times
- Source file and line number for every rebuilding widget
- Severity-rated output (green/yellow/orange/red)
- Actionable recommendations for reducing unnecessary rebuilds

### Performance Profiling
- Start/stop profiling sessions while you interact with the app
- Frame-by-frame analysis with jank detection
- CPU hotspot identification with severity ratings
- Build/Layout/Paint phase breakdown
- AI-generated recommendations for fixing performance issues

### Memory Analysis
- Heap usage overview with utilization percentage
- App & framework classes separated from VM internals
- Automatic detection of suspicious allocation patterns
- Optional forced GC before snapshot for accuracy

### Snapshot Comparison (Before/After Diff)
- Save named memory snapshots at any point
- Compare two snapshots to see exactly what changed
- Shows which classes grew/shrank with byte and instance deltas
- Verdict: did your fix actually improve memory?

### Network Traffic Inspector
- Capture HTTP requests and responses in real-time
- Method, URL, status code, response time, payload size
- Flags slow requests (>2s) and large responses (>500KB)
- Error tracking for failed requests
- **Note:** Relies on `dart:io` HttpClient timeline events. May not capture traffic from some GraphQL clients (Ferry, gql_http_link) or custom HTTP implementations that bypass `dart:io` instrumentation.

### Debug Actions
- **Hot Reload** — inject code changes without losing state
- **Hot Restart** — full restart without rebuilding
- **Screenshot** — capture the current screen
- **Debug Paint** — toggle widget boundary visualization
- **Expression Evaluation** — run Dart expressions in the live app

### Runtime Diagnostics Demo
- Reproducible scenarios for rebuild, memory, shader, network, layout, and report validation
- See [`examples/runtime_diagnostics_demo`](examples/runtime_diagnostics_demo) for run steps and expected findings

## Quick Start

### Prerequisites

- Node.js >= 18
- A Flutter app running in **debug** or **profile** mode

### Installation

Clone and build locally:

```bash
git clone https://github.com/draganbajic/flutter-devtools-mcp.git
cd flutter-devtools-mcp
npm install
npm run build
```

### Configuration

#### Cursor

Add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "flutter-devtools": {
      "command": "node",
      "args": ["/path/to/flutter-devtools-mcp/dist/index.js"]
    }
  }
}
```

#### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "flutter-devtools": {
      "command": "node",
      "args": ["/path/to/flutter-devtools-mcp/dist/index.js"]
    }
  }
}
```

#### VS Code (GitHub Copilot)

Add to your `.vscode/mcp.json`:

```json
{
  "servers": {
    "flutter-devtools": {
      "command": "node",
      "args": ["/path/to/flutter-devtools-mcp/dist/index.js"]
    }
  }
}
```

#### Codex

You can add the MCP server using the Codex CLI:

```bash
codex mcp add flutter-devtools -- node /path/to/flutter-devtools-mcp/dist/index.js
```

Or manually configure it by adding to your `~/.codex/config.toml` (or project-level `.codex/config.toml`):

```toml
[mcp_servers.flutter-devtools]
command = "node"
args = ["/path/to/flutter-devtools-mcp/dist/index.js"]
enabled = true
```

### Usage

1. **Start your Flutter app** in debug or profile mode:

```bash
flutter run --profile
```

2. **Ask your AI agent to discover and connect:**

> "Find my running Flutter app and connect to it"

Or connect manually with the VM Service URI printed in the terminal:

> "Connect to my Flutter app at http://127.0.0.1:50000/AbCdEf=/"

3. **Create a runtime baseline first:**

> "Run a Flutter runtime health check"

This gives the agent a compact view of VM state, available Flutter service
extensions, shallow widget coverage, memory pressure, and the best next tools
to call.

4. **Start targeted diagnostics:**

> "Show me the widget tree for project widgets"

> "Track widget rebuilds while I scroll through the list"

> "Take a memory snapshot before I make changes"

> "Start profiling, I'll navigate around... okay stop"

> "Capture network traffic while I pull to refresh"

5. **Verify the fix after editing:**

> "Hot reload, then rerun the same diagnostic check and compare with the baseline"

For a fully tracked investigation, first create a diagnostic session and pass its
`sessionId` to `runtime_health_check`, `stop_profiling`, or
`stop_tracking_rebuilds`. Use `observationRole: "baseline"` before the fix and
`observationRole: "verification"` after hot reload.

For a Chinese end-to-end workflow guide covering reconnect, diagnostic sessions,
baseline capture, targeted tools, and before/after verification, see
[`BEST_PRACTICES_ZH.md`](BEST_PRACTICES_ZH.md).

For the current data relationship flow between the IDE Agent, MCP server, and
running Flutter project, see
[`ARCHITECTURE_FLOW_ZH.md`](ARCHITECTURE_FLOW_ZH.md). Keep this diagram updated
whenever the MCP data flow changes.

## Tools Reference (33 tools)

### Discovery & Connection
| Tool | Description |
|------|-------------|
| `discover_apps` | Auto-find running Flutter apps and connect |
| `connect` | Connect to a Flutter app via VM Service URI with optional automatic reconnect |
| `reconnect` | Reconnect to the last known VM Service URI |
| `disconnect` | Disconnect from the app |
| `get_app_info` | VM info, isolates, platform details, extensions |
| `runtime_health_check` | Agent-oriented runtime baseline and recommended next diagnostic steps |

### Widget Inspection
| Tool | Description |
|------|-------------|
| `get_widget_tree` | Widget hierarchy with source locations and project filtering |
| `inspect_widget` | Deep-inspect a widget's properties, constraints, render info |

### Rebuild Tracking
| Tool | Description |
|------|-------------|
| `start_tracking_rebuilds` | Start tracking which widgets rebuild |
| `stop_tracking_rebuilds` | Get report: widget name, rebuild count, source location |

### Performance Profiling
| Tool | Description |
|------|-------------|
| `start_profiling` | Begin timeline profiling session |
| `stop_profiling` | Get analysis: frames, jank, hotspots, phase breakdown |

### Memory Analysis
| Tool | Description |
|------|-------------|
| `get_memory_snapshot` | Heap profile with app class breakdown and leak detection |
| `save_snapshot` | Save a named snapshot for later comparison |
| `compare_snapshots` | Diff two snapshots: what grew, what shrank, verdict |
| `list_snapshots` | List all saved snapshots |

### Network
| Tool | Description |
|------|-------------|
| `start_network_capture` | Start capturing HTTP traffic, optionally including headers |
| `stop_network_capture` | Report: URLs, status codes, timing, sizes, errors |

### Runtime Monitoring
| Tool | Description |
|------|-------------|
| `start_monitoring` | Start continuous alerts for jank, GC, exceptions, and disconnects |
| `get_monitoring_status` | Read retained monitoring alerts and trend counts |
| `stop_monitoring` | Stop monitoring and return the alert summary |

### Diagnostic Reports
| Tool | Description |
|------|-------------|
| `export_report` | Export a diagnostic session as Markdown or HTML |

### Debug Actions
| Tool | Description |
|------|-------------|
| `hot_reload` | Trigger hot reload |
| `hot_restart` | Trigger hot restart |
| `take_screenshot` | Capture current screen as PNG, optionally saving to disk |
| `compare_screenshots` | Compare saved before/after screenshots |
| `toggle_debug_paint` | Toggle debug paint overlay |
| `evaluate_expression` | Evaluate Dart expressions in the running app |

## Example Output

### Widget Rebuild Report

```
═══════════════════════════════════════════════════════════
  WIDGET REBUILD REPORT
═══════════════════════════════════════════════════════════

📊 SUMMARY
───────────────────────────────────────────────────────────
Tracked for 6.2s
Total rebuilds: 1,847
Unique widgets rebuilt: 34
Average rebuilds per widget: 54.3

🔥 TOP REBUILDING WIDGETS
───────────────────────────────────────────────────────────
🔴    312x | OrderCard [order_card.dart:15]
🔴    287x | Text [order_card.dart:43]
🔴    284x | StatusBadge [order_card.dart:48]
🟠     94x | SummaryCard [summary_card.dart:11]
🟠     74x | DashboardScreen [dashboard_screen.dart:18]
🟡     28x | SliverAppBar [dashboard_screen.dart:58]
🟢      4x | Navigator [app_router.dart:31]

💡 RECOMMENDATIONS
───────────────────────────────────────────────────────────
• OrderCard rebuilt 312x [order_card.dart:15]
  → Check if it depends on a Provider that changes too
    frequently. Consider using context.select() instead
    of context.watch() or adding a const constructor.
```

### Snapshot Comparison

```
═══════════════════════════════════════════════════════════
  SNAPSHOT COMPARISON
  "before-fix" → "after-fix"
═══════════════════════════════════════════════════════════

📊 HEAP OVERVIEW
───────────────────────────────────────────────────────────
🟢 Heap usage: 182.84 MB → 94.12 MB (-88.72 MB, -48.5%)
   Capacity:   199.52 MB → 128.00 MB (-71.52 MB)

📉 SHRANK (top 5)
───────────────────────────────────────────────────────────
  🔻  -42.30 MB |   -3,412 inst | _Uint8List
  🔻  -18.20 MB |     -847 inst | _ImageInfo
  🔻   -6.40 MB |     -624 inst | StreamSubscription

💡 VERDICT
───────────────────────────────────────────────────────────
✅ Memory improved by 88.72 MB (-48.5%). Nice work!
```

### Performance Profiling

```
═══════════════════════════════════════════════════════════
  FLUTTER PERFORMANCE ANALYSIS REPORT
═══════════════════════════════════════════════════════════

📊 SUMMARY
───────────────────────────────────────────────────────────
Profiled for 8.0s, captured 481 frames
Average frame time: 8.94ms (target: 16.7ms)
⚠️ 38 janky frames detected (7.9% of total)
Worst frame: 94.32ms (5.6x target)

🔧 PHASE BREAKDOWN
───────────────────────────────────────────────────────────
Build:  avg 3.12ms | max 38.40ms | 962 calls
Layout: avg 1.94ms | max 22.10ms | 481 calls
Paint:  avg 2.08ms | max 14.80ms | 481 calls

🔥 CPU HOTSPOTS
───────────────────────────────────────────────────────────
🔴 Build [CRITICAL]
   Total: 3001.4ms | Avg: 3.1ms | Max: 38.4ms | Calls: 962

💡 RECOMMENDATIONS
───────────────────────────────────────────────────────────
• HIGH: Excessive widget rebuilds detected (962 builds for
  481 frames). Check for unnecessary setState calls, missing
  const widgets, or improper use of context.watch().
```

### Widget Tree

```
Widget Tree (68 widgets, 42 from project, depth: 18)
────────────────────────────────────────────────────────────
RootWidget (1 children)
  MyApp ★ (1 children) [main.dart:12]
    MaterialApp ★ (1 children) [app.dart:45]
      Navigator ★ (2 children) [app_router.dart:31]
        DashboardScreen ★ (1 children) [dashboard_screen.dart:18]
          Scaffold ★ (2 children) [dashboard_screen.dart:42]
            CustomScrollView ★ (3 children) [dashboard_screen.dart:56]
              SliverList ★ (1 children) [dashboard_screen.dart:71]
                OrderCard ★ (2 children) [order_card.dart:15]
                  Row ★ (3 children) [order_card.dart:34]
                    CachedNetworkImage ★ [order_card.dart:36]
                    Text ★ [order_card.dart:43]
                    StatusBadge ★ [order_card.dart:48]
            BottomNavigationBar ★ (4 children) [dashboard_screen.dart:95]
```

## Profile Mode vs Debug Mode

For accurate performance numbers, always use profile mode:

```bash
flutter run --profile
```

Debug mode includes overhead from assertions and debug checks that make performance appear worse than reality. The MCP server works in both modes, but profiling data from debug mode should be taken with a grain of salt.

## How It Works

This MCP server communicates with your Flutter app through the **Dart VM Service Protocol** — the same protocol that Flutter DevTools uses under the hood. When you run a Flutter app in debug or profile mode, it exposes a WebSocket endpoint that supports JSON-RPC 2.0 commands for:

- Isolate management and inspection
- Widget tree traversal (via Flutter service extensions)
- Widget rebuild tracking (`trackRebuildDirtyWidgets`)
- Timeline and CPU profiling
- Memory allocation tracking
- HTTP traffic logging
- Code evaluation
- Hot reload / restart

The MCP server wraps these low-level protocol calls into AI-agent-friendly tools with structured output, severity ratings, and actionable recommendations — so the AI can reason about your app's runtime behavior and suggest concrete fixes.

## 🎓 Developer Learning Guide

If you are new to the codebase or want to understand how the MCP Server communicates with the Dart VM under the hood, check out our **[Interactive Learning Guide](file:///Users/yunlong/Desktop/github/flutter-devtools-mcp/docs/interactive_learning_guide.md)**. 

This guide covers:
- **Concept Primer**: MCP and Dart VM Service Protocol.
- **Code Walkthrough**: Deep dive into `vm-service-client.ts` and its Promise-based async bridge.
- **Interactive Quiz**: 5 self-assessment quiz cards to test your understanding.
- **Developer Lab**: How to inspect and call tools using the official `MCP Inspector`.
- **Extension Guide**: Step-by-step tutorial on adding a new debugging tool.

## Roadmap

- [x] Auto-discover running Flutter apps
- [x] Widget rebuild tracking with source locations
- [x] Network traffic inspection
- [x] Before/after snapshot comparison
- [x] Continuous monitoring mode (watch for jank in real-time)
- [x] Automatic reconnect after unexpected VM Service disconnects
- [x] Automatic diagnostic session recording for core runtime tools
- [x] Shader compilation jank detection
- [x] Export reports as markdown/HTML
- [ ] Integration test runner with performance baselines
- [ ] npm publish for `npx flutter-devtools-mcp`

## Contributing

Contributions are welcome! Please open an issue or PR.

## License

MIT
