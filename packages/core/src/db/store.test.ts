import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DataStore, type RequestRecord } from "./store.js";

let dir: string;
let store: DataStore;

function openStore(): DataStore {
  dir = mkdtempSync(join(tmpdir(), "symphony-store-test-"));
  store = new DataStore(join(dir, "symphony.db"));
  return store;
}

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeRequest(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    provider: "anthropic",
    model: "claude-opus-4-8",
    startedAt: Date.now(),
    durationMs: 1200,
    usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.01 },
    status: "ok",
    ...overrides,
  };
}

describe("DataStore", () => {
  it("istek kaydeder ve geri okur (hata kodu dahil)", () => {
    openStore();
    store.recordRequest(makeRequest({ id: "a".repeat(36) }));
    store.recordRequest(
      makeRequest({
        startedAt: Date.now() + 10,
        status: "error",
        errorCode: "PROVIDER_UNKNOWN",
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      }),
    );

    const requests = store.recentRequests();
    expect(requests).toHaveLength(2);
    expect(requests[0]?.status).toBe("error");
    expect(requests[0]?.errorCode).toBe("PROVIDER_UNKNOWN");
    expect(requests[1]?.status).toBe("ok");
    expect(requests[1]?.errorCode).toBeUndefined();
    expect(requests[1]?.usage).toEqual({ inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
  });

  it("usageTotals sağlayıcı+model bazında kümülatif toplar", () => {
    openStore();
    store.recordRequest(makeRequest());
    store.recordRequest(
      makeRequest({ usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.002 } }),
    );
    store.recordRequest(makeRequest({ model: "claude-haiku-4-5" }));

    expect(store.usageTotals("anthropic", "claude-opus-4-8")).toEqual({
      inputTokens: 110,
      outputTokens: 55,
      costUsd: 0.012,
    });
    expect(store.usageTotals("anthropic", "yok-boyle-model")).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
  });

  it("usageQuery model bazında gruplar ve zaman aralığını uygular", () => {
    openStore();
    store.recordRequest(makeRequest({ startedAt: 1_000 }));
    store.recordRequest(makeRequest({ startedAt: 2_000, model: "claude-haiku-4-5" }));
    store.recordRequest(makeRequest({ startedAt: 9_000 }));

    const all = store.usageQuery({ groupBy: "model" });
    expect(all.rows.map((r) => r.key)).toEqual(["claude-haiku-4-5", "claude-opus-4-8"]);
    expect(all.totals.inputTokens).toBe(300);

    const windowed = store.usageQuery({ from: 1_500, to: 8_000, groupBy: "model" });
    expect(windowed.rows).toEqual([
      { key: "claude-haiku-4-5", inputTokens: 100, outputTokens: 50, costUsd: 0.01 },
    ]);
    expect(windowed.totals.outputTokens).toBe(50);
  });

  it("usageQuery gün bazında gruplayabilir", () => {
    openStore();
    // 2026-07-01 ve 2026-07-02 (UTC) içinde birer istek
    store.recordRequest(makeRequest({ startedAt: Date.UTC(2026, 6, 1, 12) }));
    store.recordRequest(makeRequest({ startedAt: Date.UTC(2026, 6, 2, 12) }));

    const byDay = store.usageQuery({ groupBy: "day" });
    expect(byDay.rows.map((r) => r.key)).toEqual(["2026-07-01", "2026-07-02"]);
  });

  it("telemetri kaydeder; context JSON gidip geliyor, ham içerik yok", () => {
    openStore();
    store.recordTelemetry({
      scope: "chat",
      code: "PROVIDER_UNKNOWN",
      message: "Bilinmeyen sağlayıcı: openai",
      stack: "Error: ...\n  at runChat",
      context: { provider: "openai", messageCount: 3 },
    });
    store.recordTelemetry({ scope: "ws.message", code: "INTERNAL_ERROR", message: "boom" });

    const entries = store.recentTelemetry();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.scope).toBe("ws.message");
    expect(entries[0]?.context).toBeUndefined();
    expect(entries[1]?.code).toBe("PROVIDER_UNKNOWN");
    expect(entries[1]?.context).toEqual({ provider: "openai", messageCount: 3 });
    expect(entries[1]?.stack).toContain("runChat");
  });

  it("saveChatTurn: oturum + mesajlar yazılır, başlık ilk kullanıcı mesajından", () => {
    openStore();
    const sessionId = crypto.randomUUID();
    store.saveChatTurn({
      sessionId,
      provider: "ollama",
      model: "qwen3:8b",
      messages: [{ role: "user", content: "  Merhaba\ndünya, nasılsın?  " }],
      assistantText: "İyiyim!",
    });

    const sessions = store.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId,
      provider: "ollama",
      model: "qwen3:8b",
      title: "Merhaba dünya, nasılsın?",
      messageCount: 2,
    });

    const detail = store.sessionDetail(sessionId);
    expect(detail?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(detail?.messages[1]?.content).toBe("İyiyim!");
  });

  it("saveChatTurn: ikinci tur mesajları DEĞİŞTİRİR (replace) ve eski `at` korunur", () => {
    openStore();
    const sessionId = crypto.randomUUID();
    store.saveChatTurn({
      sessionId,
      provider: "ollama",
      model: "qwen3:8b",
      messages: [{ role: "user", content: "merhaba" }],
      assistantText: "Merhaba!",
    });
    const firstTurn = store.sessionDetail(sessionId);
    const firstAt = firstTurn?.messages[0]?.at;

    // İkinci tur: istemci TAM geçmişi gönderir (PROTOKOL §3)
    store.saveChatTurn({
      sessionId,
      provider: "ollama",
      model: "qwen3:8b",
      messages: [
        { role: "user", content: "merhaba" },
        { role: "assistant", content: "Merhaba!" },
        { role: "user", content: "nasılsın?" },
      ],
      assistantText: "İyiyim!",
    });

    expect(store.listSessions()).toHaveLength(1); // yeni oturum AÇILMADI
    const detail = store.sessionDetail(sessionId);
    expect(detail?.messages.map((m) => m.content)).toEqual([
      "merhaba",
      "Merhaba!",
      "nasılsın?",
      "İyiyim!",
    ]);
    expect(detail?.messages[0]?.at).toBe(firstAt); // ilk turun zamanı ezilmedi
    expect(detail?.session.messageCount).toBe(4);
  });

  it("listSessions tüm oturumları verir; sessionDetail bilinmeyen id'de null", () => {
    openStore();
    store.saveChatTurn({
      sessionId: crypto.randomUUID(),
      provider: "ollama",
      model: "qwen3:8b",
      messages: [{ role: "user", content: "eski" }],
      assistantText: "a",
    });
    const newerId = crypto.randomUUID();
    store.saveChatTurn({
      sessionId: newerId,
      provider: "anthropic",
      model: "claude-opus-4-8",
      messages: [{ role: "user", content: "yeni" }],
      assistantText: "b",
    });

    const sessions = store.listSessions();
    expect(sessions).toHaveLength(2);
    // updated_at aynı milisaniyeye düşebilir → en azından yeni oturum listede önde ya da eşit
    expect(sessions.map((s) => s.sessionId)).toContain(newerId);
    expect(store.sessionDetail("yok-boyle-oturum")).toBeNull();
  });

  it("göç bir kez koşar: aynı dosya yeniden açılınca veri durur", () => {
    openStore();
    const file = join(dir, "symphony.db");
    store.recordRequest(makeRequest());
    store.close();

    store = new DataStore(file); // afterEach bunu kapatacak
    expect(store.recentRequests()).toHaveLength(1);
  });

  describe("router v2 okumaları (ADR-016 Karar 1)", () => {
    function finishRun(overrides: {
      state: "completed" | "failed" | "cancelled";
      startedAt: number;
      task?: string;
      provider?: string;
      model?: string;
      costUsd?: number;
    }): string {
      const id = crypto.randomUUID();
      store.createAgentRun({
        id,
        agentId: "coder",
        task: overrides.task ?? "şu kodu düzelt",
        provider: overrides.provider ?? "ollama",
        model: overrides.model ?? "qwen3:8b",
        cwd: dir,
        startedAt: overrides.startedAt,
      });
      store.finishAgentRun(id, {
        state: overrides.state,
        result: overrides.state === "completed" ? "tamam" : null,
        errorCode: overrides.state === "failed" ? "AGENT_TOOL_LOOP" : null,
        usage: { inputTokens: 10, outputTokens: 5, costUsd: overrides.costUsd ?? 0 },
        steps: 1,
      });
      return id;
    }

    it("runsSince: yalnız completed/failed döner, cancelled HARİÇ tutulur", () => {
      openStore();
      finishRun({ state: "completed", startedAt: 5_000, costUsd: 0.02 });
      finishRun({ state: "failed", startedAt: 6_000 });
      finishRun({ state: "cancelled", startedAt: 7_000 });

      const rows = store.runsSince(0);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.ok).sort()).toEqual([false, true]);
      expect(rows.find((r) => r.ok)?.costUsd).toBe(0.02);
    });

    it("runsSince: sinceMs'ten ÖNCEki koşuları dışarıda bırakır", () => {
      openStore();
      finishRun({ state: "completed", startedAt: 1_000 });
      finishRun({ state: "completed", startedAt: 9_000 });

      expect(store.runsSince(5_000)).toHaveLength(1);
      expect(store.runsSince(0)).toHaveLength(2);
    });

    it("turnStatsSince: sağlayıcı+model başına ortalama tur süresi ve tur sayısı (yalnız status='ok')", () => {
      openStore();
      store.recordRequest(makeRequest({ startedAt: 5_000, durationMs: 1000 }));
      store.recordRequest(makeRequest({ startedAt: 6_000, durationMs: 3000 }));
      store.recordRequest(
        makeRequest({ startedAt: 7_000, durationMs: 99_000, status: "error" }), // sayılmamalı
      );

      const rows = store.turnStatsSince(0);
      const row = rows.find((r) => r.provider === "anthropic" && r.model === "claude-opus-4-8");
      expect(row).toMatchObject({ turns: 2, avgDurationMs: 2000 });
    });

    it("agentRunExists: var olan id true, uydurma id false döner", () => {
      openStore();
      const id = finishRun({ state: "completed", startedAt: 1_000 });
      expect(store.agentRunExists(id)).toBe(true);
      expect(store.agentRunExists("yok-boyle-id")).toBe(false);
    });
  });

  describe("geri bildirim (ADR-016 Karar 4, göç v5)", () => {
    it("recordFeedback yazar, recentFeedback yeniden-eskiye okur (note opsiyonel)", () => {
      openStore();
      store.recordFeedback({ subjectKind: "run", subjectId: "r1", verdict: "good", note: "hızlıydı" });
      store.recordFeedback({ subjectKind: "chat", subjectId: "s1", verdict: "bad" });

      const rows = store.recentFeedback();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ subjectKind: "chat", subjectId: "s1", verdict: "bad", note: null });
      expect(rows[1]).toMatchObject({
        subjectKind: "run",
        subjectId: "r1",
        verdict: "good",
        note: "hızlıydı",
      });
    });

    it("feedbackSince: yalnız subject_kind='run' döner, agent_runs ile JOIN edip provider/model/task taşır — 'chat' geri bildirimi HARİÇ", () => {
      openStore();
      const runId = crypto.randomUUID();
      store.createAgentRun({
        id: runId,
        agentId: "coder",
        task: "şu kodu düzelt",
        provider: "ollama",
        model: "qwen3:8b",
        cwd: dir,
        startedAt: 1_000,
      });
      store.recordFeedback({ subjectKind: "run", subjectId: runId, verdict: "bad" });
      store.recordFeedback({ subjectKind: "chat", subjectId: "yok-boyle-oturum", verdict: "good" });

      const rows = store.feedbackSince(0);
      expect(rows).toEqual([
        { provider: "ollama", model: "qwen3:8b", task: "şu kodu düzelt", verdict: "bad" },
      ]);
    });

    it("feedbackSince: sinceMs'ten ÖNCEki geri bildirimi dışarıda bırakmaz için `at` şimdi yazılır — zaman filtresi ileri tarihte boş döner", () => {
      openStore();
      const runId = crypto.randomUUID();
      store.createAgentRun({
        id: runId,
        agentId: "coder",
        task: "özet çıkar",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        cwd: dir,
        startedAt: 1_000,
      });
      store.recordFeedback({ subjectKind: "run", subjectId: runId, verdict: "good" });

      expect(store.feedbackSince(0)).toHaveLength(1);
      expect(store.feedbackSince(Date.now() + 60_000)).toHaveLength(0);
    });
  });

  describe("kendine yama önerileri (ADR-018 Karar 3, göç v6)", () => {
    function makePatch(overrides: Partial<Parameters<DataStore["createPatch"]>[0]> = {}) {
      return {
        id: crypto.randomUUID(),
        errorCode: "AGENT_TOOL_LOOP",
        category: "AGENT_TOOL_LOOP",
        branch: "doktor/agent-tool-loop",
        files: ["packages/core/src/agent/engine.ts"],
        diff: "--- a/engine.ts\n+++ b/engine.ts\n@@ ...",
        testOk: true,
        testSummary: "49 dosya, 421 test yeşil",
        ...overrides,
      };
    }

    it("createPatch yazar, patchById TAM eşleşen kaydı döner (state daima 'proposed' başlar)", () => {
      openStore();
      const record = makePatch();
      store.createPatch(record);

      const entry = store.patchById(record.id);
      expect(entry).toMatchObject({
        id: record.id,
        errorCode: "AGENT_TOOL_LOOP",
        category: "AGENT_TOOL_LOOP",
        branch: "doktor/agent-tool-loop",
        files: ["packages/core/src/agent/engine.ts"],
        testOk: true,
        testSummary: "49 dosya, 421 test yeşil",
        runId: null,
        state: "proposed",
        resolvedAt: null,
      });
      expect(typeof entry?.createdAt).toBe("number");
    });

    it("patchById bilinmeyen id için null döner", () => {
      openStore();
      expect(store.patchById("yok-boyle-id")).toBeNull();
    });

    it("listPatches yeniden-eskiye döner; state verilirse yalnız o durumdakiler", () => {
      openStore();
      store.createPatch(makePatch({ id: "p1", errorCode: "A" }));
      store.createPatch(makePatch({ id: "p2", errorCode: "B" }));
      store.resolvePatch("p1", "applied");

      expect(store.listPatches().map((p) => p.id)).toEqual(["p2", "p1"]);
      expect(store.listPatches("applied").map((p) => p.id)).toEqual(["p1"]);
      expect(store.listPatches("proposed").map((p) => p.id)).toEqual(["p2"]);
    });

    it("resolvePatch state'i değiştirir + resolvedAt'i doldurur", () => {
      openStore();
      store.createPatch(makePatch({ id: "p1" }));
      expect(store.patchById("p1")?.resolvedAt).toBeNull();

      store.resolvePatch("p1", "reverted");

      const after = store.patchById("p1");
      expect(after?.state).toBe("reverted");
      expect(typeof after?.resolvedAt).toBe("number");
    });

    it("openOrAppliedErrorCodes: yalnız 'proposed'/'applied' durumundaki kodları döner", () => {
      openStore();
      store.createPatch(makePatch({ id: "p1", errorCode: "OPEN_ONE" }));
      store.createPatch(makePatch({ id: "p2", errorCode: "APPLIED_ONE" }));
      store.createPatch(makePatch({ id: "p3", errorCode: "REJECTED_ONE" }));
      store.resolvePatch("p2", "applied");
      store.resolvePatch("p3", "rejected");

      const codes = store.openOrAppliedErrorCodes();
      expect(codes).toContain("OPEN_ONE");
      expect(codes).toContain("APPLIED_ONE");
      expect(codes).not.toContain("REJECTED_ONE");
    });

    it("telemetryRowsForCode: yalnız verilen kodu ve zaman penceresini döner, recentTelemetry ile AYNI alan biçimi", () => {
      openStore();
      store.recordTelemetry({ scope: "agent", code: "AGENT_TOOL_LOOP", message: "1", stack: "s1" });
      store.recordTelemetry({ scope: "agent", code: "AGENT_TOOL_LOOP", message: "2" });
      store.recordTelemetry({ scope: "agent", code: "BASKA_KOD", message: "3" });

      const rows = store.telemetryRowsForCode("AGENT_TOOL_LOOP", 0);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.code === "AGENT_TOOL_LOOP")).toBe(true);
      expect(rows.find((r) => r.message === "1")?.stack).toBe("s1");

      expect(store.telemetryRowsForCode("AGENT_TOOL_LOOP", Date.now() + 60_000)).toEqual([]);
    });
  });
});
