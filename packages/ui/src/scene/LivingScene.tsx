import { Canvas } from "@react-three/fiber";
import { useEffect, useState } from "react";
import { deriveMood, MOOD_STYLE, type SphereMood } from "./mood";
import { deriveGpuVitals, type GpuVitals } from "./hardware-vitals";
import { Tesseract } from "./TesseractScene";
import { useStore } from "../store";

/**
 * Yaşayan Arayüz (TASARIM.md §2, 2026-07-08 revizyonu): merkezde artık parçacık küresi değil,
 * markanın kendisi — YAŞAYAN TESSERACT (TesseractScene.tsx). Bu bileşen kabuktur: mood'u ve
 * GPU vitallerini store'dan türetir, converge sinyalini (görev bitti / kritik an) toplar,
 * Canvas + HUD'u kurar. Görsel anlam eşlemesi ve sahne mantığı TesseractScene'dedir.
 */

/** Mood'u store'dan türetir; hata flaşının süresi dolsun diye düşük frekansta tik atar. */
function useMood(): SphereMood {
  const status = useStore((s) => s.status);
  const runs = useStore((s) => s.runs);
  const pending = useStore((s) => s.pendingPermissions);
  const lastErrorAt = useStore((s) => s.lastErrorAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 300);
    return () => window.clearInterval(id);
  }, []);
  return deriveMood({
    connected: status === "connected",
    runStates: runs.map((r) => r.state),
    pendingCount: pending.length,
    lastErrorAt,
    now,
  });
}

/** Isı 0..1 → renk: soğuk cyan → amber → sıcak kırmızı (GPU göstergesi rengi). */
function heatColor(heat: number): string {
  const h = Math.max(0, Math.min(1, heat));
  // İki dilim: [cyan→amber] sonra [amber→kırmızı].
  const stops =
    h < 0.5
      ? { a: [34, 211, 238], b: [251, 191, 36], f: h / 0.5 }
      : { a: [251, 191, 36], b: [239, 68, 68], f: (h - 0.5) / 0.5 };
  const c = stops.a.map((av, i) => Math.round(av + ((stops.b[i] ?? av) - av) * stops.f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Hero sahne: yaşayan tesseract + mood HUD (sol-alt) + GPU vital HUD (sağ-üst). */
export function LivingScene(): React.JSX.Element {
  const mood = useMood();
  const gpus = useStore((s) => s.gpus);
  const runs = useStore((s) => s.runs);
  const lastCompletedAt = useStore((s) => s.lastCompletedAt);
  const lastErrorAt = useStore((s) => s.lastErrorAt);
  const vitals = deriveGpuVitals(gpus);
  const style = MOOD_STYLE[mood];
  // Converge salvosu: görev sonuçlanması VEYA kritik an (hata) — en yenisi sinyaldir.
  const convergeSignal =
    lastCompletedAt === null && lastErrorAt === null
      ? null
      : Math.max(lastCompletedAt ?? 0, lastErrorAt ?? 0);
  return (
    <div className="scene">
      <Canvas camera={{ position: [0, 0, 4.9], fov: 50 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <Tesseract mood={mood} vitals={vitals} convergeSignal={convergeSignal} runs={runs} />
      </Canvas>
      {/* HUD çerçeveleme (TASARIM.md §2): köşe braketleri + teknik etiket */}
      <div className="scene-frame" aria-hidden>
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
      </div>
      <div className="scene-tag">SYMPHONY // LIVING CORE · PROTO v1</div>
      <div className="scene-hud">
        <span className="hud-dot" style={{ background: style.color }} />
        <span className="hud-label">{style.label}</span>
      </div>
      {vitals !== null && <GpuGauge vitals={vitals} />}
    </div>
  );
}

/** Sağ-üst GPU göstergesi: tesseract'ın fiziksel (bakır) düzlemini sayısal + çubukla okur. */
function GpuGauge({ vitals }: { vitals: GpuVitals }): React.JSX.Element {
  const color = heatColor(vitals.heat);
  const gb = (mb: number): string => (mb / 1024).toFixed(1);
  return (
    <div className="scene-gpu">
      <div className="gpu-top">
        <span className="gpu-tag">GPU</span>
        <span className="gpu-util" style={{ color }}>
          {Math.round(vitals.utilizationPct)}%
        </span>
      </div>
      <div className="gpu-bar-track">
        <div className="gpu-bar" style={{ width: `${vitals.utilizationPct}%`, background: color }} />
      </div>
      <div className="gpu-sub">
        {gb(vitals.memUsedMb)}/{gb(vitals.memTotalMb)} GB
        {vitals.temperatureC !== null ? ` · ${vitals.temperatureC}°C` : ""}
      </div>
    </div>
  );
}
