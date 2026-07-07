import { describe, expect, it } from "vitest";
import {
  computeWaveField,
  focusWeight,
  rotateDir,
  FOCUS_DIR,
  AMBIENT_DISP,
  type WaveFieldParams,
} from "./wave-field.js";

const BASE: readonly [number, number, number] = [0, 0, 1]; // mavi
const WARM: readonly [number, number, number] = [1, 0, 0]; // kırmızı
const params = (over: Partial<WaveFieldParams> = {}): WaveFieldParams => ({
  radius: 1.5,
  time: 0,
  angleX: 0,
  angleY: 0,
  drive: 0,
  heat: 0,
  ...over,
});

const len3 = (a: Float32Array, o: number): number => Math.hypot(a[o], a[o + 1], a[o + 2]);

describe("rotateDir", () => {
  it("birim uzunluğu korur (ortonormal dönüş)", () => {
    for (const [x, y, z] of [
      [1, 0, 0],
      [0, 1, 0],
      [0.6, -0.48, 0.64],
    ]) {
      const [rx, ry, rz] = rotateDir(x, y, z, 0.7, -1.3);
      expect(Math.hypot(rx, ry, rz)).toBeCloseTo(Math.hypot(x, y, z));
    }
  });

  it("Y ekseninde 90° döndürünce (1,0,0) → ~(0,0,-1)", () => {
    const [x, y, z] = rotateDir(1, 0, 0, 0, Math.PI / 2);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(-1);
  });

  it("sıfır açıda değiştirmez", () => {
    expect(rotateDir(0.2, 0.3, -0.4, 0, 0)).toEqual([0.2, 0.3, -0.4]);
  });
});

describe("focusWeight", () => {
  it("negatif/sıfır hizada 0 (odak-dışı yarıküre atılmaz)", () => {
    expect(focusWeight(-0.5, 2.4)).toBe(0);
    expect(focusWeight(0, 2.4)).toBe(0);
  });

  it("tam hizada 1", () => {
    expect(focusWeight(1, 2.4)).toBeCloseTo(1);
  });

  it("üsle keskinleşir: büyük üs aynı dot'ta daha küçük ağırlık verir (dar bölge)", () => {
    expect(focusWeight(0.5, 4)).toBeLessThan(focusWeight(0.5, 2));
  });
});

describe("computeWaveField", () => {
  it("sürücü ve ısı 0 iken renk tam olarak taban renk (ısınma yok)", () => {
    const pos = new Float32Array(3);
    const col = new Float32Array(3);
    computeWaveField(new Float32Array([...FOCUS_DIR]), pos, col, params(), BASE, WARM);
    expect([col[0], col[1], col[2]]).toEqual([BASE[0], BASE[1], BASE[2]]);
  });

  it("sürücü 0'da yalnız ambient kıpırtı: yarıçap radius'a AMBIENT kadar yakın", () => {
    const dirs = new Float32Array([...FOCUS_DIR]);
    const pos = new Float32Array(3);
    const col = new Float32Array(3);
    computeWaveField(dirs, pos, col, params({ time: 1.234 }), BASE, WARM);
    const r = len3(pos, 0);
    // ambient dalga ± ~AMBIENT*(1+harmonik) civarı; radius'tan sapma küçük olmalı.
    expect(Math.abs(r - 1.5)).toBeLessThan(AMBIENT_DISP * 1.6);
  });

  it("sürücü arttıkça odak bölgesinde deformasyon büyür (zaman taraması)", () => {
    const dirs = new Float32Array([...FOCUS_DIR]); // odakla tam hizalı parçacık
    const spread = (drive: number): number => {
      let min = Infinity;
      let max = -Infinity;
      for (let k = 0; k < 40; k++) {
        const pos = new Float32Array(3);
        const col = new Float32Array(3);
        computeWaveField(dirs, pos, col, params({ drive, time: k * 0.05 }), BASE, WARM);
        const r = len3(pos, 0);
        min = Math.min(min, r);
        max = Math.max(max, r);
      }
      return max - min;
    };
    expect(spread(0.9)).toBeGreaterThan(spread(0.1));
  });

  it("odak (sağ-üst) bölgesi karşı bölgeden daha çok ısınır (renk sıcaklığı dalga yönüne gelir)", () => {
    const warmthAt = (dir: readonly [number, number, number]): number => {
      const pos = new Float32Array(3);
      const col = new Float32Array(3);
      computeWaveField(new Float32Array([...dir]), pos, col, params({ heat: 1, drive: 0.8 }), BASE, WARM);
      return col[0]; // kırmızı kanal = warm'a yakınlık
    };
    const opposite = [-FOCUS_DIR[0], -FOCUS_DIR[1], -FOCUS_DIR[2]] as const;
    expect(warmthAt(FOCUS_DIR)).toBeGreaterThan(warmthAt(opposite));
  });

  it("çıktı diziboyu korunur ve NaN üretmez", () => {
    const n = 50;
    const dirs = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) dirs[i] = Math.sin(i) * 0.5; // kaba yönler
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    computeWaveField(dirs, pos, col, params({ drive: 0.7, heat: 0.5, time: 3.3, angleY: 1.1 }), BASE, WARM);
    expect(pos.some((v) => Number.isNaN(v))).toBe(false);
    expect(col.every((v) => v >= 0)).toBe(true);
  });
});
