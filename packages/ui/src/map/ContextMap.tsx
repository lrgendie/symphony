import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistorySessionDetailResponse } from "@lrgendie/shared";
import { daemon, fetchContextMap, fetchSessionDetail, type CurationResult } from "../daemon/client";
import { layoutContextMap, startLiveLayout, type LayoutEdge, type LayoutNode } from "./layout";
import { panViewBox, zoomViewBox, type ViewBox } from "./viewbox";
import { curationActionsFor, curationErrorMessage, type CurationAction } from "./curation-actions";
import { dashOffset, DASH_PATTERN, fadeOpacity, isRecentEdge, springScale, SPRING_DURATION_MS, FADE_DURATION_MS } from "./motion";

/**
 * Bağlam Haritası (ADR-016 Karar 6, Dilim Z5 + ADR-019 Karar 2/3/4/5/6, Dilim H3+H5,
 * TASARIM.md §3/§5): dashboard'dan AYRI görünüm — mevcut sessions/agent_runs verisinin + kalıcı
 * kürasyonun kuvvet-yönlü 2D grafı. `fetchRoadmap` deseniyle AYNI: bağlantı yok/istek başarısız/
 * şema uyuşmazlığı → sessizce boş görünüm mesajı, hata gösterilmez.
 *
 * H3 kürasyonu: detay panelindeki düğmeler `map.*` WS isteklerini `daemon.*` üzerinden yollar,
 * `.ok`/`error` cevabını bekler; başarıda harita yeniden çekilir, başarısızlıkta zarif hata
 * bandı (sürüm sapması dahil, Karar 7c). "Bağla"/"Üye ekle"/"Kopar" hedef-seçme modudur. Hafta
 * düğümü → "haftayı aç" (`?week=`) + "← dön".
 *
 * H5 "yaşayan 2D" (Karar 5, TASARIM §5 — her animasyonun anlamı var, 60fps hedef):
 *  - **Sürekli hafif drift**: `startLiveLayout` (layout.ts) d3-force simülasyonunu DURDURMAZ —
 *    `onTick` her karede `nodes`/`edges`i tazeler, harita hiç "donmaz".
 *  - **Yeni düğüm doğuşu**: `firstSeenRef` her düğümün ilk görüldüğü anı tutar; render'da
 *    `springScale(yaş)` yarıçapı 0'dan sıçramalı 1'e büyütür. İLK yüklemede TÜM düğümler aynı anda
 *    zıplamasın diye ilk çekişte "doğmuş" değil "zaten var" damgası vurulur.
 *  - **Katlanmada/silmede fade**: bir önceki çekişte olup yeni çekişte KAYBOLAN düğümler
 *    `departed`e taşınır, son bilinen konumlarında donuk kalıp `fadeOpacity` ile süzülerek kaybolur.
 *  - **Son 24 saat akış nabzı**: uçlarından biri 24 saat içindeyse kenar `stroke-dasharray` alır;
 *    hareket AZALTILMAMIŞSA `stroke-dashoffset` sürekli kayar (akış hissi).
 *  - **`prefers-reduced-motion`**: `reduceMotionRef` true olduğunda drift/spring/dash-akışı HİÇ
 *    başlamaz — `layoutContextMap`in TEK SEFERLİK statik yerleşimine geri döner (H3 davranışı).
 *
 * Yakınlaştır/kaydır (2026-07-11): `viewBox`, sabit `WIDTH×HEIGHT` yerine DEĞİŞKEN bir dikdörtgeni
 * gösterir. Fare tekerleği "zoom to cursor"; tekerlek TUŞU (orta tık) basılıyken sürükleme öteler.
 * `wheel` native (non-passive) dinleyici gerektirir (React'ın sentetik onWheel'i passive olabilir).
 */

const WIDTH = 900;
const HEIGHT = 560;
/** Düğüm yarıçapı = tür (yeni türler H2/H3'te geldi). Bilinmeyen tür (Karar 7b) → varsayılan. */
const NODE_RADIUS: Record<string, number> = {
  session: 8,
  run: 7,
  project: 11,
  model: 9,
  agent: 9,
  context: 9,
  group: 12,
  week: 13,
};
const DEFAULT_NODE_RADIUS = 8;

const DEFAULT_VIEW_BOX: ViewBox = { x: 0, y: 0, w: WIDTH, h: HEIGHT };
const MIN_VIEW_W = WIDTH / 10;
const MAX_VIEW_W = WIDTH * 4;
const ZOOM_STEP = 0.9;

const ACTION_LABEL: Record<CurationAction, string> = {
  pin: "Haritaya sabitle",
  rename: "Yeniden adlandır",
  delete: "Sil",
  group: "Grupla",
  link: "Bağla",
  "member-add": "Üye ekle",
  "member-remove": "Kopar",
  "open-week": "Haftayı aç",
};

/** Hedef-seçme modunun üst banttaki açıklaması. */
const PENDING_LABEL: Record<"link" | "member-add" | "member-remove", string> = {
  link: "Bağla: bağlanacak hedef düğüme tıkla",
  "member-add": "Üye ekle: gruba eklenecek düğüme tıkla",
  "member-remove": "Kopar: gruptan çıkarılacak düğüme tıkla",
};

type FetchState = "loading" | "empty" | "error" | "ready";
type PendingTarget = { action: "link" | "member-add" | "member-remove"; sourceId: string };
/** Detay paneli düğüm verisi — x/y (konum) GEREKMEZ: seçili düğümün canlı konumu `nodes`
 * dizisinde id üzerinden eşleşir (H5: sürekli sürüklenen düğümün paneli kendi başına "donuk"
 * bir kopya taşımasın, yalnız BİLGİ taşısın). */
type NodeInfo = Pick<LayoutNode, "id" | "kind" | "label" | "at" | "meta">;
type Departed = { node: LayoutNode; departedAt: number };

/** Model düğümü yerel/API ayrımını sınıfa taşır (`.map-node-model-local`/`-api`). */
function nodeClassName(n: Pick<LayoutNode, "kind" | "meta">): string {
  if (n.kind === "model") {
    const origin = n.meta.origin === "local" ? "local" : "api";
    return `map-node map-node-model map-node-model-${origin}`;
  }
  return `map-node map-node-${n.kind}`;
}

export function ContextMap(): React.JSX.Element {
  const [nodes, setNodes] = useState<LayoutNode[]>([]);
  const [edges, setEdges] = useState<LayoutEdge[]>([]);
  const [departed, setDeparted] = useState<Departed[]>([]);
  const [state, setState] = useState<FetchState>("loading");
  const [selected, setSelected] = useState<NodeInfo | null>(null);
  const [viewBox, setViewBox] = useState<ViewBox>(DEFAULT_VIEW_BOX);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ startClientX: number; startClientY: number; startViewBox: ViewBox } | null>(
    null,
  );
  const [panning, setPanning] = useState(false);

  // H3 kürasyon durumu.
  const [week, setWeek] = useState<string | null>(null); // drill-down: açık hafta (null = güncel)
  const [pending, setPending] = useState<PendingTarget | null>(null); // hedef-seçme modu
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState("");
  const [grouping, setGrouping] = useState(false);
  const [groupText, setGroupText] = useState("");
  const [busy, setBusy] = useState(false);
  const [curationError, setCurationError] = useState<string | null>(null);

  /** Stale cevap kalkanı — her yeniden çekişte artar, geç gelen eski cevap yok sayılır. */
  const reloadSeq = useRef(0);

  // H5 "yaşayan 2D" durumu (ref'te — React re-render'ı TETİKLEMEZ, canlı tik döngüsü sürer).
  const stopLiveRef = useRef<(() => void) | null>(null);
  const nodesRef = useRef<LayoutNode[]>([]);
  const departedRef = useRef<Departed[]>([]);
  const firstSeenRef = useRef<Map<string, number>>(new Map());
  const initializedRef = useRef(false);
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    departedRef.current = departed;
  }, [departed]);

  // `prefers-reduced-motion` (H5 geri dönüş koşulu): true olunca canlı simülasyon HİÇ
  // başlamaz/derhal durur — statik (H3 dönemi) yerleşime düşülür. Ref'te tutulur ki `reload`
  // KARARLI kalsın (motion tercihi değişince tüm haritayı yeniden ÇEKMEK GEREKMEZ).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotionRef.current = mq.matches;
    const onChange = (): void => {
      reduceMotionRef.current = mq.matches;
      if (mq.matches) {
        stopLiveRef.current?.();
        stopLiveRef.current = null;
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const reload = useCallback(async (weekArg: string | null): Promise<NodeInfo[]> => {
    const seq = ++reloadSeq.current;
    setState("loading");
    const graph = await fetchContextMap(weekArg !== null ? { week: weekArg } : {});
    if (seq !== reloadSeq.current) return []; // stale — daha yeni bir çekiş başladı

    stopLiveRef.current?.();
    stopLiveRef.current = null;

    if (graph === null) {
      setState("error");
      return [];
    }
    if (graph.nodes.length === 0) {
      setNodes([]);
      setEdges([]);
      setState("empty");
      return [];
    }

    const now = Date.now();
    const newIds = new Set(graph.nodes.map((n) => n.id));

    // Katlanmada/silmede fade (H5): bir önceki çekişte var olup şimdi kaybolan düğümler, son
    // konumlarında donuk kalıp süzülerek kaybolur. (Tamamen boşa GEÇİŞTE fade YOK — o durumda
    // zaten "empty" mesajına düşülür, gösterilecek bir tuval kalmaz — bilinçli sınır.)
    if (!reduceMotionRef.current) {
      const goneNow = nodesRef.current.filter((n) => !newIds.has(n.id));
      if (goneNow.length > 0) {
        setDeparted((prev) => [...prev, ...goneNow.map((node) => ({ node, departedAt: now }))]);
      }
    }

    // Yeni düğüm doğuşu (H5): İLK yüklemede sıçrama YOK (onlarca düğüm aynı anda zıplamasın) —
    // yalnız SONRADAN (mutasyon/drill-down sonrası) beliren düğümler doğum animasyonu alır.
    for (const id of newIds) {
      if (!firstSeenRef.current.has(id)) {
        const bornNow = initializedRef.current && !reduceMotionRef.current;
        firstSeenRef.current.set(id, bornNow ? now : now - SPRING_DURATION_MS - 1);
      }
    }
    initializedRef.current = true;

    if (reduceMotionRef.current) {
      const layout = layoutContextMap(graph, WIDTH, HEIGHT);
      setNodes(layout.nodes);
      setEdges(layout.edges);
    } else {
      stopLiveRef.current = startLiveLayout(graph, WIDTH, HEIGHT, (result) => {
        setNodes(result.nodes);
        setEdges(result.edges);
        if (departedRef.current.length > 0) {
          setDeparted((prev) => {
            const next = prev.filter((d) => Date.now() - d.departedAt < FADE_DURATION_MS);
            return next.length === prev.length ? prev : next; // değişmediyse re-render TETİKLEME
          });
        }
      });
    }
    setState("ready");
    // Panel için id/kind/label/at/meta yeterli — konuma (x/y) gerek yok, o canlı `nodes`den akar.
    return graph.nodes;
  }, []);

  useEffect(() => {
    setSelected(null);
    void reload(null);
    return () => {
      reloadSeq.current++; // unmount → uçan cevabı geçersiz kıl
      stopLiveRef.current?.();
      stopLiveRef.current = null;
    };
  }, [reload]);

  // Fare tekerleği: imlecin altındaki nokta SABİT kalacak şekilde viewBox'ı küçült/büyüt.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
    const handleWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const cursorFx = (e.clientX - rect.left) / rect.width;
      const cursorFy = (e.clientY - rect.top) / rect.height;
      setViewBox((vb) =>
        zoomViewBox(vb, {
          cursorFx,
          cursorFy,
          zoomingIn: e.deltaY < 0,
          zoomStep: ZOOM_STEP,
          minW: MIN_VIEW_W,
          maxW: MAX_VIEW_W,
        }),
      );
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, []);

  // Tekerlek tuşuna (orta tık) basılıyken sürükleme: viewBox'ı öteler.
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      const drag = dragRef.current;
      const rect = svgRef.current?.getBoundingClientRect();
      if (drag === null || rect === undefined || rect.width === 0 || rect.height === 0) return;
      const dxFraction = (e.clientX - drag.startClientX) / rect.width;
      const dyFraction = (e.clientY - drag.startClientY) / rect.height;
      setViewBox(panViewBox(drag.startViewBox, { dxFraction, dyFraction }));
    };
    const handleMouseUp = (): void => {
      if (dragRef.current === null) return;
      dragRef.current = null;
      setPanning(false);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Esc: aktif hedef-seçme modunu iptal eder.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setPending(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>): void => {
    if (e.button !== 1) return; // yalnız tekerlek (orta) tuşu — sol tık düğüm seçimi için serbest
    e.preventDefault();
    dragRef.current = { startClientX: e.clientX, startClientY: e.clientY, startViewBox: viewBox };
    setPanning(true);
  };

  const pinnedRefIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of edges) if (e.kind === "pin") s.add(e.to);
    return s;
  }, [edges]);

  const projectRunCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of edges) {
      if (e.kind === "project") counts.set(e.to, (counts.get(e.to) ?? 0) + 1);
    }
    return counts;
  }, [edges]);

  const atById = useMemo(() => new Map(nodes.map((n) => [n.id, n.at])), [nodes]);

  /** Mutasyon sonrası ortak: hata → bant; başarı → yeniden çek + seçimi (varsa) tazele/temizle. */
  const afterMutation = async (result: CurationResult): Promise<void> => {
    if (!result.ok) {
      setCurationError(curationErrorMessage(result));
      return;
    }
    setCurationError(null);
    const fresh = await reload(week);
    setSelected((prev) => (prev === null ? null : (fresh.find((n) => n.id === prev.id) ?? null)));
  };

  const completeTarget = async (target: LayoutNode): Promise<void> => {
    const p = pending;
    if (p === null) return;
    setPending(null);
    setBusy(true);
    let result: CurationResult;
    if (p.action === "link") result = await daemon.addLink(p.sourceId, target.id);
    else if (p.action === "member-add") result = await daemon.addMember(p.sourceId, target.id);
    else result = await daemon.removeMember(p.sourceId, target.id);
    setBusy(false);
    await afterMutation(result);
  };

  const handleNodeClick = (n: LayoutNode): void => {
    if (pending !== null) {
      void completeTarget(n);
      return;
    }
    setSelected(n);
    setRenaming(false);
    setGrouping(false);
    setCurationError(null);
  };

  const dispatchAction = (action: CurationAction, n: NodeInfo): void => {
    switch (action) {
      case "pin":
        setBusy(true);
        void daemon
          .pin({ kind: n.kind === "session" ? "session" : "run", id: n.id })
          .then((r) => {
            setBusy(false);
            return afterMutation(r);
          });
        break;
      case "delete":
        setBusy(true);
        void daemon.deleteNode(n.id).then((r) => {
          setBusy(false);
          return afterMutation(r);
        });
        break;
      case "rename":
        setRenaming(true);
        setRenameText(n.label);
        setGrouping(false);
        break;
      case "group":
        setGrouping(true);
        setGroupText("");
        setRenaming(false);
        break;
      case "link":
        setPending({ action: "link", sourceId: n.id });
        break;
      case "member-add":
        setPending({ action: "member-add", sourceId: n.id });
        break;
      case "member-remove":
        setPending({ action: "member-remove", sourceId: n.id });
        break;
      case "open-week":
        setWeek(n.label);
        setSelected(null);
        void reload(n.label);
        break;
    }
  };

  const submitRename = (n: NodeInfo): void => {
    const title = renameText.trim();
    if (title === "") return;
    setBusy(true);
    void daemon.renameNode(n.id, title).then((r) => {
      setBusy(false);
      setRenaming(false);
      return afterMutation(r);
    });
  };

  const submitGroup = (n: NodeInfo): void => {
    const title = groupText.trim();
    if (title === "") return;
    setBusy(true);
    void daemon.createGroup(title, [n.id]).then((r) => {
      setBusy(false);
      setGrouping(false);
      return afterMutation(r);
    });
  };

  if (state === "loading" && nodes.length === 0) {
    return <p className="dim empty">Bağlam haritası yükleniyor…</p>;
  }
  if (state === "error") {
    return <p className="dim empty">Bağlam haritası yüklenemedi — daemon'a bağlantı yok.</p>;
  }
  if (state === "empty") {
    return (
      <div className="map-wrap">
        {week !== null && (
          <div className="map-drill-bar">
            <span>
              Hafta: <strong>{week}</strong>
            </span>
            <button
              type="button"
              onClick={() => {
                setWeek(null);
                setSelected(null);
                void reload(null);
              }}
            >
              ← dön
            </button>
          </div>
        )}
        <p className="dim empty">
          {week !== null
            ? "Bu haftada gösterilecek öğe yok."
            : "Henüz haritalanacak veri yok — terminalde bir sohbet ya da agent koşusu başlat."}
        </p>
      </div>
    );
  }

  const activeActions =
    selected === null
      ? []
      : curationActionsFor(selected.kind).filter(
          (a) => !(a === "pin" && pinnedRefIds.has(selected.id)),
        );

  // H5: "şimdi" render başına BİR kez okunur — canlı tik zaten her karede yeniden render tetikler,
  // ayrıca state'e koymaya gerek yok (gereksiz re-render katmanı olurdu).
  const now = Date.now();

  return (
    <div className="map-wrap">
      {week !== null && (
        <div className="map-drill-bar">
          <span>
            Hafta: <strong>{week}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              setWeek(null);
              setSelected(null);
              void reload(null);
            }}
          >
            ← dön
          </button>
        </div>
      )}
      {pending !== null && (
        <div className="map-pending-banner">
          <span>{PENDING_LABEL[pending.action]}</span>
          <button type="button" onClick={() => setPending(null)}>
            iptal (Esc)
          </button>
        </div>
      )}
      {curationError !== null && (
        <div className="map-curation-error">
          <span>{curationError}</span>
          <button type="button" onClick={() => setCurationError(null)} aria-label="kapat">
            ✕
          </button>
        </div>
      )}
      <div className="map-view">
        <svg
          ref={svgRef}
          className={`map-canvas${panning ? " map-canvas-panning" : ""}${pending !== null ? " map-canvas-targeting" : ""}`}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          onMouseDown={handleMouseDown}
          role="img"
          aria-label="Bağlam haritası — fare tekerleği: yakınlaştır, tekerlek tuşu basılı sürükle: kaydır"
        >
          {edges.map((e, i) => {
            const recent = isRecentEdge(atById.get(e.from) ?? 0, atById.get(e.to) ?? 0, now);
            return (
              <line
                key={i}
                className={`map-edge map-edge-${e.kind}${recent ? " map-edge-recent" : ""}`}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                strokeDasharray={recent ? DASH_PATTERN : undefined}
                strokeDashoffset={recent && !reduceMotionRef.current ? dashOffset(now) : undefined}
              />
            );
          })}
          {departed.map(({ node: n, departedAt }) => {
            const opacity = fadeOpacity(now - departedAt);
            const r = NODE_RADIUS[n.kind] ?? DEFAULT_NODE_RADIUS;
            if (n.kind === "week" || n.kind === "group") {
              const w = (r + 3) * 2;
              const h = (r + 1) * 1.5;
              return (
                <rect
                  key={`fade-${n.id}`}
                  className={nodeClassName(n)}
                  x={n.x - w / 2}
                  y={n.y - h / 2}
                  width={w}
                  height={h}
                  rx={3}
                  opacity={opacity}
                  pointerEvents="none"
                />
              );
            }
            return (
              <circle
                key={`fade-${n.id}`}
                className={nodeClassName(n)}
                cx={n.x}
                cy={n.y}
                r={r}
                opacity={opacity}
                pointerEvents="none"
              />
            );
          })}
          {nodes.map((n) => {
            const cls = `${nodeClassName(n)}${selected?.id === n.id ? " map-node-selected" : ""}`;
            const bornAt = firstSeenRef.current.get(n.id);
            const age = bornAt === undefined ? SPRING_DURATION_MS : now - bornAt;
            const scale = reduceMotionRef.current ? 1 : springScale(age);
            const r = (NODE_RADIUS[n.kind] ?? DEFAULT_NODE_RADIUS) * scale;
            if (n.kind === "week" || n.kind === "group") {
              const w = (r + 3) * 2;
              const h = (r + 1) * 1.5;
              return (
                <rect
                  key={n.id}
                  className={cls}
                  x={n.x - w / 2}
                  y={n.y - h / 2}
                  width={w}
                  height={h}
                  rx={3}
                  onClick={() => handleNodeClick(n)}
                >
                  <title>{n.label}</title>
                </rect>
              );
            }
            return (
              <circle
                key={n.id}
                className={cls}
                cx={n.x}
                cy={n.y}
                r={r}
                onClick={() => handleNodeClick(n)}
              >
                <title>{n.label}</title>
              </circle>
            );
          })}
        </svg>
        {selected !== null && (
          <aside className="map-detail">
            <div className="map-detail-head">
              <span className={`map-kind-tag map-kind-${selected.kind}`}>{selected.kind}</span>
              <button
                type="button"
                className="map-detail-close"
                onClick={() => setSelected(null)}
                aria-label="kapat"
              >
                ✕
              </button>
            </div>
            <h3 className="map-detail-title">{selected.label}</h3>
            <p className="dim map-detail-at">{new Date(selected.at).toLocaleString("tr-TR")}</p>

            {selected.kind === "session" && <SessionDetail sessionId={selected.id} />}
            {selected.kind === "run" && <RunDetail meta={selected.meta} />}
            {selected.kind === "project" && (
              <ProjectDetail meta={selected.meta} runCount={projectRunCounts.get(selected.id)} />
            )}
            {selected.kind === "model" && <ModelDetail meta={selected.meta} />}
            {selected.kind === "agent" && <AgentDetail meta={selected.meta} />}
            {selected.kind === "week" && <WeekDetail meta={selected.meta} />}

            {activeActions.length > 0 && (
              <div className="map-curation">
                <div className="map-curation-buttons">
                  {activeActions.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className="map-curation-btn"
                      disabled={busy}
                      onClick={() => dispatchAction(a, selected)}
                    >
                      {ACTION_LABEL[a]}
                    </button>
                  ))}
                </div>
                {renaming && (
                  <form
                    className="map-curation-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitRename(selected);
                    }}
                  >
                    <input
                      className="map-curation-input"
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      placeholder="yeni başlık"
                      autoFocus
                    />
                    <button type="submit" className="map-curation-btn" disabled={busy}>
                      Kaydet
                    </button>
                    <button type="button" className="map-curation-btn" onClick={() => setRenaming(false)}>
                      İptal
                    </button>
                  </form>
                )}
                {grouping && (
                  <form
                    className="map-curation-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitGroup(selected);
                    }}
                  >
                    <input
                      className="map-curation-input"
                      value={groupText}
                      onChange={(e) => setGroupText(e.target.value)}
                      placeholder="grup başlığı"
                      autoFocus
                    />
                    <button type="submit" className="map-curation-btn" disabled={busy}>
                      Oluştur
                    </button>
                    <button type="button" className="map-curation-btn" onClick={() => setGrouping(false)}>
                      İptal
                    </button>
                  </form>
                )}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/** Koşu detayı v1'de meta'dan (ADR-016 Karar 6) — ek istek YOK, zaten gelen veriyle gösterilir. */
function RunDetail({ meta }: { meta: Record<string, unknown> }): React.JSX.Element {
  return (
    <dl className="map-meta">
      {typeof meta.provider === "string" && (
        <>
          <dt>sağlayıcı</dt>
          <dd>{meta.provider}</dd>
        </>
      )}
      {typeof meta.model === "string" && (
        <>
          <dt>model</dt>
          <dd>{meta.model}</dd>
        </>
      )}
      {typeof meta.cwd === "string" && (
        <>
          <dt>dizin</dt>
          <dd className="map-meta-path">{meta.cwd}</dd>
        </>
      )}
    </dl>
  );
}

function ProjectDetail({
  meta,
  runCount,
}: {
  meta: Record<string, unknown>;
  runCount: number | undefined;
}): React.JSX.Element {
  return (
    <dl className="map-meta">
      {typeof meta.cwd === "string" && (
        <>
          <dt>dizin</dt>
          <dd className="map-meta-path">{meta.cwd || "(bilinmiyor)"}</dd>
        </>
      )}
      <dt>koşu sayısı</dt>
      <dd>{runCount ?? 0}</dd>
    </dl>
  );
}

/** Model düğümü (ADR-019 Karar 3): yerel/API ayrımını meta.origin taşır. */
function ModelDetail({ meta }: { meta: Record<string, unknown> }): React.JSX.Element {
  const origin = meta.origin === "local" ? "yerel (Ollama)" : "API (bulut)";
  return (
    <dl className="map-meta">
      <dt>köken</dt>
      <dd>{origin}</dd>
      {typeof meta.provider === "string" && (
        <>
          <dt>sağlayıcı</dt>
          <dd>{meta.provider}</dd>
        </>
      )}
      {typeof meta.model === "string" && (
        <>
          <dt>model</dt>
          <dd>{meta.model}</dd>
        </>
      )}
    </dl>
  );
}

function AgentDetail({ meta }: { meta: Record<string, unknown> }): React.JSX.Element {
  return (
    <dl className="map-meta">
      {typeof meta.agentId === "string" && (
        <>
          <dt>agent</dt>
          <dd>{meta.agentId}</dd>
        </>
      )}
    </dl>
  );
}

/** Hafta düğümü (ADR-019 Karar 4): katlanmış oturum/koşu sayısı + kullanılan modeller. */
function WeekDetail({ meta }: { meta: Record<string, unknown> }): React.JSX.Element {
  const models = Array.isArray(meta.models) ? (meta.models as unknown[]).filter((m) => typeof m === "string") : [];
  return (
    <dl className="map-meta">
      <dt>oturum</dt>
      <dd>{typeof meta.sessionCount === "number" ? meta.sessionCount : 0}</dd>
      <dt>koşu</dt>
      <dd>{typeof meta.runCount === "number" ? meta.runCount : 0}</dd>
      {models.length > 0 && (
        <>
          <dt>modeller</dt>
          <dd>{models.join(", ")}</dd>
        </>
      )}
    </dl>
  );
}

/** Oturum dökümü mevcut history REST'inden (ADR-016 Karar 6 Görsel) — tıklanınca ayrı istek. */
function SessionDetail({ sessionId }: { sessionId: string }): React.JSX.Element {
  const [detail, setDetail] = useState<HistorySessionDetailResponse | null | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    setDetail("loading");
    void fetchSessionDetail(sessionId).then((result) => {
      if (!cancelled) setDetail(result);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (detail === "loading") return <p className="dim">yükleniyor…</p>;
  if (detail === null) return <p className="dim">döküm alınamadı.</p>;

  return (
    <>
      <dl className="map-meta">
        <dt>sağlayıcı</dt>
        <dd>{detail.session.provider}</dd>
        <dt>model</dt>
        <dd>{detail.session.model}</dd>
        <dt>mesaj</dt>
        <dd>{detail.session.messageCount}</dd>
      </dl>
      <ul className="map-transcript">
        {detail.messages.map((m, i) => (
          <li key={i} className={`map-transcript-row map-transcript-${m.role}`}>
            <span className="dim">{m.role}</span>
            <p>{m.content}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
