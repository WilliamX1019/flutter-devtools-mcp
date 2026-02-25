# flutter-devtools-mcp

**Give AI agents the power to inspect, profile, and debug your Flutter apps at runtime.**

An MCP (Model Context Protocol) server that connects AI coding assistants like **Cursor**, **Claude Code**, **Windsurf**, and **GitHub Copilot** to running Flutter applications through the Dart VM Service Protocol.

Instead of switching between your IDE and DevTools, just tell your AI assistant:

> *"Profile my app while I scroll through the feed"*
>
> *"Show me the widget tree for the current screen"*
>
> *"Take a memory snapshot and find potential leaks"*

```
┌─────────────────┐     stdio      ┌──────────────────────┐   WebSocket    ┌─────────────────┐
│  AI Agent        │◄──────────────►│  flutter-devtools-mcp │◄─────────────►│  Flutter App     │
│  (Cursor/Claude) │                │  (MCP Server)         │  VM Service   │  (--profile)     │
└─────────────────┘                └──────────────────────┘               └─────────────────┘
```

## Features

### Widget Tree Inspection
- Get the complete widget hierarchy of any screen
- Filter to show only your project's widgets (skip framework internals)
- Deep-inspect individual widgets for constraints, size, and state

### Performance Profiling
- Start/stop profiling sessions while you interact with the app
- Frame-by-frame analysis with jank detection
- CPU hotspot identification with severity ratings
- Build/Layout/Paint phase breakdown
- AI-generated recommendations for fixing performance issues

### Memory Analysis
- Heap usage overview with utilization percentage
- Top memory-consuming classes ranked by size and instance count
- Automatic detection of suspicious allocation patterns
- Optional forced GC before snapshot for accuracy

### Debug Actions
- **Hot Reload** - inject code changes without losing state
- **Hot Restart** - full restart without rebuilding
- **Screenshot** - capture the current screen
- **Debug Paint** - toggle widget boundary visualization
- **Expression Evaluation** - run Dart expressions in the live app

## Quick Start

### Prerequisites

- Node.js >= 18
- A Flutter app running in **debug** or **profile** mode

### Installation

```bash
npm install -g flutter-devtools-mcp
```

Or run directly with npx:

```bash
npx flutter-devtools-mcp
```

### Configuration

#### Cursor

Add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "flutter-devtools": {
      "command": "npx",
      "args": ["-y", "flutter-devtools-mcp"]
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
      "command": "npx",
      "args": ["-y", "flutter-devtools-mcp"]
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
      "command": "npx",
      "args": ["-y", "flutter-devtools-mcp"]
    }
  }
}
```

### Usage

1. **Start your Flutter app** in debug or profile mode:

```bash
flutter run --profile
```

2. **Copy the VM Service URI** from the terminal output:

```
Flutter DevTools debugging and profiling for MyApp is available at:
http://127.0.0.1:9100?uri=http%3A%2F%2F127.0.0.1%3A50000%2FAbCdEf%3D%2F
                                        ^
                   Copy this URI: http://127.0.0.1:50000/AbCdEf=/
```

3. **Ask your AI agent to connect:**

> "Connect to my Flutter app at http://127.0.0.1:50000/AbCdEf=/"

4. **Start inspecting and profiling:**

> "Show me the widget tree"

> "Start profiling, I'll scroll through the list... okay stop profiling"

> "Take a memory snapshot and check for leaks"

> "Hot reload the app"

## Tools Reference

| Tool | Description |
|------|-------------|
| `connect` | Connect to a running Flutter app via VM Service URI |
| `disconnect` | Disconnect from the app |
| `get_app_info` | Get VM info, isolates, platform details, available extensions |
| `get_widget_tree` | Get structured widget hierarchy with project widget highlighting |
| `inspect_widget` | Deep-inspect a widget's properties, constraints, and render info |
| `start_profiling` | Begin a performance profiling session |
| `stop_profiling` | End profiling and get full analysis with recommendations |
| `get_memory_snapshot` | Memory allocation profile with leak detection |
| `take_screenshot` | Capture current screen as PNG |
| `toggle_debug_paint` | Toggle debug paint overlay |
| `hot_reload` | Trigger hot reload |
| `hot_restart` | Trigger hot restart |
| `evaluate_expression` | Evaluate Dart expressions in the running app |

## Example Output

### Performance Profiling Report

```
═══════════════════════════════════════════════════════════
  FLUTTER PERFORMANCE ANALYSIS REPORT
═══════════════════════════════════════════════════════════

📊 SUMMARY
───────────────────────────────────────────────────────────
Profiled for 4.8s, captured 287 frames
Average frame time: 9.12ms (target: 16.7ms)
⚠️ 18 janky frames detected (6.3% of total)
Worst frame: 67.45ms (4.0x target)

📈 FRAME ANALYSIS
───────────────────────────────────────────────────────────
P90 frame time: 14.20ms
P99 frame time: 52.88ms

🔧 PHASE BREAKDOWN
───────────────────────────────────────────────────────────
Build:  avg 3.41ms | max 41.20ms | 574 calls
Layout: avg 1.87ms | max 19.30ms | 287 calls
Paint:  avg 2.14ms | max 11.05ms | 287 calls

🔥 CPU HOTSPOTS
───────────────────────────────────────────────────────────
🔴 Build [CRITICAL]
   Total: 1956.2ms | Avg: 3.4ms | Max: 41.2ms | Calls: 574
🟠 LayoutBuilder [HIGH]
   Total: 312.5ms | Avg: 5.2ms | Max: 28.7ms | Calls: 60

💡 RECOMMENDATIONS
───────────────────────────────────────────────────────────
• HIGH: Excessive widget rebuilds detected (574 builds for
  287 frames). Check for unnecessary setState calls, missing
  const widgets, or improper use of context.watch().
• HIGH: Build phase exceeds frame budget. Consider using const
  constructors, breaking up large widget trees, or using
  RepaintBoundary.
```

### Memory Snapshot

```
═══════════════════════════════════════════════════════════
  MEMORY SNAPSHOT
═══════════════════════════════════════════════════════════

📊 HEAP OVERVIEW
───────────────────────────────────────────────────────────
Heap used:     48.72 MB
Heap capacity: 64.00 MB
Utilization:   76.1%
External:      12.34 MB
Total:         61.06 MB

📦 TOP 10 CLASSES BY MEMORY
───────────────────────────────────────────────────────────
   18.40 MB (37.8%) |    3,412 instances | _Uint8List
    6.21 MB (12.7%) |      847 instances | _ImageInfo
    3.88 MB  (8.0%) |   28,440 instances | _OneByteString
    2.14 MB  (4.4%) |    1,205 instances | RenderParagraph
    1.92 MB  (3.9%) |      960 instances | Element

⚠️ POTENTIAL CONCERNS
───────────────────────────────────────────────────────────
• _ImageInfo: 847 instances (6.21 MB) - check if images are
  being disposed properly when scrolling off-screen
• RenderParagraph: 1,205 instances (2.14 MB) - large number
  of text widgets in memory, verify ListView is using
  itemBuilder for lazy construction
```

### Widget Tree

```
Widget Tree (142 widgets, 23 from project, depth: 12)
────────────────────────────────────────────────────────────
MaterialApp
  Navigator
    HeroControllerScope
      OrderListScreen ★
        Scaffold
          AppBar ★ (1 children)
            Text [data: Orders]
          CustomScrollView ★ (3 children)
            SliverAppBar ★
            SliverPadding
              SliverList ★
                OrderCard ★ [status: pending]
                OrderCard ★ [status: completed]
                OrderCard ★ [status: cancelled]
```

## Profile Mode vs Debug Mode

For accurate performance numbers, always use profile mode:

```bash
flutter run --profile
```

Debug mode includes overhead from assertions, debug checks, and the observatory that can make performance appear worse than reality. The MCP server works in both modes, but profiling data from debug mode should be taken with a grain of salt.

## How It Works

This MCP server communicates with your Flutter app through the **Dart VM Service Protocol** -- the same protocol that Flutter DevTools uses under the hood. When you run a Flutter app in debug or profile mode, it exposes a WebSocket endpoint that supports JSON-RPC 2.0 commands for:

- Isolate management and inspection
- Widget tree traversal (via Flutter service extensions)
- Timeline and CPU profiling
- Memory allocation tracking
- Code evaluation
- Hot reload / restart

The MCP server wraps these low-level protocol calls into AI-agent-friendly tools with structured output, severity ratings, and actionable recommendations -- so the AI can reason about your app's runtime behavior and suggest concrete fixes.

## Roadmap

- [ ] Auto-discover running Flutter apps (no manual URI copy)
- [ ] Network traffic inspection (HTTP request/response capture)
- [ ] Continuous monitoring mode (watch for jank in real-time)
- [ ] Integration test runner with performance baselines
- [ ] Shader compilation jank detection
- [ ] Widget rebuild tracking with flame chart data
- [ ] Export reports as markdown/HTML

## Contributing

Contributions are welcome! Please open an issue or PR.

## License

MIT
