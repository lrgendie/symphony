import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { ActiveRun } from "@symphony/shared";
import { MOOD_STYLE, type SphereMood } from "./mood";
import type { GpuVitals } from "./hardware-vitals";
import { buildTesseract, projectNodes, type TesseractEdge } from "./tesseract/geometry";
import { advancePulses, createPulseSystem, fireConverge, HARD_CAP } from "./tesseract/pulses";
import { advanceSatellites, createSatelliteSystem, MAX_SATELLITES, syncSatellites } from "./tesseract/satellites";

/**
 * Yaşayan Tesseract (TASARIM.md §2, 2026-07-08 sinematik revizyon): markanın kendisi canlı
 * organizma. ÜÇ kademeli küp (bakır→cyan→violet) + kırmızı çekirdek; GERÇEK bloom
 * (UnrealBloomPass — three'nin kendi addon'u, YENİ paket yok); sinaps tüplerinde GLSL akış
 * shader'ı (enerji bantları merkeze akar); jiroskop yörünge halkaları; veri zerresi sürüsü;
 * yıldız alanı + nebula derinliği. Anlam eşlemesi: bakır=GPU, cyan=LLM/ajan (mood'u giyer),
 * violet=çekirdek kafesi, kırmızı çekirdek içindeki point-light patlamada yapıyı içeriden yıkar.
 * Saf mantık (geometri, atım) testli modüllerde; bu bileşen kopyalar ve malzeme sürer.
 */

// —— Palet (TASARIM.md §1 — index.css ile birebir) ——
const COPPER = "#c9803f";
const COPPER_EMBER = "#5a2b10";
const COPPER_GLOW = "#ffb27a";
const HOT = "#ff5a36";
const CYAN = "#22d3ee";
const MAGENTA = "#e879f9";
const VIOLET = "#a78bfa";
const RED = "#ef4444";
const AMBER = "#fbbf24";
const CONVERGE_GLOW = "#ff7a5c";

// —— Yumuşatma (ham veri sert, görsel yumuşak — TASARIM ilkesi) ——
const RISE_TAU = 0.55;
const FALL_TAU = 1.4;
/** Çekirdek patlamasının korlaşma (sönüm) zaman sabiti. */
const CORE_FALL_TAU = 1.1;

// —— Bloom (gerçek post-processing) ——
const BLOOM_STRENGTH = 0.9;
const BLOOM_RADIUS = 0.55;
const BLOOM_THRESHOLD = 0.15;

// —— Atım render'ı ——
const TRAIL = 3;
const TRAIL_STEP = 0.045;
const TRAIL_GAIN = [1, 0.45, 0.22, 0.1] as const;

// —— Boyutlar ——
const NODE_RADIUS = { outer: 0.08, inner: 0.05, deep: 0.034 } as const;
const STRUT_RADIUS = { copper: 0.028, inner: 0.017, deep: 0.012, link: 0.012, spoke: 0.01 } as const;
const CORE_RADIUS = 0.1;

// —— Atmosfer ——
const MOTE_COUNT = 220;
const STAR_COUNT = 380;

// —— Ajan uyduları (Faz 4 "yaşam formu"): her aktif koşu kendi yörüngeli ışığıyla temsil edilir ——
// Gyro halkaları 2.1-2.6, motes 1.95-3.1 yarıçapında — bu bandın hemen dışında ayrı, okunur katman.
const SATELLITE_ORBIT_RADIUS = 3.05;
const SATELLITE_ORBIT_SPEED = 0.22; // rad/sn (üst-düzey koşu); çocuk koşu biraz daha hızlı yörüngeler
const SATELLITE_TOP_SIZE = 0.15;
const SATELLITE_CHILD_SIZE = 0.095;

function smoothToward(current: number, target: number, delta: number): number {
  const tau = target > current ? RISE_TAU : FALL_TAU;
  return current + (target - current) * (1 - Math.exp(-delta / tau));
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Additive glow dokusu: yumuşak radyal ışık benek. */
function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.55)");
    g.addColorStop(0.6, "rgba(255,255,255,0.12)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/** Şok-dalgası halka dokusu (converge patlamasında dışa genişler). */
function makeRingTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0.55, "rgba(255,255,255,0)");
    g.addColorStop(0.7, "rgba(255,255,255,0.85)");
    g.addColorStop(0.8, "rgba(255,255,255,0.2)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * Sinaps tüpü akış malzemesi: tüp boyunca (uv.y) ilerleyen enerji bantları — akış yönü
 * kenarın a→b yönüdür; bağ/spoke kenarları merkeze sıralı olduğundan enerji MERKEZE akar.
 * Instancing üç tarafından desteklenir (USE_INSTANCING, InstancedMesh algılanınca tanımlanır).
 */
function makeFlowMaterial(color: THREE.Color, bands: number, speed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uBands: { value: bands },
      uSpeed: { value: speed },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uIntensity;
      uniform float uBands;
      uniform float uSpeed;
      varying vec2 vUv;
      void main() {
        float band = 0.5 + 0.5 * sin((vUv.y * uBands - uTime * uSpeed) * 6.28318);
        band = pow(band, 3.0);
        float endFade = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
        vec3 col = uColor * (0.32 + 0.85 * band) * uIntensity * endFade;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** ShaderMaterial sayı uniform'unu günceller (tip-güvenli erişim sarmalayıcısı). */
function setUniform(mat: THREE.ShaderMaterial, name: string, value: number): void {
  const u = mat.uniforms[name];
  if (u !== undefined) u.value = value;
}

/**
 * Gerçek bloom hattı: RenderPass → UnrealBloomPass → OutputPass (renk uzayı + tone mapping).
 * three'nin kendi addons'ından — yeni bağımlılık YOK. Kare döngüsünü devralır (priority 1).
 */
function Effects(): null {
  const gl = useThree((st) => st.gl);
  const sceneObj = useThree((st) => st.scene);
  const camera = useThree((st) => st.camera);
  const size = useThree((st) => st.size);
  const composer = useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(sceneObj, camera));
    c.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(gl.domElement.width, gl.domElement.height),
        BLOOM_STRENGTH,
        BLOOM_RADIUS,
        BLOOM_THRESHOLD,
      ),
    );
    c.addPass(new OutputPass());
    return c;
  }, [gl, sceneObj, camera]);
  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
  }, [composer, gl, size]);
  useFrame(() => {
    composer.render();
  }, 1);
  return null;
}

export interface TesseractProps {
  mood: SphereMood;
  vitals: GpuVitals | null;
  /** Son "görev sonuçlandı / kritik an" zaman damgası — değişince converge salvosu ateşlenir. */
  convergeSignal: number | null;
  /** Faz 4 "yaşam formu": aktif koşular — her biri kendi uydusuyla temsil edilir. */
  runs: readonly ActiveRun[];
}

export function Tesseract({ mood, vitals, convergeSignal, runs }: TesseractProps): React.JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const moteGroupRef = useRef<THREE.Group>(null);
  const copperStrutsRef = useRef<THREE.InstancedMesh>(null);
  const innerStrutsRef = useRef<THREE.InstancedMesh>(null);
  const deepStrutsRef = useRef<THREE.InstancedMesh>(null);
  const linkStrutsRef = useRef<THREE.InstancedMesh>(null);
  const spokeStrutsRef = useRef<THREE.InstancedMesh>(null);
  const outerNodesRef = useRef<THREE.InstancedMesh>(null);
  const innerNodesRef = useRef<THREE.InstancedMesh>(null);
  const deepNodesRef = useRef<THREE.InstancedMesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const coreSpriteRef = useRef<THREE.Sprite>(null);
  const shockRef = useRef<THREE.Sprite>(null);
  const coreLightRef = useRef<THREE.PointLight>(null);
  const gyroRefs = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];

  // Yumuşatılmış sürücüler + biriken durum.
  const gpuDrive = useRef(0);
  const actDrive = useRef(0);
  const heatSmooth = useRef(0);
  const presence = useRef(1);
  const hyperPhase = useRef(0);
  const rotY = useRef(0);
  const parallaxX = useRef(0);
  const parallaxY = useRef(0);
  const coreEnergy = useRef(0.2);
  const shockT = useRef(1); // 1 = şok halkası pasif
  const prevConverge = useRef<number | null>(convergeSignal);
  const initialized = useRef(false);

  const s = useMemo(() => {
    const topo = buildTesseract();
    const nodePos = new Float32Array(topo.nodes.length * 3);
    const pulses = createPulseSystem(topo.edges);

    const copperEdges: TesseractEdge[] = topo.edges.filter(
      (e) => e.kind === "outer" || e.kind === "bridge",
    );
    const innerEdges: TesseractEdge[] = topo.edges.filter((e) => e.kind === "inner");
    const deepEdges: TesseractEdge[] = topo.edges.filter((e) => e.kind === "deep");
    const linkEdges: TesseractEdge[] = topo.edges.filter((e) => e.kind === "link");
    const spokeEdges: TesseractEdge[] = topo.edges.filter((e) => e.kind === "spoke");

    const strutGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    const nodeGeo = new THREE.SphereGeometry(1, 16, 12);
    const glowTex = makeGlowTexture();
    const ringTex = makeRingTexture();

    // —— Katı malzemeler (ışık + bloom ile metalik/emissive) ——
    const copperStrutMat = new THREE.MeshStandardMaterial({
      color: COPPER,
      metalness: 0.85,
      roughness: 0.38,
      emissive: COPPER_EMBER,
      emissiveIntensity: 0.25,
    });
    const copperNodeMat = new THREE.MeshStandardMaterial({
      color: COPPER,
      metalness: 0.8,
      roughness: 0.3,
      emissive: COPPER_EMBER,
      emissiveIntensity: 0.3,
    });
    const innerNodeMat = new THREE.MeshStandardMaterial({
      color: "#0c4a5e",
      metalness: 0.2,
      roughness: 0.35,
      emissive: MOOD_STYLE.idle.color,
      emissiveIntensity: 1.0,
    });
    const deepNodeMat = new THREE.MeshStandardMaterial({
      color: "#2a1a4a",
      metalness: 0.2,
      roughness: 0.4,
      emissive: VIOLET,
      emissiveIntensity: 1.1,
    });
    const coreMat = new THREE.MeshStandardMaterial({
      color: "#7f1d1d",
      metalness: 0.1,
      roughness: 0.3,
      emissive: RED,
      emissiveIntensity: 1.2,
    });

    // —— Akış shader tüpleri (sinaps enerji bantları; renk nesneleri paylaşımlı tutulur) ——
    const innerFlowColor = new THREE.Color(CYAN);
    const deepFlowColor = new THREE.Color(VIOLET);
    const spokeFlowColor = new THREE.Color(VIOLET);
    const innerFlowMat = makeFlowMaterial(innerFlowColor, 6, 0.7);
    const deepFlowMat = makeFlowMaterial(deepFlowColor, 4, 0.9);
    const spokeFlowMat = makeFlowMaterial(spokeFlowColor, 3, 1.4);

    // —— Atım katmanı (baş + komet kuyruğu; CPU BufferAttribute) ——
    const pulseCapacity = HARD_CAP * (1 + TRAIL);
    const pulsePos = new Float32Array(pulseCapacity * 3);
    const pulseCol = new Float32Array(pulseCapacity * 3);
    const pulseGeo = new THREE.BufferGeometry();
    const pulsePosAttr = new THREE.BufferAttribute(pulsePos, 3);
    const pulseColAttr = new THREE.BufferAttribute(pulseCol, 3);
    pulsePosAttr.setUsage(THREE.DynamicDrawUsage);
    pulseColAttr.setUsage(THREE.DynamicDrawUsage);
    pulseGeo.setAttribute("position", pulsePosAttr);
    pulseGeo.setAttribute("color", pulseColAttr);
    pulseGeo.setDrawRange(0, 0);
    const pulseMat = new THREE.PointsMaterial({
      size: 0.07,
      map: glowTex,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    // —— Düğüm haleleri (pozisyon arabelleğini paylaşır) ——
    const haloCol = new Float32Array(topo.nodes.length * 3);
    const haloGeo = new THREE.BufferGeometry();
    const haloPosAttr = new THREE.BufferAttribute(nodePos, 3);
    const haloColAttr = new THREE.BufferAttribute(haloCol, 3);
    haloPosAttr.setUsage(THREE.DynamicDrawUsage);
    haloColAttr.setUsage(THREE.DynamicDrawUsage);
    haloGeo.setAttribute("position", haloPosAttr);
    haloGeo.setAttribute("color", haloColAttr);
    const haloMat = new THREE.PointsMaterial({
      size: 0.42,
      map: glowTex,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    const coreSpriteMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: RED,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.35,
    });
    const shockMat = new THREE.SpriteMaterial({
      map: ringTex,
      color: CONVERGE_GLOW,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    });

    // —— Jiroskop yörünge halkaları: katman başına bir (bakır=donanım, cyan=zihin, violet=ajan) ——
    const gyroGeo = new THREE.TorusGeometry(1, 0.006, 8, 160);
    const gyroMats = [
      new THREE.MeshBasicMaterial({ color: COPPER_GLOW, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: VIOLET, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false }),
    ] as const;
    const gyroRadii = [2.1, 2.35, 2.6] as const;

    // —— Veri zerreleri: yapıyı yörüngeleyen ışık motları ——
    const motePos = new Float32Array(MOTE_COUNT * 3);
    const moteCol = new Float32Array(MOTE_COUNT * 3);
    const moteParam: {
      radius: number;
      speed: number;
      phase: number;
      cosI: number;
      sinI: number;
      precPhase: number;
      precSpeed: number;
      family: 0 | 1 | 2; // 0=bakır(GPU) 1=cyan(LLM) 2=violet(çekirdek)
    }[] = [];
    for (let i = 0; i < MOTE_COUNT; i++) {
      const incl = (Math.random() - 0.5) * Math.PI * 0.9;
      moteParam.push({
        radius: 1.95 + Math.random() * 1.15,
        speed: 0.05 + Math.random() * 0.28,
        phase: Math.random() * Math.PI * 2,
        cosI: Math.cos(incl),
        sinI: Math.sin(incl),
        precPhase: Math.random() * Math.PI * 2,
        precSpeed: (Math.random() - 0.5) * 0.06,
        family: (i % 3) as 0 | 1 | 2,
      });
    }
    const moteGeo = new THREE.BufferGeometry();
    const motePosAttr = new THREE.BufferAttribute(motePos, 3);
    const moteColAttr = new THREE.BufferAttribute(moteCol, 3);
    motePosAttr.setUsage(THREE.DynamicDrawUsage);
    moteColAttr.setUsage(THREE.DynamicDrawUsage);
    moteGeo.setAttribute("position", motePosAttr);
    moteGeo.setAttribute("color", moteColAttr);
    const moteMat = new THREE.PointsMaterial({
      size: 0.05,
      map: glowTex,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    // —— Yıldız alanı: uzak kabukta hafif göz kırpan noktalar ——
    const starPos = new Float32Array(STAR_COUNT * 3);
    const starCol = new Float32Array(STAR_COUNT * 3);
    const starParam: { base: number; speed: number; phase: number; warm: boolean }[] = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      const r = 10 + Math.random() * 6;
      const theta = Math.random() * Math.PI * 2;
      const y = (Math.random() * 2 - 1) * 0.9;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      starPos[i * 3] = r * ring * Math.cos(theta);
      starPos[i * 3 + 1] = r * y;
      starPos[i * 3 + 2] = r * ring * Math.sin(theta);
      starParam.push({
        base: 0.2 + Math.random() * 0.5,
        speed: 0.4 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
        warm: Math.random() < 0.18,
      });
    }
    const starGeo = new THREE.BufferGeometry();
    const starPosAttr = new THREE.BufferAttribute(starPos, 3);
    const starColAttr = new THREE.BufferAttribute(starCol, 3);
    starColAttr.setUsage(THREE.DynamicDrawUsage);
    starGeo.setAttribute("position", starPosAttr);
    starGeo.setAttribute("color", starColAttr);
    const starMat = new THREE.PointsMaterial({
      size: 0.06,
      map: glowTex,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    // —— Nebula: çok soluk atmosfer lekeleri (derinlik hissi) ——
    const nebulaMats = [
      new THREE.SpriteMaterial({ map: glowTex, color: CYAN, transparent: true, opacity: 0.055, depthWrite: false, blending: THREE.AdditiveBlending }),
      new THREE.SpriteMaterial({ map: glowTex, color: MAGENTA, transparent: true, opacity: 0.04, depthWrite: false, blending: THREE.AdditiveBlending }),
      new THREE.SpriteMaterial({ map: glowTex, color: COPPER_GLOW, transparent: true, opacity: 0.035, depthWrite: false, blending: THREE.AdditiveBlending }),
    ] as const;

    // —— Ajan uyduları: her aktif koşu (üst-düzey/çocuk) AYRI bir Points katmanında —
    // boyut farkı (size) tek materyal üzerinden veremediğimiz için iki kademe iki ayrı katman.
    const satelliteSystem = createSatelliteSystem();
    const satTopPos = new Float32Array(MAX_SATELLITES * 3);
    const satTopCol = new Float32Array(MAX_SATELLITES * 3);
    const satTopGeo = new THREE.BufferGeometry();
    const satTopPosAttr = new THREE.BufferAttribute(satTopPos, 3);
    const satTopColAttr = new THREE.BufferAttribute(satTopCol, 3);
    satTopPosAttr.setUsage(THREE.DynamicDrawUsage);
    satTopColAttr.setUsage(THREE.DynamicDrawUsage);
    satTopGeo.setAttribute("position", satTopPosAttr);
    satTopGeo.setAttribute("color", satTopColAttr);
    satTopGeo.setDrawRange(0, 0);
    const satTopMat = new THREE.PointsMaterial({
      size: SATELLITE_TOP_SIZE,
      map: glowTex,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });
    const satChildPos = new Float32Array(MAX_SATELLITES * 3);
    const satChildCol = new Float32Array(MAX_SATELLITES * 3);
    const satChildGeo = new THREE.BufferGeometry();
    const satChildPosAttr = new THREE.BufferAttribute(satChildPos, 3);
    const satChildColAttr = new THREE.BufferAttribute(satChildCol, 3);
    satChildPosAttr.setUsage(THREE.DynamicDrawUsage);
    satChildColAttr.setUsage(THREE.DynamicDrawUsage);
    satChildGeo.setAttribute("position", satChildPosAttr);
    satChildGeo.setAttribute("color", satChildColAttr);
    satChildGeo.setDrawRange(0, 0);
    const satChildMat = new THREE.PointsMaterial({
      size: SATELLITE_CHILD_SIZE,
      map: glowTex,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    return {
      topo,
      nodePos,
      pulses,
      copperEdges,
      innerEdges,
      deepEdges,
      linkEdges,
      spokeEdges,
      strutGeo,
      nodeGeo,
      copperStrutMat,
      copperNodeMat,
      innerNodeMat,
      deepNodeMat,
      coreMat,
      innerFlowColor,
      deepFlowColor,
      spokeFlowColor,
      innerFlowMat,
      deepFlowMat,
      spokeFlowMat,
      pulseGeo,
      pulsePos,
      pulseCol,
      pulsePosAttr,
      pulseColAttr,
      pulseMat,
      haloGeo,
      haloCol,
      haloPosAttr,
      haloColAttr,
      haloMat,
      coreSpriteMat,
      shockMat,
      gyroGeo,
      gyroMats,
      gyroRadii,
      motePos,
      moteCol,
      motePosAttr,
      moteColAttr,
      moteGeo,
      moteMat,
      moteParam,
      starCol,
      starColAttr,
      starGeo,
      starMat,
      starParam,
      nebulaMats,
      satelliteSystem,
      satTopPos,
      satTopCol,
      satTopPosAttr,
      satTopColAttr,
      satTopGeo,
      satTopMat,
      satChildPos,
      satChildCol,
      satChildPosAttr,
      satChildColAttr,
      satChildGeo,
      satChildMat,
      // Kare döngüsünde GC üretmemek için kalıcı yardımcılar.
      dummy: new THREE.Object3D(),
      up: new THREE.Vector3(0, 1, 0),
      tmpDir: new THREE.Vector3(),
      tmpColor: new THREE.Color(),
      tmpColor2: new THREE.Color(),
      emberColor: new THREE.Color(COPPER_EMBER),
      hotColor: new THREE.Color(HOT),
      copperGlowColor: new THREE.Color(COPPER_GLOW),
      cyanColor: new THREE.Color(CYAN),
      magentaColor: new THREE.Color(MAGENTA),
      amberColor: new THREE.Color(AMBER),
      violetColor: new THREE.Color(VIOLET),
      redColor: new THREE.Color(RED),
      convergeColor: new THREE.Color(CONVERGE_GLOW),
    };
  }, []);

  useFrame((state, rawDelta) => {
    const group = groupRef.current;
    const moteGroup = moteGroupRef.current;
    const copperStruts = copperStrutsRef.current;
    const innerStruts = innerStrutsRef.current;
    const deepStruts = deepStrutsRef.current;
    const linkStruts = linkStrutsRef.current;
    const spokeStruts = spokeStrutsRef.current;
    const outerNodes = outerNodesRef.current;
    const innerNodes = innerNodesRef.current;
    const deepNodes = deepNodesRef.current;
    const core = coreRef.current;
    const coreSprite = coreSpriteRef.current;
    const shock = shockRef.current;
    const coreLight = coreLightRef.current;
    if (
      group === null || moteGroup === null || copperStruts === null || innerStruts === null ||
      deepStruts === null || linkStruts === null || spokeStruts === null || outerNodes === null ||
      innerNodes === null || deepNodes === null || core === null || coreSprite === null ||
      shock === null || coreLight === null
    ) {
      return;
    }
    if (!initialized.current) {
      for (const m of [copperStruts, innerStruts, deepStruts, linkStruts, spokeStruts, outerNodes, innerNodes, deepNodes]) {
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      }
      initialized.current = true;
    }

    const delta = Math.min(rawDelta, 0.05);
    const t = performance.now() / 1000;
    const style = MOOD_STYLE[mood];

    // 1) Sürücüler.
    gpuDrive.current = smoothToward(gpuDrive.current, vitals?.load ?? 0, delta);
    actDrive.current = smoothToward(actDrive.current, style.activity, delta);
    heatSmooth.current = smoothToward(heatSmooth.current, vitals?.heat ?? 0, delta);
    presence.current = smoothToward(presence.current, mood === "offline" ? 0.22 : 1, delta);
    const gpu = gpuDrive.current;
    const act = actDrive.current;
    const heat = heatSmooth.current;
    const pres = presence.current;
    const drive = Math.max(gpu, act);

    // 2) Converge tetikleyicisi.
    if (convergeSignal !== null && convergeSignal !== prevConverge.current) {
      prevConverge.current = convergeSignal;
      if (mood !== "offline") fireConverge(s.pulses);
    }

    // 3) Hiper-dönüş + projeksiyon.
    hyperPhase.current += delta * (0.12 + 0.55 * drive + 0.9 * Math.min(coreEnergy.current, 1));
    const hyperAngle = 0.38 * Math.sin(hyperPhase.current);
    const innerSwell = 1 + ((vitals?.memPct ?? 0) / 100) * 0.14;
    projectNodes(s.topo, hyperAngle, innerSwell, s.nodePos);
    s.haloPosAttr.needsUpdate = true;

    // 4) Grup dönüşü + parallax + nefes; zerre grubu karşı yönde (derinlik).
    rotY.current += delta * (style.spin * 0.7 + 0.22 * drive);
    parallaxX.current += (state.pointer.x * 0.12 - parallaxX.current) * (1 - Math.exp(-delta / 0.6));
    parallaxY.current += (state.pointer.y * 0.08 - parallaxY.current) * (1 - Math.exp(-delta / 0.6));
    group.rotation.set(
      0.35 + 0.06 * Math.sin(t * 0.26) - parallaxY.current,
      rotY.current + parallaxX.current,
      0,
    );
    group.scale.setScalar(1 + Math.sin(t * style.breathe) * style.amp);
    moteGroup.rotation.y -= delta * 0.03;

    // 5) Sinematik kamera: aktivite yaklaştırır, yavaş süzülme derinlik verir.
    const cam = state.camera;
    const targetZ = 4.9 - 0.35 * drive;
    cam.position.z += (targetZ - cam.position.z) * (1 - Math.exp(-delta / 1.2));
    cam.position.x = 0.18 * Math.sin(t * 0.07);
    cam.position.y = 0.12 * Math.sin(t * 0.09 + 2.0);
    cam.lookAt(0, 0, 0);

    // 6) Düğüm instance'ları.
    const placeNodes = (mesh: THREE.InstancedMesh, first: number, radius: number): void => {
      for (let i = 0; i < 8; i++) {
        const o = (first + i) * 3;
        s.dummy.position.set(s.nodePos[o] ?? 0, s.nodePos[o + 1] ?? 0, s.nodePos[o + 2] ?? 0);
        s.dummy.quaternion.identity();
        s.dummy.scale.setScalar(radius);
        s.dummy.updateMatrix();
        mesh.setMatrixAt(i, s.dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    placeNodes(outerNodes, 0, NODE_RADIUS.outer);
    placeNodes(innerNodes, 8, NODE_RADIUS.inner);
    placeNodes(deepNodes, 16, NODE_RADIUS.deep);

    // 7) Çubuk instance'ları.
    const placeStruts = (
      mesh: THREE.InstancedMesh,
      edges: readonly TesseractEdge[],
      radius: number,
    ): void => {
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (e === undefined) continue;
        const ao = e.a * 3;
        const bo = e.b * 3;
        const ax = s.nodePos[ao] ?? 0;
        const ay = s.nodePos[ao + 1] ?? 0;
        const az = s.nodePos[ao + 2] ?? 0;
        const bx = s.nodePos[bo] ?? 0;
        const by = s.nodePos[bo + 1] ?? 0;
        const bz = s.nodePos[bo + 2] ?? 0;
        s.tmpDir.set(bx - ax, by - ay, bz - az);
        const len = s.tmpDir.length();
        s.dummy.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
        s.dummy.quaternion.setFromUnitVectors(s.up, s.tmpDir.normalize());
        s.dummy.scale.set(radius, len, radius);
        s.dummy.updateMatrix();
        mesh.setMatrixAt(i, s.dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    placeStruts(copperStruts, s.copperEdges, STRUT_RADIUS.copper);
    placeStruts(innerStruts, s.innerEdges, STRUT_RADIUS.inner);
    placeStruts(deepStruts, s.deepEdges, STRUT_RADIUS.deep);
    placeStruts(linkStruts, s.linkEdges, STRUT_RADIUS.link);
    placeStruts(spokeStruts, s.spokeEdges, STRUT_RADIUS.spoke);

    // 8) Atımlar (iç ağ=LLM aktivitesi, bakır=GPU) + çekirdek enerjisi.
    const rates =
      mood === "offline"
        ? { synapse: 0, energy: 0 }
        : { synapse: 0.5 + 16 * act, energy: 0.15 + 13 * gpu };
    const { coreHits } = advancePulses(s.pulses, delta, rates, Math.random);

    const coreBase = 0.18 + 0.5 * act + 0.15 * gpu;
    if (coreHits > 0) {
      coreEnergy.current = Math.min(1.9, coreEnergy.current + coreHits * 0.3);
      shockT.current = 0;
    }
    coreEnergy.current =
      coreEnergy.current > coreBase
        ? coreBase + (coreEnergy.current - coreBase) * Math.exp(-delta / CORE_FALL_TAU)
        : coreEnergy.current + (coreBase - coreEnergy.current) * (1 - Math.exp(-delta / RISE_TAU));
    const coreE = coreEnergy.current;

    // 9) Atım noktaları (baş + komet kuyruğu).
    let cursor = 0;
    const capacity = HARD_CAP * (1 + TRAIL);
    for (const p of s.pulses.pulses) {
      if (cursor >= capacity) break;
      const edge = s.topo.edges[p.edge];
      if (edge === undefined) continue;
      const ao = edge.a * 3;
      const bo = edge.b * 3;
      let baseColor: THREE.Color;
      let gain: number;
      if (p.kind === "synapse") {
        baseColor = edge.kind === "inner" ? s.innerFlowColor : s.violetColor;
        gain = 1.0;
      } else if (p.kind === "energy") {
        s.tmpColor2.copy(s.copperGlowColor).lerp(s.hotColor, heat);
        baseColor = s.tmpColor2;
        gain = 0.8;
      } else {
        baseColor = s.convergeColor;
        gain = 1.35;
      }
      for (let k = 0; k <= TRAIL && cursor < capacity; k++) {
        const tk = p.t - k * TRAIL_STEP;
        if (tk < 0 || tk > 1) continue;
        const w = p.dir === 1 ? tk : 1 - tk;
        const o = cursor * 3;
        s.pulsePos[o] = (s.nodePos[ao] ?? 0) + ((s.nodePos[bo] ?? 0) - (s.nodePos[ao] ?? 0)) * w;
        s.pulsePos[o + 1] =
          (s.nodePos[ao + 1] ?? 0) + ((s.nodePos[bo + 1] ?? 0) - (s.nodePos[ao + 1] ?? 0)) * w;
        s.pulsePos[o + 2] =
          (s.nodePos[ao + 2] ?? 0) + ((s.nodePos[bo + 2] ?? 0) - (s.nodePos[ao + 2] ?? 0)) * w;
        const envelope = Math.sin(Math.PI * clamp01(tk));
        const b = envelope * gain * (TRAIL_GAIN[k] ?? 0) * pres;
        s.pulseCol[o] = baseColor.r * b;
        s.pulseCol[o + 1] = baseColor.g * b;
        s.pulseCol[o + 2] = baseColor.b * b;
        cursor++;
      }
    }
    s.pulseGeo.setDrawRange(0, cursor);
    s.pulsePosAttr.needsUpdate = true;
    s.pulseColAttr.needsUpdate = true;

    // 10) Düğüm haleleri (bloom bunları çiçeklendirir; seviyeler ölçülü).
    for (const node of s.topo.nodes) {
      const o = node.id * 3;
      const twinkle = 0.04 * (0.5 + 0.5 * Math.sin(t * 1.9 + node.id * 2.1));
      let color: THREE.Color;
      let level: number;
      if (node.layer === "outer") {
        s.tmpColor2.copy(s.copperGlowColor).lerp(s.hotColor, heat);
        color = s.tmpColor2;
        level = 0.06 + 0.32 * gpu + twinkle;
      } else if (node.layer === "inner") {
        color = s.innerFlowColor;
        level = 0.08 + 0.4 * act + twinkle;
      } else if (node.layer === "deep") {
        color = s.violetColor;
        level = 0.07 + 0.3 * act + 0.4 * Math.max(0, coreE - 0.3);
      } else {
        color = s.redColor;
        level = 0;
      }
      const b = level * pres;
      s.haloCol[o] = color.r * b;
      s.haloCol[o + 1] = color.g * b;
      s.haloCol[o + 2] = color.b * b;
    }
    s.haloColAttr.needsUpdate = true;

    // 11) Malzemeler: mood iç ağı giyer; ısı bakırı korlaştırır; çekirdek spoke'ları kızartır.
    s.tmpColor.set(style.color);
    s.innerFlowColor.lerp(s.tmpColor, 1 - Math.exp(-delta / 0.35));
    s.innerNodeMat.emissive.copy(s.innerFlowColor);
    s.innerNodeMat.emissiveIntensity = pres * (0.75 + 1.5 * act);

    const redden = clamp01(coreE * 0.75);
    s.spokeFlowColor.copy(s.violetColor).lerp(s.redColor, redden);
    s.deepFlowColor.copy(s.violetColor).lerp(s.redColor, redden * 0.35);
    s.deepNodeMat.emissive.copy(s.deepFlowColor);
    s.deepNodeMat.emissiveIntensity = pres * (0.8 + 1.2 * act + 0.6 * coreE);

    for (const [mat, intensity, speedBoost] of [
      [s.innerFlowMat, pres * (0.5 + 1.6 * act), act],
      [s.deepFlowMat, pres * (0.45 + 1.3 * act + 0.5 * coreE), act],
      [s.spokeFlowMat, pres * (0.5 + 1.6 * coreE), Math.min(coreE, 1)],
    ] as const) {
      setUniform(mat, "uTime", t);
      setUniform(mat, "uIntensity", intensity);
      setUniform(mat, "uSpeed", 0.6 + 1.6 * speedBoost);
    }

    s.copperStrutMat.emissive.copy(s.emberColor).lerp(s.hotColor, heat);
    s.copperNodeMat.emissive.copy(s.copperStrutMat.emissive);
    s.copperStrutMat.emissiveIntensity = pres * (0.22 + 0.6 * gpu + 0.5 * heat);
    s.copperNodeMat.emissiveIntensity = pres * (0.28 + 0.7 * gpu + 0.55 * heat);

    s.pulseMat.opacity = pres;
    s.haloMat.opacity = 0.9 * pres;

    // 12) Çekirdek: kalp atışı + patlama + iç ışık + şok halkası.
    const heartbeat = 1 + 0.07 * Math.sin(t * (1.4 + 2.4 * act));
    core.scale.setScalar(CORE_RADIUS * heartbeat * (1 + 0.3 * Math.min(coreE, 1.5)));
    s.coreMat.emissiveIntensity = pres * (1.0 + 2.4 * coreE);
    coreLight.intensity = pres * (6 + 70 * coreE);
    const spriteScale = 0.5 + 0.95 * coreE;
    coreSprite.scale.set(spriteScale, spriteScale, 1);
    s.coreSpriteMat.opacity = pres * (0.24 + 0.36 * Math.min(coreE, 1.2));

    if (shockT.current < 1) {
      shockT.current = Math.min(1, shockT.current + delta * 1.5);
      const shockScale = 0.55 + shockT.current * 3.0;
      shock.scale.set(shockScale, shockScale, 1);
      s.shockMat.opacity = (1 - shockT.current) ** 2 * 0.85 * pres;
    } else {
      s.shockMat.opacity = 0;
    }

    // 13) Jiroskop halkaları: katmanının enerjisiyle parlar, canlılıkla süzülür.
    const gyroDrives = [gpu, act, Math.min(coreE, 1)] as const;
    for (let i = 0; i < 3; i++) {
      const ring = gyroRefs[i]?.current;
      const mat = s.gyroMats[i];
      const gd = gyroDrives[i] ?? 0;
      if (ring === null || ring === undefined || mat === undefined) continue;
      ring.rotation.x = 1.1 + i * 0.5 + 0.12 * Math.sin(t * (0.1 + i * 0.03) + i * 2);
      ring.rotation.y += delta * (0.04 + 0.12 * gd) * (i % 2 === 0 ? 1 : -1);
      mat.opacity = pres * (0.05 + 0.16 * gd);
    }

    // 14) Veri zerreleri: yörüngede süzülen ışık motları; ailesinin sürücüsüyle parlar.
    for (let i = 0; i < MOTE_COUNT; i++) {
      const m = s.moteParam[i];
      if (m === undefined) continue;
      const theta = m.phase + t * m.speed;
      const px = m.radius * Math.cos(theta);
      const pz0 = m.radius * Math.sin(theta);
      const py = -pz0 * m.sinI;
      const pz1 = pz0 * m.cosI;
      const prec = m.precPhase + t * m.precSpeed;
      const cp = Math.cos(prec);
      const sp = Math.sin(prec);
      const o = i * 3;
      s.motePos[o] = px * cp + pz1 * sp;
      s.motePos[o + 1] = py;
      s.motePos[o + 2] = -px * sp + pz1 * cp;
      const familyDrive = m.family === 0 ? gpu : m.family === 1 ? act : Math.min(coreE, 1);
      const familyColor =
        m.family === 0 ? s.copperGlowColor : m.family === 1 ? s.innerFlowColor : s.violetColor;
      const b = pres * (0.06 + 0.4 * familyDrive) * (0.6 + 0.4 * Math.sin(t * 1.3 + i));
      s.moteCol[o] = familyColor.r * b;
      s.moteCol[o + 1] = familyColor.g * b;
      s.moteCol[o + 2] = familyColor.b * b;
    }
    s.motePosAttr.needsUpdate = true;
    s.moteColAttr.needsUpdate = true;

    // 15) Yıldız göz kırpması (uzak kabuk; bloom hafifçe çiçeklendirir).
    for (let i = 0; i < STAR_COUNT; i++) {
      const st = s.starParam[i];
      if (st === undefined) continue;
      const b = st.base * (0.7 + 0.3 * Math.sin(t * st.speed + st.phase));
      const o = i * 3;
      if (st.warm) {
        s.starCol[o] = b;
        s.starCol[o + 1] = b * 0.75;
        s.starCol[o + 2] = b * 0.55;
      } else {
        s.starCol[o] = b * 0.75;
        s.starCol[o + 1] = b * 0.9;
        s.starCol[o + 2] = b;
      }
    }
    s.starColAttr.needsUpdate = true;

    // 16) Ajan uyduları (Faz 4 "yaşam formu"): her aktif koşu kendi yörüngeli ışığıyla temsil
    // edilir. syncSatellites/advanceSatellites SAF (tesseract/satellites.ts, testli) — burada
    // yalnız yörünge trigonometrisi + renk (motes ile AYNI desen: sistem mantığı ayrı, sahne
    // matematiği burada). Ölüm (dieT≠null) mood'dan BAĞIMSIZ nötr bir patla-sön (CONVERGE_GLOW) —
    // ana tesseract'ın converge şelalesiyle AYNI ilke: "bitti" tek bir görsel dil, başarı/hata
    // ayrımı zaten mood'un kendi rengiyle (ör. hata anında tüm sahne kızarır) taşınıyor.
    syncSatellites(
      s.satelliteSystem,
      runs.map((r) => ({ runId: r.runId, isChild: r.parentRunId !== undefined, state: r.state })),
      Math.random,
    );
    advanceSatellites(s.satelliteSystem, delta);
    let topCursor = 0;
    let childCursor = 0;
    for (const entry of s.satelliteSystem.entries.values()) {
      const isChild = entry.kind === "child";
      const speed = SATELLITE_ORBIT_SPEED * (isChild ? 1.35 : 1);
      const theta = entry.angleSeed + t * speed;
      // angleSeed'ten türetilen SABİT eğim (motes'un rastgele incl'iyle aynı fikir, ama
      // uydunun kimliği boyunca değişmeyen deterministik bir değer olmalı).
      const tilt = Math.sin(entry.angleSeed * 3.7) * 0.3;
      const radius = SATELLITE_ORBIT_RADIUS * (isChild ? 0.82 : 1);
      const px = radius * Math.cos(theta);
      const pz0 = radius * Math.sin(theta);

      const spawnEase = entry.spawnT * entry.spawnT * (3 - 2 * entry.spawnT); // smoothstep
      let envelope = spawnEase;
      let color =
        entry.mood === "executing" ? s.magentaColor : entry.mood === "awaiting" ? s.amberColor : s.cyanColor;
      if (entry.dieT !== null) {
        const d = entry.dieT;
        envelope = d < 0.2 ? 1 + (1 - d / 0.2) * 0.8 : ((1 - (d - 0.2) / 0.8) ** 2);
        color = s.convergeColor;
      }
      const b = envelope * pres;

      const cursor = isChild ? childCursor : topCursor;
      if (cursor < MAX_SATELLITES) {
        const buf = isChild ? s.satChildPos : s.satTopPos;
        const col = isChild ? s.satChildCol : s.satTopCol;
        const o = cursor * 3;
        buf[o] = px;
        buf[o + 1] = -pz0 * Math.sin(tilt);
        buf[o + 2] = pz0 * Math.cos(tilt);
        col[o] = color.r * b;
        col[o + 1] = color.g * b;
        col[o + 2] = color.b * b;
        if (isChild) childCursor++;
        else topCursor++;
      }
    }
    s.satTopGeo.setDrawRange(0, topCursor);
    s.satTopPosAttr.needsUpdate = true;
    s.satTopColAttr.needsUpdate = true;
    s.satChildGeo.setDrawRange(0, childCursor);
    s.satChildPosAttr.needsUpdate = true;
    s.satChildColAttr.needsUpdate = true;
  });

  return (
    <>
      <color attach="background" args={["#05060a"]} />
      <Effects />
      {/* Atmosfer: yıldız alanı + nebula lekeleri (derinlik) */}
      <points geometry={s.starGeo} material={s.starMat} frustumCulled={false} />
      <sprite material={s.nebulaMats[0]} position={[-3.6, 1.9, -7]} scale={[11, 11, 1]} />
      <sprite material={s.nebulaMats[1]} position={[3.8, -1.6, -8]} scale={[12, 12, 1]} />
      <sprite material={s.nebulaMats[2]} position={[0.5, 2.8, -9]} scale={[9, 9, 1]} />
      {/* Jiroskop yörünge halkaları (bakır=donanım, cyan=zihin, violet=çekirdek katmanı) */}
      {([0, 1, 2] as const).map((i) => (
        <mesh
          key={i}
          ref={gyroRefs[i]}
          geometry={s.gyroGeo}
          material={s.gyroMats[i]}
          scale={[s.gyroRadii[i], s.gyroRadii[i], s.gyroRadii[i]]}
        />
      ))}
      {/* Yaşayan tesseract */}
      <group ref={groupRef}>
        <instancedMesh
          ref={copperStrutsRef}
          args={[s.strutGeo, s.copperStrutMat, s.copperEdges.length]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={innerStrutsRef}
          args={[s.strutGeo, s.innerFlowMat, s.innerEdges.length]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={deepStrutsRef}
          args={[s.strutGeo, s.deepFlowMat, s.deepEdges.length]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={linkStrutsRef}
          args={[s.strutGeo, s.deepFlowMat, s.linkEdges.length]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={spokeStrutsRef}
          args={[s.strutGeo, s.spokeFlowMat, s.spokeEdges.length]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={outerNodesRef}
          args={[s.nodeGeo, s.copperNodeMat, 8]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={innerNodesRef}
          args={[s.nodeGeo, s.innerNodeMat, 8]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={deepNodesRef}
          args={[s.nodeGeo, s.deepNodeMat, 8]}
          frustumCulled={false}
        />
        <mesh ref={coreRef} geometry={s.nodeGeo} material={s.coreMat} />
        <sprite ref={coreSpriteRef} material={s.coreSpriteMat} renderOrder={10} />
        <sprite ref={shockRef} material={s.shockMat} renderOrder={11} />
        <points geometry={s.pulseGeo} material={s.pulseMat} frustumCulled={false} renderOrder={8} />
        <points geometry={s.haloGeo} material={s.haloMat} frustumCulled={false} renderOrder={9} />
        <pointLight ref={coreLightRef} color={RED} intensity={10} distance={6} decay={2} />
      </group>
      {/* Veri zerreleri (karşı yönde süzülür — derinlik) */}
      <group ref={moteGroupRef}>
        <points geometry={s.moteGeo} material={s.moteMat} frustumCulled={false} renderOrder={7} />
      </group>
      {/* Ajan uyduları (Faz 4 "yaşam formu"): her aktif koşu kendi yörüngeli ışığı */}
      <points geometry={s.satTopGeo} material={s.satTopMat} frustumCulled={false} renderOrder={12} />
      <points geometry={s.satChildGeo} material={s.satChildMat} frustumCulled={false} renderOrder={12} />
      {/* Fiziksel ışıklar (three r155+): bakırın metalik parlaması için sıcak anahtar + cyan kontra */}
      <ambientLight intensity={0.5} />
      <pointLight position={[4, 3, 5]} intensity={90} color="#ffd9b3" />
      <pointLight position={[-4, -2, -3]} intensity={40} color={CYAN} />
    </>
  );
}
