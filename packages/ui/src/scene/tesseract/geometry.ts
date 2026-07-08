/**
 * Yaşayan Tesseract'ın SAF geometrisi — React/Three.js YOK → birim test edilebilir.
 * TASARIM.md §2 (2026-07-08, katmanlı revizyon): ÜÇ kademeli küp yapısı.
 *  - DIŞ küp (bakır enerji iskeleti) + İÇ küp (cyan sinaps ağı) = gerçek 4B hiperküpün
 *    (16 köşe, w=±1) perspektif projeksiyonu; XW düzleminde hiper-dönüş yapıyı canlı tutar.
 *  - DERİN küp (violet çekirdek kafesi) = iç kübün merkeze doğru ölçekli kopyası
 *    (görsel1'deki en içteki mor küp) — iç küple birlikte nefes alır/şişer.
 *  - Çekirdek (origin, kırmızı kalp). Akış zinciri: köprü (dış→iç) → bağ (iç→derin) →
 *    spoke (derin→çekirdek); kenar uçları DAİMA merkeze-doğru a→b sıralıdır (converge dir=+1).
 */

export type NodeLayer = "outer" | "inner" | "deep" | "core";
export type EdgeKind = "outer" | "inner" | "deep" | "bridge" | "link" | "spoke";

export interface TesseractNode {
  /** nodes[] içindeki dizin — kenarlar bu id'ye işaret eder (sıra: outer→inner→deep→core). */
  id: number;
  layer: NodeLayer;
  /** 4B taban köşesi (yalnız outer/inner; deep/core türetilir). */
  base4: readonly [number, number, number, number] | null;
  /** deep: izlediği İÇ köşenin node id'si. */
  anchor: number | null;
}

export interface TesseractEdge {
  /**
   * Uçlar node id'sidir. Merkeze-akış yönü DAİMA a→b olacak şekilde sıralanır:
   * bridge b=iç, link b=derin, spoke b=çekirdek (converge salvosu dir=+1 ile içeri akar).
   */
  id: number;
  a: number;
  b: number;
  kind: EdgeKind;
}

export interface TesseractTopology {
  nodes: readonly TesseractNode[];
  edges: readonly TesseractEdge[];
}

/** 4B→3B perspektif bölme: f = K/(K−w). K=3 → dış küp 1.5×, iç küp 0.75× (2:1 derinlik hissi). */
export const PROJECT_K = 3;
/** Dünya ölçeği: dış köşe eksen başına ~±0.99 → yarıçap ≈1.71 (kamera z≈4.9, fov 50 çerçeveler). */
export const BASE_SCALE = 0.66;
/** Derin kübün iç kübe oranı (iç köşe pozisyonu × bu = derin köşe; şişmeyi otomatik izler). */
export const DEEP_SCALE = 0.48;

/** Köşe bitleri → eksen işaretleri (bit0=x, bit1=y, bit2=z). */
function cornerSigns(i: number): readonly [number, number, number] {
  return [(i & 1) === 0 ? -1 : 1, (i & 2) === 0 ? -1 : 1, (i & 4) === 0 ? -1 : 1];
}

export function buildTesseract(): TesseractTopology {
  const nodes: TesseractNode[] = [];
  for (let i = 0; i < 8; i++) {
    const [x, y, z] = cornerSigns(i);
    nodes.push({ id: i, layer: "outer", base4: [x, y, z, 1], anchor: null });
  }
  for (let i = 0; i < 8; i++) {
    const [x, y, z] = cornerSigns(i);
    nodes.push({ id: 8 + i, layer: "inner", base4: [x, y, z, -1], anchor: null });
  }
  for (let i = 0; i < 8; i++) {
    nodes.push({ id: 16 + i, layer: "deep", base4: null, anchor: 8 + i });
  }
  nodes.push({ id: 24, layer: "core", base4: null, anchor: null });

  const edges: TesseractEdge[] = [];
  const pushEdge = (a: number, b: number, kind: EdgeKind): void => {
    edges.push({ id: edges.length, a, b, kind });
  };
  // Küp kenarları: tam BİR eksende (bit) ayrışan köşe çiftleri — küp başına 12 kenar.
  for (const [offset, kind] of [
    [0, "outer"],
    [8, "inner"],
    [16, "deep"],
  ] as const) {
    for (let i = 0; i < 8; i++) {
      for (const bit of [1, 2, 4]) {
        if ((i & bit) === 0) pushEdge(offset + i, offset + (i | bit), kind);
      }
    }
  }
  // Köprüler: aynı (x,y,z) işaret desenli dış→iç köşe (merkeze doğru).
  for (let i = 0; i < 8; i++) pushEdge(i, 8 + i, "bridge");
  // Bağlar: iç→derin köşe (akış zincirinin ikinci kademesi).
  for (let i = 0; i < 8; i++) pushEdge(8 + i, 16 + i, "link");
  // Spoke'lar: derin köşelerden çekirdeğe (son kademe).
  for (let i = 0; i < 8; i++) pushEdge(16 + i, 24, "spoke");

  return { nodes, edges };
}

/**
 * Tüm düğümlerin grup-yerel pozisyonlarını out'a (uzunluk nodes.length*3) yazar.
 * hyperAngle: XW düzleminde 4B dönüş (salınım ±~0.38 rad — küpler kimlik değiştirmez).
 * innerSwell: İÇ kübü şişirir (VRAM doluluğu; 1 = normal) — derin küp türetildiği için izler.
 * GC yok — çağıran arabelleği yeniden kullanır. Node sırası (outer→inner→deep→core)
 * korunmalıdır: derin köşe, daha önce yazılmış iç köşe pozisyonundan türetilir.
 */
export function projectNodes(
  topology: TesseractTopology,
  hyperAngle: number,
  innerSwell: number,
  out: Float32Array,
): void {
  const ca = Math.cos(hyperAngle);
  const sa = Math.sin(hyperAngle);
  for (const node of topology.nodes) {
    const o = node.id * 3;
    if (node.base4 !== null) {
      const [x, y, z, w] = node.base4;
      // 4B dönüş (XW düzlemi): x ve w karışır — projeksiyonda "içe dönme" salınımı doğurur.
      const xr = x * ca - w * sa;
      const wr = x * sa + w * ca;
      const f =
        (PROJECT_K / (PROJECT_K - wr)) * BASE_SCALE * (node.layer === "inner" ? innerSwell : 1);
      out[o] = xr * f;
      out[o + 1] = y * f;
      out[o + 2] = z * f;
    } else if (node.layer === "deep" && node.anchor !== null) {
      const ao = node.anchor * 3;
      out[o] = (out[ao] ?? 0) * DEEP_SCALE;
      out[o + 1] = (out[ao + 1] ?? 0) * DEEP_SCALE;
      out[o + 2] = (out[ao + 2] ?? 0) * DEEP_SCALE;
    } else {
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
    }
  }
}
