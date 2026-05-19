import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter/material.dart';

void main() {
  runApp(const RuntimeDiagnosticsDemoApp());
}

class RuntimeDiagnosticsDemoApp extends StatelessWidget {
  const RuntimeDiagnosticsDemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Runtime Diagnostics Demo',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal),
        useMaterial3: true,
      ),
      home: const ScenarioHomePage(),
    );
  }
}

class ScenarioHomePage extends StatefulWidget {
  const ScenarioHomePage({super.key});

  @override
  State<ScenarioHomePage> createState() => _ScenarioHomePageState();
}

class _ScenarioHomePageState extends State<ScenarioHomePage> {
  bool fixedMode = false;

  @override
  Widget build(BuildContext context) {
    final scenarios = [
      ScenarioTile(
        title: 'Excessive rebuilds',
        description: 'Timer-driven broad setState fan-out.',
        page: RebuildScenarioPage(fixedMode: fixedMode),
      ),
      ScenarioTile(
        title: 'Leaky controller',
        description: 'Controllers retained after navigation.',
        page: LeakyControllerScenarioPage(fixedMode: fixedMode),
      ),
      ScenarioTile(
        title: 'Shader jank',
        description: 'First interaction paints complex gradients.',
        page: ShaderJankScenarioPage(fixedMode: fixedMode),
      ),
      ScenarioTile(
        title: 'Memory pressure',
        description: 'Large retained byte buffers.',
        page: MemoryPressureScenarioPage(fixedMode: fixedMode),
      ),
      ScenarioTile(
        title: 'Slow network',
        description: 'Delayed large HTTP-like request simulation.',
        page: SlowNetworkScenarioPage(fixedMode: fixedMode),
      ),
      ScenarioTile(
        title: 'Layout overflow',
        description: 'Unbounded row text on narrow screens.',
        page: LayoutOverflowScenarioPage(fixedMode: fixedMode),
      ),
    ];

    return Scaffold(
      appBar: AppBar(title: const Text('Runtime Diagnostics Demo')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SwitchListTile(
            value: fixedMode,
            title: const Text('Fixed mode'),
            subtitle:
                const Text('Toggle to compare before and after diagnostics.'),
            onChanged: (value) => setState(() => fixedMode = value),
          ),
          const SizedBox(height: 12),
          for (final scenario in scenarios) scenario,
        ],
      ),
    );
  }
}

class ScenarioTile extends StatelessWidget {
  const ScenarioTile({
    required this.title,
    required this.description,
    required this.page,
    super.key,
  });

  final String title;
  final String description;
  final Widget page;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        title: Text(title),
        subtitle: Text(description),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(builder: (_) => page),
        ),
      ),
    );
  }
}

class RebuildScenarioPage extends StatefulWidget {
  const RebuildScenarioPage({required this.fixedMode, super.key});

  final bool fixedMode;

  @override
  State<RebuildScenarioPage> createState() => _RebuildScenarioPageState();
}

class _RebuildScenarioPageState extends State<RebuildScenarioPage> {
  Timer? timer;
  int tick = 0;

  @override
  void initState() {
    super.initState();
    timer = Timer.periodic(const Duration(milliseconds: 80), (_) {
      if (!widget.fixedMode) {
        setState(() => tick++);
      }
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ScenarioScaffold(
      title: 'Excessive rebuilds',
      child: Column(
        children: [
          Text('Tick: $tick'),
          const SizedBox(height: 12),
          Expanded(
            child: ListView.builder(
              itemCount: 120,
              itemBuilder: (context, index) {
                if (widget.fixedMode) {
                  return StableRow(index: index);
                }
                return NoisyRow(index: index, tick: tick);
              },
            ),
          ),
        ],
      ),
    );
  }
}

class NoisyRow extends StatelessWidget {
  const NoisyRow({required this.index, required this.tick, super.key});

  final int index;
  final int tick;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text('Row $index'),
      subtitle: Text('Rebuilt on tick $tick'),
    );
  }
}

class StableRow extends StatelessWidget {
  const StableRow({required this.index, super.key});

  final int index;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text('Row $index'),
      subtitle: const Text('Stable row'),
    );
  }
}

final List<TextEditingController> leakedControllers = [];

class LeakyControllerScenarioPage extends StatefulWidget {
  const LeakyControllerScenarioPage({required this.fixedMode, super.key});

  final bool fixedMode;

  @override
  State<LeakyControllerScenarioPage> createState() =>
      _LeakyControllerScenarioPageState();
}

class _LeakyControllerScenarioPageState
    extends State<LeakyControllerScenarioPage> {
  final controllers = List.generate(40, (_) => TextEditingController());

  @override
  void dispose() {
    if (widget.fixedMode) {
      for (final controller in controllers) {
        controller.dispose();
      }
    } else {
      leakedControllers.addAll(controllers);
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ScenarioScaffold(
      title: 'Leaky controller',
      child: ListView.builder(
        itemCount: controllers.length,
        itemBuilder: (context, index) => Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: TextField(
            controller: controllers[index],
            decoration: InputDecoration(labelText: 'Field $index'),
          ),
        ),
      ),
    );
  }
}

class ShaderJankScenarioPage extends StatefulWidget {
  const ShaderJankScenarioPage({required this.fixedMode, super.key});

  final bool fixedMode;

  @override
  State<ShaderJankScenarioPage> createState() => _ShaderJankScenarioPageState();
}

class _ShaderJankScenarioPageState extends State<ShaderJankScenarioPage> {
  bool animate = false;

  @override
  Widget build(BuildContext context) {
    return ScenarioScaffold(
      title: 'Shader jank',
      child: Column(
        children: [
          FilledButton(
            onPressed: () => setState(() => animate = !animate),
            child: const Text('Trigger paint'),
          ),
          const SizedBox(height: 24),
          Expanded(
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 700),
              curve: Curves.easeInOut,
              decoration: BoxDecoration(
                gradient: SweepGradient(
                  colors: widget.fixedMode
                      ? const [Colors.teal, Colors.blueGrey]
                      : List.generate(
                          18,
                          (index) => Colors.primaries[
                              (index + (animate ? 5 : 0)) %
                                  Colors.primaries.length],
                        ),
                ),
                borderRadius: BorderRadius.circular(24),
                boxShadow: widget.fixedMode
                    ? const []
                    : const [
                        BoxShadow(
                          blurRadius: 36,
                          spreadRadius: 12,
                          color: Colors.black26,
                        ),
                      ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

final List<Uint8List> retainedBuffers = [];

class MemoryPressureScenarioPage extends StatefulWidget {
  const MemoryPressureScenarioPage({required this.fixedMode, super.key});

  final bool fixedMode;

  @override
  State<MemoryPressureScenarioPage> createState() =>
      _MemoryPressureScenarioPageState();
}

class _MemoryPressureScenarioPageState
    extends State<MemoryPressureScenarioPage> {
  int allocations = 0;

  void allocate() {
    final buffer = Uint8List(1024 * 1024 * 8);
    for (var i = 0; i < buffer.length; i += 4096) {
      buffer[i] = Random(i).nextInt(255);
    }
    if (!widget.fixedMode) {
      retainedBuffers.add(buffer);
    }
    setState(() => allocations++);
  }

  @override
  Widget build(BuildContext context) {
    return ScenarioScaffold(
      title: 'Memory pressure',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          FilledButton(onPressed: allocate, child: const Text('Allocate 8 MB')),
          OutlinedButton(
            onPressed: () {
              retainedBuffers.clear();
              setState(() => allocations = 0);
            },
            child: const Text('Clear retained buffers'),
          ),
          const SizedBox(height: 16),
          Text('Allocations: $allocations'),
          Text('Retained buffers: ${retainedBuffers.length}'),
        ],
      ),
    );
  }
}

class SlowNetworkScenarioPage extends StatefulWidget {
  const SlowNetworkScenarioPage({required this.fixedMode, super.key});

  final bool fixedMode;

  @override
  State<SlowNetworkScenarioPage> createState() =>
      _SlowNetworkScenarioPageState();
}

class _SlowNetworkScenarioPageState extends State<SlowNetworkScenarioPage> {
  String status = 'Idle';

  Future<void> load() async {
    setState(() => status = 'Loading...');
    final uri = widget.fixedMode
        ? Uri.parse('https://httpbin.org/json')
        : Uri.parse('https://httpbin.org/delay/3');
    final client = HttpClient();
    try {
      final request = await client.getUrl(uri);
      final response = await request.close();
      final body = await utf8.decodeStream(response);
      setState(() {
        status = 'HTTP ${response.statusCode}, ${body.length} bytes';
      });
    } catch (error) {
      setState(() => status = 'Request failed: $error');
    } finally {
      client.close(force: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ScenarioScaffold(
      title: 'Slow network',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          FilledButton(onPressed: load, child: const Text('Simulate request')),
          const SizedBox(height: 16),
          Text(status),
        ],
      ),
    );
  }
}

class LayoutOverflowScenarioPage extends StatelessWidget {
  const LayoutOverflowScenarioPage({required this.fixedMode, super.key});

  final bool fixedMode;

  @override
  Widget build(BuildContext context) {
    const longText =
        'ThisIsAVeryLongUnbrokenProductIdentifierThatOverflowsNarrowLayouts';
    return ScenarioScaffold(
      title: 'Layout overflow',
      child: Row(
        children: [
          const Icon(Icons.warning_amber),
          const SizedBox(width: 12),
          if (fixedMode)
            const Expanded(
              child: Text(longText, overflow: TextOverflow.ellipsis),
            )
          else
            const Text(longText),
        ],
      ),
    );
  }
}

class ScenarioScaffold extends StatelessWidget {
  const ScenarioScaffold({required this.title, required this.child, super.key});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: child,
      ),
    );
  }
}
