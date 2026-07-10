import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRoadmap } from "./client.js";

/**
 * `fetchRoadmap` (Faz 4 Dilim P3, ADR-015 Karar 3) — WS'in dışında, istek başına REST çağrısı.
 * `window`/`fetch` bu paketin vitest ortamında ("node") mevcut değildir; testler `vi.stubGlobal`
 * ile enjekte eder (DaemonConnection gibi tarayıcı-bağımlı WS mantığı test edilmez, yalnız bu
 * saf-sayılabilir yardımcı).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRoadmap", () => {
  it("bağlantı bilgisi yoksa (window.__SYMPHONY__ yok) fetch çağırmadan null döner", async () => {
    vi.stubGlobal("window", {});
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await fetchRoadmap("/tmp/proje")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("başarılı cevapta phases'i ayrıştırıp döner; dir kodlanmış + Bearer header gönderilir", async () => {
    vi.stubGlobal("window", { __SYMPHONY__: { token: "tok123", port: 7770 } });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        phases: [{ title: "Faz 0", done: 1, total: 1, state: "done" }],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const phases = await fetchRoadmap("C:/bir proje");
    expect(phases).toEqual([{ title: "Faz 0", done: 1, total: 1, state: "done" }]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `http://127.0.0.1:7770/api/roadmap?dir=${encodeURIComponent("C:/bir proje")}`,
    );
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok123");
  });

  it("404 (ROADMAP.md yok) → null döner", async () => {
    vi.stubGlobal("window", { __SYMPHONY__: { token: "tok123", port: 7770 } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    expect(await fetchRoadmap("/tmp/proje")).toBeNull();
  });

  it("ağ hatası (fetch reddi) → null döner, throw etmez", async () => {
    vi.stubGlobal("window", { __SYMPHONY__: { token: "tok123", port: 7770 } });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(fetchRoadmap("/tmp/proje")).resolves.toBeNull();
  });

  it("şemaya uymayan cevap → null döner", async () => {
    vi.stubGlobal("window", { __SYMPHONY__: { token: "tok123", port: 7770 } });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nope: true }) }),
    );

    expect(await fetchRoadmap("/tmp/proje")).toBeNull();
  });
});
