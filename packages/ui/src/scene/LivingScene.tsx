import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { deriveMood, MOOD_STYLE, type SphereMood } from "./mood";
import { deriveGpuVitals, type GpuVitals } from "./hardware-vitals";
import { computeWaveField } from "./wave-field";
import { useStore } from "../store";

/**
 * Yaşayan Arayüz (TASARIM.md §2): merkezde nefes alan parçacık küresi. İki katman sürer:
 *  1) MOOD (scene/mood.ts) — sistem NE YAPIYOR: boşta nefes, düşünürken hız, çalışırken
 *     magenta, izin beklerken amber, hatada kırmızı flaş. Taban renk + nefes + dönüş.
 *  2) FİZİKSEL vitaller (scene/hardware-vitals.ts) — donanım NE HİSSEDİYOR: GPU yükü.
 * Yük/LLM aktivitesi ARTIK ölçek-nabzı değil, yüzeyde ilerleyen VEKTÖREL DALGA ile ifade edilir
 * (scene/wave-field.ts): dalga ekran sağ-üste (GPU göstergesine) doğru rulo yapar, orada keskinleşir
 * ve ısınır. Ham GPU verisi sert sıçrar; yumuşatma ref'leriyle görsel yumuşak ramp'e çevrilir.
 * Her hareketin gerçek bir anlamı var (TASARIM ilkesi).
 */

const PARTICLE_COUNT = 1700;
const RADIUS = 1.5;
/** Isının çektiği "sıcak" uç renk (turuncu-kırmızı); odak/ısı arttıkça taban renge bu kadar karışır. */
const WARM_COLOR = "#ff5a36";
/** Yumuşatma zaman sabitleri: yüke hızlı ama YUMUŞAK biner, yavaş söner (afterglow). */
const RISE_TAU = 0.55;
const FALL_TAU = 1.4;

/** Fibonacci küresi: birim yönleri yüzeye düzgün (kümelenmeden) dağıtır. */
function fibonacciSphere(count: number): Float32Array {
  const dirs = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    dirs[i * 3] = Math.cos(theta) * r;
    dirs[i * 3 + 1] = y;
    dirs[i * 3 + 2] = Math.sin(theta) * r;
  }
  return dirs;
}

/** Yumuşatma: hedefe doğru kare-hızından bağımsız (exp) lerp; iniş/çıkış farklı zaman sabiti. */
function smoothToward(current: number, target: number, delta: number): number {
  const tau = target > current ? RISE_TAU : FALL_TAU;
  return current + (target - current) * (1 - Math.exp(-delta / tau));
}

function Particles({
  mood,
  vitals,
}: {
  mood: SphereMood;
  vitals: GpuVitals | null;
}): React.JSX.Element {
  const ref = useRef<THREE.Points>(null);
  const baseCol = useRef(new THREE.Color());
  const warm = useMemo(() => {
    const c = new THREE.Color(WARM_COLOR);
    return [c.r, c.g, c.b] as [number, number, number];
  }, []);
  // Yumuşatılmış sürücüler (ham GPU verisi sert sıçrar; görseli yumuşat).
  const drive = useRef(0);
  const heatSmooth = useRef(0);
  // Biriken dönüş açıları — dönüş wave-field'da pozisyona pişirilir (odak world-uzayında sabit).
  const angleX = useRef(0);
  const angleY = useRef(0);

  const { geometry, baseDirs, outPos, outCol, posAttr, colAttr } = useMemo(() => {
    const dirs = fibonacciSphere(PARTICLE_COUNT);
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const col = new Float32Array(PARTICLE_COUNT * 3);
    const idle = new THREE.Color(MOOD_STYLE.idle.color);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const o = i * 3;
      pos[o] = (dirs[o] ?? 0) * RADIUS;
      pos[o + 1] = (dirs[o + 1] ?? 0) * RADIUS;
      pos[o + 2] = (dirs[o + 2] ?? 0) * RADIUS;
      col[o] = idle.r;
      col[o + 1] = idle.g;
      col[o + 2] = idle.b;
    }
    const pAttr = new THREE.BufferAttribute(pos, 3);
    const cAttr = new THREE.BufferAttribute(col, 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", pAttr);
    g.setAttribute("color", cAttr);
    return { geometry: g, baseDirs: dirs, outPos: pos, outCol: col, posAttr: pAttr, colAttr: cAttr };
  }, []);

  useFrame((_, rawDelta) => {
    const points = ref.current;
    if (points === null) return;
    const delta = Math.min(rawDelta, 0.05); // ilk kare / sekme dönüşü sıçramasını sınırla
    const style = MOOD_STYLE[mood];
    const load = vitals?.load ?? 0;
    const heat = vitals?.heat ?? 0;
    const memPct = vitals?.memPct ?? 0;
    const t = performance.now() / 1000;

    // Canlılık sürücüsü = GPU yükü VEYA LLM aktivitesi (bulutta GPU yükselmez, mood sürer).
    drive.current = smoothToward(drive.current, Math.max(load, style.activity), delta);
    heatSmooth.current = smoothToward(heatSmooth.current, heat, delta);

    // Dönüş açılarını biriktir (mood hızı + sürücü hızlandırır) → wave-field pozisyona pişirir.
    const spin = style.spin + drive.current * 0.25;
    angleY.current += delta * spin;
    angleX.current += delta * spin * 0.35;

    // Yüzey deformasyonu + per-parçacık renk (saf, testli).
    baseCol.current.set(style.color);
    computeWaveField(
      baseDirs,
      outPos,
      outCol,
      { radius: RADIUS, time: t, angleX: angleX.current, angleY: angleY.current, drive: drive.current, heat: heatSmooth.current },
      [baseCol.current.r, baseCol.current.g, baseCol.current.b],
      warm,
    );
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    // Ölçek = yalnız YUMUŞAK nefes (mood) + VRAM şişmesi. Zorlanma-nabzı ve lean-throb KALDIRILDI
    // (yük ifadesi artık dalga); bunlar kullanıcının sevmediği yüksek-frekans jitter'dı.
    const breathe = Math.sin(t * style.breathe) * style.amp;
    const swell = (memPct / 100) * 0.08;
    points.scale.setScalar(1 + breathe + swell);

    const material = points.material as THREE.PointsMaterial;
    material.opacity += (style.opacity - material.opacity) * 0.06;
  });

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial
        size={0.035}
        sizeAttenuation
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexColors
        opacity={MOOD_STYLE.idle.opacity}
      />
    </points>
  );
}

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

/** Hero sahne: küre + mood HUD (sol-alt) + GPU vital HUD (sağ-üst). */
export function LivingScene(): React.JSX.Element {
  const mood = useMood();
  const gpus = useStore((s) => s.gpus);
  const vitals = deriveGpuVitals(gpus);
  const style = MOOD_STYLE[mood];
  return (
    <div className="scene">
      <Canvas camera={{ position: [0, 0, 4.2], fov: 50 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <Particles mood={mood} vitals={vitals} />
      </Canvas>
      <div className="scene-hud">
        <span className="hud-dot" style={{ background: style.color }} />
        <span className="hud-label">{style.label}</span>
      </div>
      {vitals !== null && <GpuGauge vitals={vitals} />}
    </div>
  );
}

/** Sağ-üst GPU göstergesi: kürenin fiziksel yükünü sayısal + çubukla okur. */
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
