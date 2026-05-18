import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function promptResult(description: string, text: string) {
  return {
    description,
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text,
        },
      },
    ],
  };
}

const sessionArgs = {
  sessionId: z
    .string()
    .optional()
    .describe("Optional diagnostic session ID to record observations into."),
};

export function registerDiagnosticPrompts(server: McpServer) {
  server.registerPrompt(
    "diagnose_jank",
    {
      description:
        "Workflow for diagnosing Flutter scroll, animation, startup, or navigation jank.",
      argsSchema: sessionArgs,
    },
    async ({ sessionId }) =>
      promptResult(
        "Diagnose Flutter jank",
        [
          "Diagnose Flutter jank using runtime evidence, not static guessing.",
          sessionId
            ? `Use diagnostic session ${sessionId}.`
            : "Start a diagnostic session with problemType=jank.",
          "1. Run runtime_health_check with mode=quick and record it as the baseline.",
          "2. Run start_profiling, ask the user to reproduce the jank, then run stop_profiling.",
          "3. Read the DIAGNOSTIC FINDINGS JSON from stop_profiling.",
          "4. If build time or jank is high, run start_tracking_rebuilds, reproduce, then stop_tracking_rebuilds.",
          "5. Use file/line evidence from findings before editing code.",
          "6. After edits, hot_reload and repeat the same diagnostic tools as verification.",
        ].join("\n")
      )
  );

  server.registerPrompt(
    "diagnose_memory_leak",
    {
      description: "Workflow for diagnosing Flutter memory growth or leaks.",
      argsSchema: sessionArgs,
    },
    async ({ sessionId }) =>
      promptResult(
        "Diagnose Flutter memory leak",
        [
          "Diagnose memory growth with before/after evidence.",
          sessionId
            ? `Use diagnostic session ${sessionId}.`
            : "Start a diagnostic session with problemType=memory-leak.",
          "1. Run runtime_health_check with mode=deep and forceGC=true.",
          "2. Save a baseline snapshot with save_snapshot forceGC=true.",
          "3. Ask the user to reproduce the suspected leak path.",
          "4. Save an after snapshot with forceGC=true and run compare_snapshots.",
          "5. Focus on app classes that grow in instances after navigation or disposal paths.",
          "6. After code edits, repeat the same snapshot sequence as verification.",
        ].join("\n")
      )
  );

  server.registerPrompt(
    "diagnose_layout_issue",
    {
      description:
        "Workflow for diagnosing overflow, wrong constraints, or visual layout bugs.",
      argsSchema: sessionArgs,
    },
    async ({ sessionId }) =>
      promptResult(
        "Diagnose Flutter layout issue",
        [
          "Diagnose layout issues with widget and visual evidence.",
          sessionId
            ? `Use diagnostic session ${sessionId}.`
            : "Start a diagnostic session with problemType=layout.",
          "1. Run runtime_health_check and record it as baseline.",
          "2. Run get_widget_tree with projectOnly=true and enough maxDepth to include the broken area.",
          "3. Use inspect_widget for suspicious widget IDs when available.",
          "4. Toggle debug paint and take a screenshot if visual evidence is needed.",
          "5. Edit only the layout boundary implicated by runtime evidence.",
          "6. Hot reload and rerun widget/screenshot diagnostics as verification.",
        ].join("\n")
      )
  );

  server.registerPrompt(
    "diagnose_network_issue",
    {
      description: "Workflow for diagnosing slow, large, or failing HTTP requests.",
      argsSchema: sessionArgs,
    },
    async ({ sessionId }) =>
      promptResult(
        "Diagnose Flutter network issue",
        [
          "Diagnose network issues with captured request evidence.",
          sessionId
            ? `Use diagnostic session ${sessionId}.`
            : "Start a diagnostic session with problemType=network.",
          "1. Run runtime_health_check and record it as baseline.",
          "2. Run start_network_capture.",
          "3. Ask the user to trigger the network path.",
          "4. Run stop_network_capture sorted by duration or size depending on the symptom.",
          "5. Distinguish backend latency, oversized payloads, client parsing, and missing pagination.",
          "6. After code edits, repeat capture as verification.",
        ].join("\n")
      )
  );

  server.registerPrompt(
    "verify_fix",
    {
      description:
        "Workflow for verifying a fix with the same runtime diagnostics used before editing.",
      argsSchema: sessionArgs,
    },
    async ({ sessionId }) =>
      promptResult(
        "Verify Flutter fix",
        [
          "Verify the fix with before/after runtime evidence.",
          sessionId
            ? `Use diagnostic session ${sessionId}.`
            : "Use the active diagnostic session if one exists.",
          "1. Run hot_reload unless the change requires hot_restart.",
          "2. Repeat the exact same diagnostic tool sequence used before the edit.",
          "3. Record the result as a verification observation.",
          "4. Compare key metrics: jank percentage, max frame time, rebuild count, heap delta, network duration, or screenshot evidence.",
          "5. Mark the result as improved, regressed, unchanged, or inconclusive based on metrics.",
        ].join("\n")
      )
  );
}
