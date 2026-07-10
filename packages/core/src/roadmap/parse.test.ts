import { describe, expect, it } from "vitest";
import { parseRoadmap } from "./parse.js";

// Fixture: bu deponun gerçek ROADMAP.md'sinden alınmış küçük bir kesit (Faz 0 + Faz 4).
const FIXTURE = `# 🎼 SYMPHONY — Yol Haritası

## 4. Fazlar

### Faz 0 — Temel Atma (1. hafta) ✅ 2026-07-03
- [x] pnpm monorepo + TypeScript + ESLint/Prettier kurulumu
- [x] \`packages/shared\`: olay/mesaj tipleri
- **Çıktı:** \`pnpm build\` ve \`pnpm test\` çalışan iskelet repo.
- **Kabul testi:** Temiz klonda sıfır hatayla geçer.

### Faz 4 — Masaüstü: Orkestra Sahnesi (9–11. hafta) — çekirdek TAMAM, birkaç görsel/UX dilimi kalan
- [x] Tauri 2 + React dashboard, daemon'un WS akışına bağlanır
- [~] **Şef Paneli:** aktif agent'lar + canlı log akışı ✅ · izin istekleri
  masaüstünden CEVAPLANABİLİYOR ✅ (dilim 2, kart + renkli diff)
- [ ] **Yol haritası görselleştirme:** projelerin ROADMAP/plan dosyalarından
- [ ] Proje görünümü: hangi projede hangi agent ne yapıyor
`;

describe("parseRoadmap", () => {
  it("gerçek ROADMAP.md kesitinde fazları doğru sayar (done/total/state)", () => {
    const phases = parseRoadmap(FIXTURE);
    expect(phases).toHaveLength(2);

    // Başlıkta ✅ var → state=done, adım sayımından bağımsız.
    expect(phases[0]).toEqual({
      title: "Faz 0 — Temel Atma (1. hafta) ✅ 2026-07-03",
      done: 2,
      total: 2,
      state: "done",
    });

    // Başlıkta ✅ yok; [~] var → state=in_progress.
    expect(phases[1]).toEqual({
      title: "Faz 4 — Masaüstü: Orkestra Sahnesi (9–11. hafta) — çekirdek TAMAM, birkaç görsel/UX dilimi kalan",
      done: 1,
      total: 4,
      state: "in_progress",
    });
  });

  it("0<done<total ve [~] yokken de in_progress türetir", () => {
    const phases = parseRoadmap("### Faz X\n- [x] bir\n- [ ] iki\n");
    expect(phases[0]).toEqual({ title: "Faz X", done: 1, total: 2, state: "in_progress" });
  });

  it("done===total>0 ise başlıkta ✅ olmasa da state=done", () => {
    const phases = parseRoadmap("### Faz Y\n- [x] bir\n- [x] iki\n");
    expect(phases[0]).toEqual({ title: "Faz Y", done: 2, total: 2, state: "done" });
  });

  it("hiç adım yoksa (total=0) state=todo", () => {
    const phases = parseRoadmap("### Faz Boş\nsadece düz metin.\n");
    expect(phases[0]).toEqual({ title: "Faz Boş", done: 0, total: 0, state: "todo" });
  });

  it("başlık satırı olmadan gelen checkbox'ları yok sayar", () => {
    expect(parseRoadmap("- [x] sahipsiz adım\n")).toEqual([]);
  });

  it("`- **` gibi bullet olmayan satırları adım saymaz (Çıktı/Kabul testi)", () => {
    const phases = parseRoadmap("### Faz X\n- **Çıktı:** bir şey.\n- [x] gerçek adım\n");
    expect(phases[0]).toEqual({ title: "Faz X", done: 1, total: 1, state: "done" });
  });

  it("faz içermeyen metinde boş dizi döner", () => {
    expect(parseRoadmap("sadece düz metin\nbaşka bir satır\n")).toEqual([]);
  });

  it("#### (4 diyez) alt başlığını faz saymaz", () => {
    const phases = parseRoadmap("### Faz Z\n#### alt başlık\n- [ ] adım\n");
    expect(phases).toHaveLength(1);
    expect(phases[0]).toEqual({ title: "Faz Z", done: 0, total: 1, state: "todo" });
  });
});
