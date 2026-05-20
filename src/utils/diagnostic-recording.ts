import { DiagnosticSessionStore } from "../services/diagnostic-session.js";
import type { DiagnosticFinding } from "../types/diagnostics.js";

export type DiagnosticObservationRole = "baseline" | "observation" | "verification";

export interface DiagnosticRecordingInput {
  sessionId?: string;
  observationRole?: DiagnosticObservationRole;
  observationLabel?: string;
}

export interface AutoRecordDiagnosticInput extends DiagnosticRecordingInput {
  store?: DiagnosticSessionStore;
  sourceTool: string;
  text?: string;
  findings: DiagnosticFinding[];
  raw?: unknown;
}

export function autoRecordDiagnosticObservation(
  input: AutoRecordDiagnosticInput
): string | undefined {
  if (!input.store || !input.sessionId) return undefined;

  try {
    const observation = input.store.record({
      sessionId: input.sessionId,
      sourceTool: input.sourceTool,
      role: input.observationRole ?? "observation",
      label: input.observationLabel,
      text: input.text,
      findings: input.findings,
      raw: input.raw,
    });
    return `Recorded diagnostic observation ${observation.id} in session ${input.sessionId}.`;
  } catch (error) {
    return `Failed to record diagnostic observation: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function appendAutoRecordStatus(
  output: string[],
  status: string | undefined
): void {
  if (!status) return;
  output.push("");
  output.push("DIAGNOSTIC SESSION");
  output.push("───────────────────────────────────────────────────────────");
  output.push(status);
}
