import {
  DiagnosticFinding,
  DiagnosticObservation,
  DiagnosticSession,
} from "../types/diagnostics.js";

export interface StartDiagnosticSessionInput {
  problemType: string;
  note?: string;
}

export interface RecordDiagnosticObservationInput {
  sessionId: string;
  sourceTool: string;
  label?: string;
  text?: string;
  findings?: DiagnosticFinding[];
  raw?: unknown;
  role?: "baseline" | "observation" | "verification";
}

export class DiagnosticSessionStore {
  private sessions = new Map<string, DiagnosticSession>();
  private nextSessionId = 0;
  private nextObservationId = 0;

  start(input: StartDiagnosticSessionInput): DiagnosticSession {
    const session: DiagnosticSession = {
      id: `diag_${++this.nextSessionId}`,
      problemType: input.problemType,
      startedAt: Date.now(),
      status: "active",
      observations: [],
      verificationRuns: [],
      notes: input.note ? [input.note] : [],
    };
    this.sessions.set(session.id, session);
    return session;
  }

  list(): DiagnosticSession[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.startedAt - a.startedAt || compareSessionIdsDesc(a.id, b.id)
    );
  }

  get(sessionId: string): DiagnosticSession | undefined {
    return this.sessions.get(sessionId);
  }

  record(input: RecordDiagnosticObservationInput): DiagnosticObservation {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error(`Diagnostic session not found: ${input.sessionId}`);
    }
    if (session.status !== "active") {
      throw new Error(`Diagnostic session is not active: ${input.sessionId}`);
    }

    const observation: DiagnosticObservation = {
      id: `obs_${++this.nextObservationId}`,
      sourceTool: input.sourceTool,
      label: input.label,
      capturedAt: Date.now(),
      text: input.text,
      findings: input.findings ?? [],
      raw: input.raw,
    };

    switch (input.role ?? "observation") {
      case "baseline":
        session.baseline = observation;
        session.observations.unshift(observation);
        break;
      case "verification":
        session.verificationRuns.push(observation);
        session.observations.push(observation);
        break;
      default:
        session.observations.push(observation);
    }

    return observation;
  }

  end(sessionId: string, note?: string): DiagnosticSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Diagnostic session not found: ${sessionId}`);
    }
    session.status = "ended";
    session.endedAt = Date.now();
    if (note) session.notes.push(note);
    return session;
  }
}

function compareSessionIdsDesc(a: string, b: string): number {
  const aNumber = Number(a.replace(/^diag_/, ""));
  const bNumber = Number(b.replace(/^diag_/, ""));
  return bNumber - aNumber;
}
