import { describe, expect, it } from "vitest";
import { DiagnosticSessionStore } from "../../src/services/diagnostic-session.js";
import {
  appendAutoRecordStatus,
  autoRecordDiagnosticObservation,
} from "../../src/utils/diagnostic-recording.js";

describe("diagnostic recording utilities", () => {
  it("records a tool result into a diagnostic session", () => {
    const store = new DiagnosticSessionStore();
    const session = store.start({ problemType: "jank" });

    const status = autoRecordDiagnosticObservation({
      store,
      sessionId: session.id,
      sourceTool: "runtime_health_check",
      observationRole: "baseline",
      observationLabel: "initial health",
      text: "health report",
      findings: [],
      raw: { connected: true },
    });

    expect(status).toContain(session.id);
    expect(store.get(session.id)?.baseline?.sourceTool).toBe("runtime_health_check");
    expect(store.get(session.id)?.baseline?.label).toBe("initial health");
    expect(store.get(session.id)?.observations).toHaveLength(1);
  });

  it("does nothing when no session is provided", () => {
    const status = autoRecordDiagnosticObservation({
      sourceTool: "stop_profiling",
      text: "profile report",
      findings: [],
    });

    expect(status).toBeUndefined();
  });

  it("appends recording status to text output only when present", () => {
    const output = ["report"];

    appendAutoRecordStatus(output, undefined);
    expect(output).toEqual(["report"]);

    appendAutoRecordStatus(output, "Recorded diagnostic observation obs_1.");
    expect(output).toContain("DIAGNOSTIC SESSION");
    expect(output.at(-1)).toBe("Recorded diagnostic observation obs_1.");
  });
});
