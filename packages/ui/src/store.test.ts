import { beforeEach, describe, expect, it } from "vitest";
import type { Snapshot } from "@symphony/shared";
import { useStore } from "./store.js";

/**
 * Store, WS olaylarını UI durumuna çeviren tek mantık noktası; burada saf olarak
 * (DOM/WebSocket olmadan) test edilir. DaemonConnection yalnız bu action'ları çağıran
 * ince bir taşıyıcıdır — canlı görsel doğrulama kullanıcıya kalır (Bash'ten görülemez).
 */

const RUN = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  useStore.setState({
    status: "connecting",
    error: null,
    daemonVersion: null,
    providers: [],
    runs: [],
    pendingPermissions: 0,
    log: [],
  });
});

describe("ui store", () => {
  it("applySnapshot sağlayıcı/koşu/bekleyen izin sayısını doldurur", () => {
    const snapshot: Snapshot = {
      providers: [{ provider: "anthropic", status: "up" }],
      runs: [{ runId: RUN, agentId: "coder", task: "iş", state: "thinking", model: "claude-sonnet-5" }],
      pendingPermissions: [
        { requestId: "22222222-2222-4222-8222-222222222222", runId: RUN, tool: "write_file", args: {}, riskClass: "mutating" },
      ],
    };
    useStore.getState().applySnapshot(snapshot, "0.1.0");
    const s = useStore.getState();
    expect(s.daemonVersion).toBe("0.1.0");
    expect(s.providers).toHaveLength(1);
    expect(s.runs[0]?.agentId).toBe("coder");
    expect(s.pendingPermissions).toBe(1);
  });

  it("agent.run yaşam döngüsü: started → state → completed koşuyu ekler/günceller/kaldırır", () => {
    const store = useStore.getState();
    store.handleEvent("agent.run.started", { runId: RUN, agentId: "coder", task: "bir iş", model: "m" });
    expect(useStore.getState().runs).toHaveLength(1);
    expect(useStore.getState().runs[0]?.state).toBe("queued");

    store.handleEvent("agent.run.state", { runId: RUN, state: "thinking" });
    expect(useStore.getState().runs[0]?.state).toBe("thinking");

    store.handleEvent("agent.run.completed", { runId: RUN, result: "ok", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.001 } });
    expect(useStore.getState().runs).toHaveLength(0);
    expect(useStore.getState().log[0]?.tone).toBe("good");
  });

  it("izin akışı: tool.requested bekleyeni artırır, permission.resolved azaltır", () => {
    const store = useStore.getState();
    store.handleEvent("agent.tool.requested", { runId: RUN, requestId: "r", tool: "run_command", args: {}, riskClass: "destructive" });
    expect(useStore.getState().pendingPermissions).toBe(1);
    expect(useStore.getState().log[0]?.tone).toBe("warn");

    store.handleEvent("permission.resolved", { requestId: "r", decision: "allow", resolvedBy: "cli" });
    expect(useStore.getState().pendingPermissions).toBe(0);
  });

  it("provider.health mevcut sağlayıcıyı günceller (çift eklemez)", () => {
    const store = useStore.getState();
    store.handleEvent("provider.health", { provider: "ollama", status: "up" });
    store.handleEvent("provider.health", { provider: "ollama", status: "down" });
    const providers = useStore.getState().providers;
    expect(providers).toHaveLength(1);
    expect(providers[0]?.status).toBe("down");
  });

  it("agent.tool.completed başarı/başarısızlığa göre renklendirir", () => {
    const store = useStore.getState();
    store.handleEvent("agent.tool.completed", { runId: RUN, tool: "read_file", ok: true, resultSummary: "içerik", durationMs: 3 });
    expect(useStore.getState().log[0]?.tone).toBe("good");
    store.handleEvent("agent.tool.completed", { runId: RUN, tool: "write_file", ok: false, resultSummary: "PERMISSION_JAIL", durationMs: 0 });
    expect(useStore.getState().log[0]?.tone).toBe("bad");
  });

  it("log en fazla 200 satır tutar (en yeni başta)", () => {
    const store = useStore.getState();
    for (let i = 0; i < 250; i++) {
      store.handleEvent("agent.tool.started", { runId: RUN, tool: "glob", argsSummary: `glob ${i}` });
    }
    const log = useStore.getState().log;
    expect(log.length).toBe(200);
    expect(log[0]?.text).toContain("249"); // en yeni başta
  });
});
