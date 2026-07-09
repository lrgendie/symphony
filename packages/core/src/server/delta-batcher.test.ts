import { describe, expect, it, vi } from "vitest";
import { DeltaBatcher } from "./delta-batcher.js";

describe("DeltaBatcher (rapor §5.1 — yayın amplifikasyonu azaltma)", () => {
  it("aynı anahtara ardışık push'lar TEK flush'ta birleşir", () => {
    const flushed: Array<{ key: string; text: string }> = [];
    const batcher = new DeltaBatcher((key, text) => flushed.push({ key, text }));
    batcher.push("run-1", "Mer");
    batcher.push("run-1", "ha");
    batcher.push("run-1", "ba");
    batcher.flush("run-1");
    expect(flushed).toEqual([{ key: "run-1", text: "Merhaba" }]);
  });

  it("farklı anahtarlar (runId/sessionId) BAĞIMSIZ tamponlanır", () => {
    const flushed: Array<{ key: string; text: string }> = [];
    const batcher = new DeltaBatcher((key, text) => flushed.push({ key, text }));
    batcher.push("run-a", "A");
    batcher.push("run-b", "B");
    batcher.flush("run-a");
    batcher.flush("run-b");
    expect(flushed).toEqual([
      { key: "run-a", text: "A" },
      { key: "run-b", text: "B" },
    ]);
  });

  it("boş tampon flush'ı no-op'tur (onFlush çağrılmaz)", () => {
    const onFlush = vi.fn();
    const batcher = new DeltaBatcher(onFlush);
    batcher.flush("hiç-push-edilmemiş");
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("çift flush idempotent: ikinci çağrı tekrar yayınlamaz", () => {
    const flushed: string[] = [];
    const batcher = new DeltaBatcher((_key, text) => flushed.push(text));
    batcher.push("run-1", "x");
    batcher.flush("run-1");
    batcher.flush("run-1");
    expect(flushed).toEqual(["x"]);
  });

  it("zamanlayıcı süresi dolunca otomatik flush eder (explicit flush çağrılmasa bile)", async () => {
    vi.useFakeTimers();
    try {
      const flushed: string[] = [];
      const batcher = new DeltaBatcher((_key, text) => flushed.push(text), 40);
      batcher.push("run-1", "geç gelen");
      expect(flushed).toEqual([]); // henüz süre dolmadı
      vi.advanceTimersByTime(40);
      expect(flushed).toEqual(["geç gelen"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
