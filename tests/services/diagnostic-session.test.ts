import { describe, expect, it } from "vitest";
import { DiagnosticSessionStore } from "../../src/services/diagnostic-session.js";

describe("DiagnosticSessionStore", () => {
  it("starts sessions and records baseline, observation, and verification runs", () => {
    const store = new DiagnosticSessionStore();
    const session = store.start({ problemType: "jank", note: "Feed scroll" });

    expect(session.id).toBe("diag_1");
    expect(session.status).toBe("active");
    expect(session.notes).toEqual(["Feed scroll"]);

    const baseline = store.record({
      sessionId: session.id,
      role: "baseline",
      sourceTool: "runtime_health_check",
      findings: [],
    });
    const observation = store.record({
      sessionId: session.id,
      sourceTool: "stop_profiling",
      findings: [
        {
          id: "performance.jank-rate",
          severity: "high",
          category: "performance",
          title: "Jank",
          evidence: "12% jank",
        },
      ],
    });
    const verification = store.record({
      sessionId: session.id,
      role: "verification",
      sourceTool: "stop_profiling",
      findings: [],
    });

    const stored = store.get(session.id);
    expect(stored?.baseline).toBe(baseline);
    expect(stored?.observations.map((item) => item.id)).toEqual([
      baseline.id,
      observation.id,
      verification.id,
    ]);
    expect(stored?.verificationRuns).toEqual([verification]);
  });

  it("prevents recording into ended sessions", () => {
    const store = new DiagnosticSessionStore();
    const session = store.start({ problemType: "memory-leak" });
    store.end(session.id, "Fixed");

    expect(() =>
      store.record({
        sessionId: session.id,
        sourceTool: "save_snapshot",
      })
    ).toThrow("Diagnostic session is not active");
  });

  it("lists newest sessions first", () => {
    const store = new DiagnosticSessionStore();
    const first = store.start({ problemType: "layout" });
    const second = store.start({ problemType: "network" });

    expect(store.list().map((session) => session.id)).toEqual([second.id, first.id]);
  });
});
