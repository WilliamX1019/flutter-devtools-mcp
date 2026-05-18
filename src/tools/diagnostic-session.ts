import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { compareDiagnosticRuns } from "../services/diagnostic-comparison.js";
import { DiagnosticSessionStore } from "../services/diagnostic-session.js";
import {
  DiagnosticCategory,
  DiagnosticFinding,
  DiagnosticSeverity,
} from "../types/diagnostics.js";

const severitySchema = z.enum(["info", "low", "medium", "high", "critical"]);
const categorySchema = z.enum([
  "runtime",
  "widget",
  "rebuild",
  "performance",
  "memory",
  "network",
]);

const findingSchema = z.object({
  id: z.string(),
  severity: severitySchema,
  category: categorySchema,
  title: z.string(),
  evidence: z.string(),
  metric: z
    .object({
      name: z.string(),
      value: z.number(),
      unit: z.string(),
      threshold: z.number().optional(),
    })
    .optional(),
  location: z
    .object({
      file: z.string().optional(),
      line: z.number().optional(),
      column: z.number().optional(),
      symbol: z.string().optional(),
    })
    .optional(),
  recommendation: z.string().optional(),
  nextTool: z.string().optional(),
});

function toFinding(value: z.infer<typeof findingSchema>): DiagnosticFinding {
  return {
    ...value,
    severity: value.severity as DiagnosticSeverity,
    category: value.category as DiagnosticCategory,
  };
}

export function registerDiagnosticSessionTools(
  server: McpServer,
  store: DiagnosticSessionStore
) {
  server.registerTool(
    "start_diagnostic_session",
    {
      description:
        "Start a diagnostic session to group runtime health checks, profiling, rebuild tracking, memory snapshots, code changes, and verification runs for one investigation.",
      inputSchema: {
        problemType: z
          .string()
          .describe(
            'Short problem type, for example "jank", "memory-leak", "layout", "network", or "state-bug"'
          ),
        note: z.string().optional().describe("Optional initial context or hypothesis."),
      },
    },
    async ({ problemType, note }) => {
      const session = store.start({ problemType, note });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "started",
                session,
                nextSteps: [
                  "Run runtime_health_check and record it as the baseline.",
                  "Collect targeted diagnostics for the suspected problem.",
                  "After code changes, record a verification observation.",
                ],
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "record_diagnostic_observation",
    {
      description:
        "Record a diagnostic observation into an active session. Use this to preserve tool output and structured findings for before/after comparison.",
      inputSchema: {
        sessionId: z.string().describe("Diagnostic session ID."),
        sourceTool: z
          .string()
          .describe(
            "Tool or source that produced this observation, for example runtime_health_check or stop_profiling."
          ),
        role: z
          .enum(["baseline", "observation", "verification"])
          .default("observation")
          .describe("How this observation should be used in the session."),
        label: z.string().optional().describe("Short human-readable label."),
        text: z.string().optional().describe("Optional text report or summary."),
        findings: z
          .array(findingSchema)
          .default([])
          .describe("Structured DiagnosticFinding objects from tool output."),
      },
    },
    async ({ sessionId, sourceTool, role, label, text, findings }) => {
      try {
        const observation = store.record({
          sessionId,
          sourceTool,
          role,
          label,
          text,
          findings: findings.map(toFinding),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ status: "recorded", observation }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to record diagnostic observation: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "compare_diagnostic_runs",
    {
      description:
        "Compare before/after observations in a diagnostic session and return a verdict. Defaults to baseline vs latest verification run.",
      inputSchema: {
        sessionId: z.string().describe("Diagnostic session ID."),
        beforeObservationId: z
          .string()
          .optional()
          .describe(
            "Optional before observation ID. Defaults to the session baseline."
          ),
        afterObservationId: z
          .string()
          .optional()
          .describe(
            "Optional after observation ID. Defaults to the latest verification run."
          ),
      },
    },
    async ({ sessionId, beforeObservationId, afterObservationId }) => {
      const session = store.get(sessionId);
      if (!session) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Diagnostic session not found: ${sessionId}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const comparison = compareDiagnosticRuns(session, {
          beforeObservationId,
          afterObservationId,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(comparison, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to compare diagnostic runs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "list_diagnostic_sessions",
    {
      description: "List diagnostic sessions and their observation counts.",
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            store.list().map((session) => ({
              id: session.id,
              problemType: session.problemType,
              status: session.status,
              startedAt: session.startedAt,
              endedAt: session.endedAt,
              baseline: session.baseline?.id,
              observations: session.observations.length,
              verificationRuns: session.verificationRuns.length,
              notes: session.notes,
            })),
            null,
            2
          ),
        },
      ],
    })
  );

  server.registerTool(
    "end_diagnostic_session",
    {
      description:
        "End an active diagnostic session after the fix has been verified or the investigation is paused.",
      inputSchema: {
        sessionId: z.string().describe("Diagnostic session ID."),
        note: z.string().optional().describe("Optional closing note or verdict."),
      },
    },
    async ({ sessionId, note }) => {
      try {
        const session = store.end(sessionId, note);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ status: "ended", session }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to end diagnostic session: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
