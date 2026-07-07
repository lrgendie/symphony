import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { deriveMood, MOOD_STYLE, type SphereMood } from "./mood";
import { deriveGpuVitals, type GpuVitals } from "./hardware-vitals";
import { useStore } from "../store";

/**
 * Yaşayan Arayüz (TASARIM.md §2): merkezde nefes alan parçacık küresi. İki katman sürer:
 *  1) MOOD (scene/mood.ts) — sistem NE YAPIYOR: boşta nefes, düşünürken hız, çalışırken
 *     magenta, izin beklerken amber, hatada kırmızı flaş. Taban renk + nefes + dönüş.
 *  2) FİZİKSEL vitaller (scene/hardware-vitals.ts) — donanım NE HİSSEDİYOR: GPU yükü
 *     "zorlanma nabzı" + sağ-üst göstergeye yaslanma, VRAM doluluğu şişme, sıcaklık renk ısısı.
 * Her hareketin gerçek bir anlamı var (TASARIM ilkesi).
 */

const PARTICLE_COUNT = 1700;
const RADIUS = 1.5;
/** Isının çektiği "sıcak" uç renk (turuncu-kırmızı); heat=1'de taban renge bu kadar karışır. */
const WARM_COLOR = "#ff5a36";

/** Fibonacci küresi: parçacıkları yüzeye düzgün (kümelenmeden) dağıtır. */
function fibonacciSphere(count: number, radius: number): Float32Array {
  const pts = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pts[i * 3] = Math.cos(theta) * r * radius;
    pts[i * 3 + 1] = y * radius;
    pts[i * 3 + 2] = Math.sin(theta) * r * radius;
  }
  return pts;
}

function Particles({
  mood,
  vitals,
}: {
  mood: SphereMood;
  vitals: GpuVitals | null;
}): React.JSX.Element {
  const ref = useRef<THREE.Points>(null);
  const target = useRef(new THREE.Color(MOOD_STYLE.idle.color));
  const base = useRef(new THREE.Color());
  const warm = useRef(new THREE.Color(WARM_COLOR));
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(fibonacciSphere(PARTICLE_COUNT, RADIUS), 3));
    return g;
  }, []);

  useFrame((_, delta) => {
    const points = ref.current;
    if (points === null) return;
    const style = MOOD_STYLE[mood];
    const load = vitals?.load ?? 0;
    const heat = vitals?.heat ?? 0;
    const memPct = vitals?.memPct ?? 0;
    const t = performance.now() / 1000;

    // Dönüş: mood hızı + GPU yükü hızlandırır.
    const spin = style.spin + load * 0.3;
    points.rotation.y += delta * spin;
    points.rotation.x += delta * spin * 0.35;

    // Ölçek = nefes (mood) + zorlanma nabzı (yük arttıkça hızlı/güçlü) + VRAM şişmesi (kalıcı).
    const breathe = Math.sin(t * style.breathe) * style.amp;
    const strain = Math.sin(t * (4 + load * 10)) * (load * 0.06);
    const swell = (memPct / 100) * 0.08;
    points.scale.setScalar(1 + breathe + strain + swell);

    // Sağ-üst GPU göstergesine "yaslanma": yük arttıkça o köşeye doğru throb (yoksa merkeze döner).
    const lean = load * 0.18 * (0.6 + 0.4 * Math.sin(t * (3 + load * 6)));
    points.position.x += (lean - points.position.x) * 0.1;
    points.position.y += (lean - points.position.y) * 0.1;

    // Renk: mood taban rengi + ısı ile SICAĞA kayma (soğuk cyan → turuncu-kırmızı).
    const material = points.material as THREE.PointsMaterial;
    base.current.set(style.color);
    target.current.copy(base.current).lerp(warm.current, heat * 0.7);
    material.color.lerp(target.current, 0.06);
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
        color={MOOD_STYLE.idle.color}
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
