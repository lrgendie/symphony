/**
 * Bağlam haritası yakınlaştır/kaydır matematiği (kullanıcı isteği, 2026-07-11) — SAF: DOM/React
 * yok, `ContextMap.tsx`'in olay dinleyicileri bu fonksiyonları çağırır. `ui` paketinde React
 * bileşen testi altyapısı (jsdom/testing-library) YOK — bu yüzden hesap React'tan AYRILDI ki
 * `layout.test.ts` deseniyle AYNI şekilde (saf girdi/çıktı) test edilebilsin.
 */

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Fare tekerleği: imlecin ALTINDAKİ nokta sabit kalacak şekilde `viewBox`'ı küçültür/büyütür
 * (harita uygulamalarının standart "zoom to cursor" matematiği). `cursorFx`/`cursorFy`: imlecin
 * SVG'nin render edilmiş dikdörtgenindeki KESRİ konumu (0..1) — piksel değil, çözünürlükten
 * bağımsız. `zoomingIn`: tekerlek yukarı (deltaY<0) mi.
 */
export function zoomViewBox(
  vb: ViewBox,
  args: { cursorFx: number; cursorFy: number; zoomingIn: boolean; zoomStep: number; minW: number; maxW: number },
): ViewBox {
  const zoomFactor = args.zoomingIn ? args.zoomStep : 1 / args.zoomStep;
  const newW = clamp(vb.w * zoomFactor, args.minW, args.maxW);
  const newH = vb.h * (newW / vb.w);
  // İmlecin altındaki nokta (kullanıcı-uzayında) — zoom SONRASI da AYNI kesirde kalmalı.
  const px = vb.x + args.cursorFx * vb.w;
  const py = vb.y + args.cursorFy * vb.h;
  return { x: px - args.cursorFx * newW, y: py - args.cursorFy * newH, w: newW, h: newH };
}

/**
 * Tekerlek tuşu (orta tık) sürüklemesi: `viewBox`'ı öteler. `dxFraction`/`dyFraction`: sürükleme
 * mesafesinin SVG dikdörtgenine oranı (0..1 arası, işaretli) — `startViewBox` sürüklemenin
 * BAŞLADIĞI viewBox'tır (her mousemove'da BAŞLANGIÇTAN hesaplanır, önceki adımdan BİRİKMEZ —
 * sürükleme sırasında ufak hatalar birikip kaymayı ÖNLER).
 */
export function panViewBox(startViewBox: ViewBox, args: { dxFraction: number; dyFraction: number }): ViewBox {
  return {
    ...startViewBox,
    x: startViewBox.x - args.dxFraction * startViewBox.w,
    y: startViewBox.y - args.dyFraction * startViewBox.h,
  };
}
