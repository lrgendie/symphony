import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { deriveMood, MOOD_STYLE, type SphereMood } from "./mood";
import { useStore } from "../store";

/**
 * Yaşayan Arayüz (TASARIM.md §2): merkezde nefes alan parçacık küresi. Sistem durumundan
 * türetilen "mood" (scene/mood.ts) küreyi sürer — boşta nefes, düşünürken hızlanma,
 * çalışırken magenta, izin beklerken amber, hatada kırmızı flaş. Her hareketin anlamı var.
 */

const PARTICLE_COUNT = 1700;
const RADIUS = 1.5;

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

function Particles({ mood }: { mood: SphereMood }): React.JSX.Element {
  const ref = useRef<THREE.Points>(null);
  const target = useRef(new THREE.Color(MOOD_STYLE.idle.color));
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(fibonacciSphere(PARTICLE_COUNT, RADIUS), 3));
    return g;
  }, []);

  useFrame((_, delta) => {
    const points = ref.current;
    if (points === null) return;
    const style = MOOD_STYLE[mood];
    // Dönüş (mood'a göre hız) + nefes (ölçek sinüsü).
    points.rotation.y += delta * style.spin;
    points.rotation.x += delta * style.spin * 0.35;
    const t = performance.now() / 1000;
    points.scale.setScalar(1 + Math.sin(t * style.breathe) * style.amp);
    // Renk + opaklık yumuşak geçiş (mood değişince ani zıplama olmasın).
    const material = points.material as THREE.PointsMaterial;
    target.current.set(style.color);
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

/** Hero sahne: küre + üstünde HUD mood etiketi. Sadece bu alt ağaç ~3/sn tazelenir. */
export function LivingScene(): React.JSX.Element {
  const mood = useMood();
  const style = MOOD_STYLE[mood];
  return (
    <div className="scene">
      <Canvas camera={{ position: [0, 0, 4.2], fov: 50 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <Particles mood={mood} />
      </Canvas>
      <div className="scene-hud">
        <span className="hud-dot" style={{ background: style.color }} />
        <span className="hud-label">{style.label}</span>
      </div>
    </div>
  );
}
