import { beforeEach, describe, expect, it } from "vitest";
import type { ActiveRun, Snapshot } from "@symphony/shared";
import { groupRunsByProject, orderRunsForDisplay, useStore } from "./store.js";

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
    runStreams: {},
    runFiles: {},
    pendingPermissions: [],
    lastErrorAt: null,
    lastCompletedAt: null,
    log: [],
    usageTotals: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    usageByModel: [],
    sessionTokens: 0,
    sessionCostUsd: 0,
    sessionCacheReadTokens: 0,
    sessionCacheCreationTokens: 0,
    limits: {},
    gpus: [],
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
    expect(s.pendingPermissions).toHaveLength(1);
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

  it("Faz 5 (ADR-014): agent.run.started parentRunId'yi runs'a taşır (çocuk koşu)", () => {
    const CHILD = "55555555-5555-4555-8555-555555555555";
    const store = useStore.getState();
    store.handleEvent("agent.run.started", { runId: RUN, agentId: "sef", task: "büyük iş", model: "m" });
    store.handleEvent("agent.run.started", {
      runId: CHILD,
      agentId: "coder",
      task: "alt iş",
      model: "m",
      parentRunId: RUN,
    });
    const runs = useStore.getState().runs;
    expect(runs.find((r) => r.runId === RUN)?.parentRunId).toBeUndefined();
    expect(runs.find((r) => r.runId === CHILD)?.parentRunId).toBe(RUN);
  });

  it("Faz 4 (ADR-015): agent.run.started cwd'yi runs'a taşır (proje gruplaması bunu okur)", () => {
    const store = useStore.getState();
    store.handleEvent("agent.run.started", {
      runId: RUN,
      agentId: "coder",
      task: "iş",
      model: "m",
      cwd: "C:\\Users\\brkn2\\Desktop\\proje-a",
    });
    expect(useStore.getState().runs[0]?.cwd).toBe("C:\\Users\\brkn2\\Desktop\\proje-a");
  });

  it("görev sonuçlanması converge sinyalini (lastCompletedAt) günceller — agent VE sohbet", () => {
    const store = useStore.getState();
    expect(useStore.getState().lastCompletedAt).toBeNull();

    store.handleEvent("agent.run.completed", { runId: RUN, result: "ok", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } });
    const afterRun = useStore.getState().lastCompletedAt;
    expect(afterRun).not.toBeNull();

    store.handleEvent("chat.completed", { usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } });
    const afterChat = useStore.getState().lastCompletedAt;
    expect(afterChat).not.toBeNull();
    expect(afterChat ?? 0).toBeGreaterThanOrEqual(afterRun ?? 0);
  });

  it("izin akışı: tool.requested tam detay saklar (kart render edebilsin), permission.resolved requestId'e göre temizler", () => {
    const store = useStore.getState();
    store.handleEvent("agent.tool.requested", {
      runId: RUN,
      requestId: "r",
      tool: "write_file",
      args: { path: "a.txt" },
      riskClass: "mutating",
      diff: "--- a.txt\n+++ a.txt\n+yeni",
    });
    const pending = useStore.getState().pendingPermissions;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ requestId: "r", tool: "write_file", diff: expect.stringContaining("+yeni") });
    expect(useStore.getState().log[0]?.tone).toBe("warn");

    // Başka bir requestId'nin resolved'ı bu bekleyeni SİLMEZ.
    store.handleEvent("permission.resolved", { requestId: "baska", decision: "deny" });
    expect(useStore.getState().pendingPermissions).toHaveLength(1);

    store.handleEvent("permission.resolved", { requestId: "r", decision: "allow", resolvedBy: "desktop" });
    expect(useStore.getState().pendingPermissions).toHaveLength(0);
  });

  it("removePending (masaüstünden cevaplayınca iyimser kaldırma) requestId'e göre siler", () => {
    const store = useStore.getState();
    store.handleEvent("agent.tool.requested", { runId: RUN, requestId: "x", tool: "run_command", args: {}, riskClass: "destructive" });
    expect(useStore.getState().pendingPermissions).toHaveLength(1);
    store.removePending("x");
    expect(useStore.getState().pendingPermissions).toHaveLength(0);
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

  it("usage.query.ok tüm-zaman model dökümünü + toplamı seed'ler (maliyete göre azalan)", () => {
    useStore.getState().handleEvent("usage.query.ok", {
      rows: [
        { key: "claude-sonnet-5", inputTokens: 100, outputTokens: 50, costUsd: 0.02 },
        { key: "llama3", inputTokens: 300, outputTokens: 200, costUsd: 0 },
        { key: "gpt-5", inputTokens: 80, outputTokens: 40, costUsd: 0.09 },
      ],
      totals: { inputTokens: 480, outputTokens: 290, costUsd: 0.11 },
    });
    const s = useStore.getState();
    expect(s.usageTotals.costUsd).toBeCloseTo(0.11);
    // En pahalı model başta olmalı.
    expect(s.usageByModel[0]?.model).toBe("gpt-5");
    expect(s.usageByModel).toHaveLength(3);
  });

  it("usage.updated modelin toplamını değiştirir (çift saymaz), genel toplamı yeniden hesaplar, oturum sayacını artırır", () => {
    const store = useStore.getState();
    store.handleEvent("usage.query.ok", {
      rows: [{ key: "claude-sonnet-5", inputTokens: 100, outputTokens: 50, costUsd: 0.02 }],
      totals: { inputTokens: 100, outputTokens: 50, costUsd: 0.02 },
    });
    // totals = kümülatif (delta içinde), delta = bu tur.
    store.handleEvent("usage.updated", {
      provider: "anthropic",
      model: "claude-sonnet-5",
      deltaTokens: 30,
      deltaCostUsd: 0.01,
      totals: { inputTokens: 120, outputTokens: 60, costUsd: 0.03 },
    });
    const s = useStore.getState();
    // Girdi DEĞİŞTİRİLDİ (100+50/0.02 değil, 120+60/0.03) — çift sayım yok.
    expect(s.usageByModel).toHaveLength(1);
    expect(s.usageByModel[0]).toMatchObject({ model: "claude-sonnet-5", provider: "anthropic", costUsd: 0.03 });
    expect(s.usageTotals.costUsd).toBeCloseTo(0.03);
    // Oturum sayacı deltayı biriktirir.
    expect(s.sessionTokens).toBe(30);
    expect(s.sessionCostUsd).toBeCloseTo(0.01);
  });

  it("applySnapshot oturum sayaçlarını sıfırlar ama tüm-zaman dökümüne dokunmaz", () => {
    const store = useStore.getState();
    store.handleEvent("usage.query.ok", {
      rows: [{ key: "gpt-5", inputTokens: 10, outputTokens: 5, costUsd: 0.05 }],
      totals: { inputTokens: 10, outputTokens: 5, costUsd: 0.05 },
    });
    store.handleEvent("usage.updated", {
      provider: "openai",
      model: "gpt-5",
      deltaTokens: 15,
      deltaCostUsd: 0.05,
      totals: { inputTokens: 20, outputTokens: 10, costUsd: 0.1 },
    });
    expect(useStore.getState().sessionTokens).toBe(15);

    useStore.getState().applySnapshot({ providers: [], runs: [], pendingPermissions: [] }, "0.1.0");
    const s = useStore.getState();
    expect(s.sessionTokens).toBe(0);
    expect(s.sessionCostUsd).toBe(0);
    // Tüm-zaman dökümü korunur (yeniden seed usage.query.ok ile gelir).
    expect(s.usageByModel).toHaveLength(1);
    expect(s.usageTotals.costUsd).toBeCloseTo(0.1);
  });

  it("usage.updated cache token'larını oturum sayacına biriktirir (opsiyonel alan)", () => {
    const store = useStore.getState();
    store.handleEvent("usage.updated", {
      provider: "anthropic",
      model: "claude-opus-4-8",
      deltaTokens: 100,
      deltaCostUsd: 0.01,
      totals: { inputTokens: 80, outputTokens: 20, costUsd: 0.01 },
      cacheReadTokens: 6656,
      cacheCreationTokens: 128,
    });
    const s = useStore.getState();
    expect(s.sessionCacheReadTokens).toBe(6656);
    expect(s.sessionCacheCreationTokens).toBe(128);
    // Cache alanı olmayan olay sayaçları bozmaz.
    store.handleEvent("usage.updated", {
      provider: "ollama",
      model: "qwen3:8b",
      deltaTokens: 10,
      deltaCostUsd: 0,
      totals: { inputTokens: 7, outputTokens: 3, costUsd: 0 },
    });
    expect(useStore.getState().sessionCacheReadTokens).toBe(6656);
  });

  it("provider.limits sağlayıcı başına son görüntüyü saklar; applySnapshot temizler", () => {
    const store = useStore.getState();
    store.handleEvent("provider.limits", {
      provider: "anthropic",
      requestsRemaining: 48,
      requestsLimit: 50,
      tokensRemaining: 18000,
      tokensLimit: 20000,
      at: 1,
    });
    expect(useStore.getState().limits.anthropic?.requestsRemaining).toBe(48);
    // Aynı sağlayıcının yeni görüntüsü eskisini değiştirir.
    store.handleEvent("provider.limits", { provider: "anthropic", requestsRemaining: 40, requestsLimit: 50, at: 2 });
    expect(useStore.getState().limits.anthropic?.requestsRemaining).toBe(40);

    useStore.getState().applySnapshot({ providers: [], runs: [], pendingPermissions: [] }, "0.1.0");
    expect(Object.keys(useStore.getState().limits)).toHaveLength(0);
    expect(useStore.getState().sessionCacheReadTokens).toBe(0);
  });

  it("hardware.updated GPU örneğini saklar; applySnapshot bayat örneği temizler", () => {
    const store = useStore.getState();
    store.handleEvent("hardware.updated", {
      gpus: [{ index: 0, name: "RTX 4070", utilizationPct: 90, memUsedMb: 8100, memTotalMb: 12282, temperatureC: 72 }],
      sampledAt: 1,
    });
    expect(useStore.getState().gpus).toHaveLength(1);
    expect(useStore.getState().gpus[0]?.utilizationPct).toBe(90);

    // Yeni bağlantı bayat GPU'yu temizler (daemon hello sonrası son örneği yeniden yollar).
    useStore.getState().applySnapshot({ providers: [], runs: [], pendingPermissions: [] }, "0.1.0");
    expect(useStore.getState().gpus).toHaveLength(0);
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

  it("agent.delta koşu başına metni biriktirir; araç başlayınca ve koşu bitince temizlenir (ADR-012)", () => {
    const store = useStore.getState();
    store.handleEvent("agent.delta", { runId: RUN, text: "Merhaba " });
    store.handleEvent("agent.delta", { runId: RUN, text: "dünya" });
    expect(useStore.getState().runStreams[RUN]).toBe("Merhaba dünya");

    // Yeni tur (araç başladı) → önceki turun metni temizlenir.
    store.handleEvent("agent.tool.started", { runId: RUN, tool: "glob", argsSummary: "glob *" });
    expect(useStore.getState().runStreams[RUN]).toBeUndefined();

    // Koşu bitince de kalıntı bırakmaz.
    store.handleEvent("agent.delta", { runId: RUN, text: "son cevap" });
    store.handleEvent("agent.run.completed", { runId: RUN, usage: { costUsd: 0 } });
    expect(useStore.getState().runStreams[RUN]).toBeUndefined();
  });

  it("runStreams sınırsız büyümez — son MAX_RUN_STREAM_CHARS karakter tutulur (rapor §5.2)", () => {
    const store = useStore.getState();
    // 2000 "a" + 2000 "b" = 4000; son 2000 karakter TAMAMEN "b" olmalı (eski "a"lar budandı).
    store.handleEvent("agent.delta", { runId: RUN, text: "a".repeat(2000) });
    store.handleEvent("agent.delta", { runId: RUN, text: "b".repeat(2000) });
    expect(useStore.getState().runStreams[RUN]).toBe("b".repeat(2000));
  });

  it("agent.run.state cancelled: satır panoda ZOMBİ kalmaz — completed/failed gibi kaldırılır (rapor §5.3)", () => {
    const store = useStore.getState();
    store.handleEvent("agent.run.started", { runId: RUN, agentId: "coder", task: "iş", model: "m" });
    store.handleEvent("agent.delta", { runId: RUN, text: "yarım kalan" });
    expect(useStore.getState().runs).toHaveLength(1);

    store.handleEvent("agent.run.state", { runId: RUN, state: "cancelled" });
    expect(useStore.getState().runs).toHaveLength(0); // ZOMBİ satır yok
    expect(useStore.getState().runStreams[RUN]).toBeUndefined();
  });

  it("Faz 4 'hangi dosya': write_file diff'i İZİN ONAYLANIP kart kapansa da runFiles'ta KALIR", () => {
    const store = useStore.getState();
    store.handleEvent("agent.tool.requested", {
      runId: RUN,
      requestId: "r1",
      tool: "write_file",
      args: { path: "a.txt" },
      riskClass: "mutating",
      diff: "--- a.txt\n+++ a.txt\n+yeni satır",
    });
    expect(useStore.getState().runFiles[RUN]?.diff).toContain("+yeni satır");

    // İzin cevaplanınca kart (pendingPermissions) temizlenir ama runFiles KALIR.
    store.handleEvent("permission.resolved", { requestId: "r1", decision: "allow" });
    expect(useStore.getState().pendingPermissions).toHaveLength(0);
    expect(useStore.getState().runFiles[RUN]?.diff).toContain("+yeni satır");

    store.handleEvent("agent.tool.completed", {
      runId: RUN,
      tool: "write_file",
      ok: true,
      resultSummary: "Yazıldı: a.txt (9 karakter)",
      durationMs: 5,
    });
    expect(useStore.getState().runFiles[RUN]?.result).toContain("Yazıldı");
    expect(useStore.getState().runFiles[RUN]?.diff).toContain("+yeni satır"); // hâlâ duruyor
  });

  it("Faz 4 'hangi dosya': read_file (izin istemez) started'tan başlık, completed'tan sonuç önizlemesi alır", () => {
    const store = useStore.getState();
    store.handleEvent("agent.tool.started", {
      runId: RUN,
      tool: "read_file",
      argsSummary: "read_file a.txt",
    });
    expect(useStore.getState().runFiles[RUN]).toMatchObject({ tool: "read_file", summary: "read_file a.txt" });
    expect(useStore.getState().runFiles[RUN]?.diff).toBeUndefined(); // read_file'da diff YOK

    store.handleEvent("agent.tool.completed", {
      runId: RUN,
      tool: "read_file",
      ok: true,
      resultSummary: "dosya içeriği burada",
      durationMs: 2,
    });
    expect(useStore.getState().runFiles[RUN]?.result).toBe("dosya içeriği burada");
  });

  it("Faz 4 'hangi dosya': dosya-dışı araçlar (glob/grep) runFiles'ı hiç DOKUNMAZ", () => {
    const store = useStore.getState();
    store.handleEvent("agent.tool.started", { runId: RUN, tool: "glob", argsSummary: "glob *.ts" });
    expect(useStore.getState().runFiles[RUN]).toBeUndefined();
  });

  it("Faz 4 'hangi dosya': koşu tamamlanınca/başarısız olunca runFiles temizlenir", () => {
    const store = useStore.getState();
    store.handleEvent("agent.tool.started", { runId: RUN, tool: "read_file", argsSummary: "read_file a.txt" });
    expect(useStore.getState().runFiles[RUN]).toBeDefined();

    store.handleEvent("agent.run.completed", {
      runId: RUN,
      result: "bitti",
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    });
    expect(useStore.getState().runFiles[RUN]).toBeUndefined();
  });
});

describe("orderRunsForDisplay (Faz 5, ADR-014)", () => {
  const CHILD = "66666666-6666-4666-8666-666666666666";
  const OTHER_TOP = "77777777-7777-4777-8777-777777777777";

  function run(runId: string, overrides: Partial<ActiveRun> = {}): ActiveRun {
    return { runId, agentId: "a", task: "t", state: "thinking", ...overrides };
  }

  it("çocuk, ekleniş sırası ne olursa olsun ebeveyninin HEMEN ALTINA taşınır", () => {
    // upsertRun başa ekler — çocuk pratikte ebeveyninden ÖNCE gelebilir (gerçek senaryo).
    const ordered = orderRunsForDisplay([run(CHILD, { parentRunId: RUN }), run(RUN)]);
    expect(ordered.map((r) => r.runId)).toEqual([RUN, CHILD]);
  });

  it("birden çok üst-düzey koşu + çocuklar doğru gruplanır (üst-düzeylerin KENDİ ARALARINDAKİ sırası korunur)", () => {
    const ordered = orderRunsForDisplay([
      run(CHILD, { parentRunId: RUN }),
      run(OTHER_TOP),
      run(RUN),
    ]);
    // Üst-düzeyler dizideki göreli sırayla (OTHER_TOP önce, RUN sonra) kalır; RUN'ın hemen
    // ardından KENDİ çocuğu (CHILD) gelir.
    expect(ordered.map((r) => r.runId)).toEqual([OTHER_TOP, RUN, CHILD]);
  });

  it("sahipsiz çocuk (ebeveyni listede yok) kaybolmaz, sona düşer", () => {
    const ordered = orderRunsForDisplay([run(CHILD, { parentRunId: "yok-boyle-runid" })]);
    expect(ordered.map((r) => r.runId)).toEqual([CHILD]);
  });
});

describe("groupRunsByProject (Faz 4, ADR-015)", () => {
  const CHILD = "88888888-8888-4888-8888-888888888888";
  const OTHER_TOP = "99999999-9999-4999-8999-999999999999";

  function run(runId: string, overrides: Partial<ActiveRun> = {}): ActiveRun {
    return { runId, agentId: "a", task: "t", state: "thinking", ...overrides };
  }

  it("cwd'nin basename'ine göre gruplar — hem Windows (\\) hem POSIX (/) ayracı", () => {
    const groups = groupRunsByProject([
      run(RUN, { cwd: "C:\\Users\\brkn2\\Desktop\\symphony" }),
      run(OTHER_TOP, { cwd: "/home/brkn/other-repo" }),
    ]);
    expect(groups.map((g) => g.name).sort()).toEqual(["other-repo", "symphony"]);
    expect(groups.find((g) => g.name === "symphony")?.cwd).toBe("C:\\Users\\brkn2\\Desktop\\symphony");
  });

  it("çocuk koşu (Faz 5), ebeveynin cwd'sini birebir devraldığı için AYNI grupta kalır", () => {
    const cwd = "C:\\ws\\proje";
    const groups = groupRunsByProject([
      run(RUN, { cwd }),
      run(CHILD, { cwd, parentRunId: RUN }), // run_agent: çocuk cwd'yi ebeveynden birebir alır
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.runs.map((r) => r.runId)).toEqual([RUN, CHILD]); // grup İÇİNDE de girintili sıra
  });

  it("aynı cwd'li iki üst-düzey koşu TEK grupta toplanır", () => {
    const cwd = "C:\\ws\\proje";
    const groups = groupRunsByProject([run(RUN, { cwd }), run(OTHER_TOP, { cwd })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.runs).toHaveLength(2);
  });
});
