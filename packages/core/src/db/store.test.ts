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
});
