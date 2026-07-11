import { describe, expect, it } from "vitest";
import { clamp, panViewBox, zoomViewBox, type ViewBox } from "./viewbox.js";

/** Bağlam haritası yakınlaştır/kaydır matematiği (kullanıcı isteği, 2026-07-11) — SAF, DOM yok. */

const BASE: ViewBox = { x: 0, y: 0, w: 900, h: 560 };
const ZOOM_OPTS = { zoomStep: 0.9, minW: 90, maxW: 3600 };

describe("clamp", () => {
  it("aralık içindeyse değeri aynen döner", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("alt sınırın altındaysa alta sabitler", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });
  it("üst sınırın üstündeyse üste sabitler", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe("zoomViewBox — 'zoom to cursor' (harita uygulamalarının standart matematiği)", () => {
  it("merkeze yakınlaştırma: genişlik/yükseklik KÜÇÜLÜR (zoomStep ile), merkez SABİT kalır", () => {
    const result = zoomViewBox(BASE, { cursorFx: 0.5, cursorFy: 0.5, zoomingIn: true, ...ZOOM_OPTS });
    expect(result.w).toBeCloseTo(BASE.w * 0.9, 6);
    expect(result.h).toBeCloseTo(BASE.h * 0.9, 6);
    // Merkez nokta (450,280) zoom SONRASI da viewBox'ın merkezinde kalmalı.
    expect(result.x + result.w / 2).toBeCloseTo(BASE.x + BASE.w / 2, 6);
    expect(result.y + result.h / 2).toBeCloseTo(BASE.y + BASE.h / 2, 6);
  });

  it("merkezden uzaklaşma: genişlik/yükseklik BÜYÜR (1/zoomStep ile)", () => {
    const result = zoomViewBox(BASE, { cursorFx: 0.5, cursorFy: 0.5, zoomingIn: false, ...ZOOM_OPTS });
    expect(result.w).toBeCloseTo(BASE.w / 0.9, 6);
    expect(result.h).toBeCloseTo(BASE.h / 0.9, 6);
  });

  it("imleç MERKEZDE DEĞİLSE: imlecin altındaki DÜNYA NOKTASI zoom sonrası AYNI kesirde kalır (asıl kanıt)", () => {
    const cursorFx = 0.25;
    const cursorFy = 0.75;
    // Zoom ÖNCESİ imlecin altındaki dünya noktası.
    const worldXBefore = BASE.x + cursorFx * BASE.w;
    const worldYBefore = BASE.y + cursorFy * BASE.h;

    const result = zoomViewBox(BASE, { cursorFx, cursorFy, zoomingIn: true, ...ZOOM_OPTS });

    // Zoom SONRASI, AYNI kesirdeki dünya noktası — İMLECİN ALTINDAKİ HİÇ KAYMAMALI.
    const worldXAfter = result.x + cursorFx * result.w;
    const worldYAfter = result.y + cursorFy * result.h;
    expect(worldXAfter).toBeCloseTo(worldXBefore, 6);
    expect(worldYAfter).toBeCloseTo(worldYBefore, 6);
  });

  it("en-boy oranı KORUNUR (yükseklik/genişlik oranı sabit kalır)", () => {
    const result = zoomViewBox(BASE, { cursorFx: 0.3, cursorFy: 0.8, zoomingIn: true, ...ZOOM_OPTS });
    expect(result.h / result.w).toBeCloseTo(BASE.h / BASE.w, 9);
  });

  it("tekrarlanan yakınlaştırma MIN_VIEW_W altına DÜŞMEZ (sınır korunur)", () => {
    let vb = BASE;
    for (let i = 0; i < 100; i++) {
      vb = zoomViewBox(vb, { cursorFx: 0.5, cursorFy: 0.5, zoomingIn: true, ...ZOOM_OPTS });
    }
    expect(vb.w).toBeGreaterThanOrEqual(ZOOM_OPTS.minW);
    expect(vb.w).toBeCloseTo(ZOOM_OPTS.minW, 6);
  });

  it("tekrarlanan uzaklaştırma MAX_VIEW_W üstüne ÇIKMAZ (sınır korunur)", () => {
    let vb = BASE;
    for (let i = 0; i < 100; i++) {
      vb = zoomViewBox(vb, { cursorFx: 0.5, cursorFy: 0.5, zoomingIn: false, ...ZOOM_OPTS });
    }
    expect(vb.w).toBeLessThanOrEqual(ZOOM_OPTS.maxW);
    expect(vb.w).toBeCloseTo(ZOOM_OPTS.maxW, 6);
  });

  it("sınıra dayanınca dahi merkez SABİT kalır (kırpma zoom-to-cursor'u bozmaz)", () => {
    const atMin: ViewBox = { x: 100, y: 50, w: ZOOM_OPTS.minW, h: (ZOOM_OPTS.minW * BASE.h) / BASE.w };
    const result = zoomViewBox(atMin, { cursorFx: 0.5, cursorFy: 0.5, zoomingIn: true, ...ZOOM_OPTS });
    expect(result.w).toBe(ZOOM_OPTS.minW); // daha KÜÇÜLEMEDİ
    expect(result.x + result.w / 2).toBeCloseTo(atMin.x + atMin.w / 2, 6);
  });
});

describe("panViewBox — tekerlek tuşu (orta tık) sürüklemesi", () => {
  it("genişlik/yükseklik DEĞİŞMEZ, yalnız konum kayar", () => {
    const result = panViewBox(BASE, { dxFraction: 0.1, dyFraction: -0.2 });
    expect(result.w).toBe(BASE.w);
    expect(result.h).toBe(BASE.h);
  });

  it("sağa sürükleme (+dx) → viewBox SOLA kayar (içerik fareyi TAKİP eder, tuval değil)", () => {
    const result = panViewBox(BASE, { dxFraction: 0.1, dyFraction: 0 });
    expect(result.x).toBeCloseTo(BASE.x - 0.1 * BASE.w, 6);
  });

  it("aşağı sürükleme (+dy) → viewBox YUKARI kayar", () => {
    const result = panViewBox(BASE, { dxFraction: 0, dyFraction: 0.2 });
    expect(result.y).toBeCloseTo(BASE.y - 0.2 * BASE.h, 6);
  });

  it("sürükleme HER ZAMAN başlangıç viewBox'tan hesaplanır — art arda çağrılar BİRİKMEZ (kaymayı önler)", () => {
    const drag1 = panViewBox(BASE, { dxFraction: 0.05, dyFraction: 0.05 });
    const drag2 = panViewBox(BASE, { dxFraction: 0.1, dyFraction: 0.1 }); // AYNI başlangıçtan, farklı mesafe
    expect(drag2.x).toBeCloseTo(BASE.x - 0.1 * BASE.w, 6);
    expect(drag1.x).not.toBe(drag2.x);
  });
});
