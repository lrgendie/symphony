import { useEffect, useMemo, useRef, useState } from "react";
import type { ContextMapNode, HistorySessionDetailResponse } from "@symphony/shared";
import { fetchContextMap, fetchSessionDetail } from "../daemon/client";
import { layoutContextMap, type LayoutEdge, type LayoutNode } from "./layout";
import { panViewBox, zoomViewBox, type ViewBox } from "./viewbox";

/**
 * Bağlam Haritası (ADR-016 Karar 6, Dilim Z5, TASARIM.md §3): dashboard'dan AYRI görünüm —
 * mevcut sessions/agent_runs verisinin kuvvet-yönlü 2D grafı. `fetchRoadmap` deseniyle AYNI:
 * bağlantı yok/istek başarısız/şema uyuşmazlığı → sessizce boş görünüm mesajı, hata gösterilmez.
 * Sekme her açılışta yeniden çeker — d3-force YALNIZ yerleşim hesaplar, render bu SVG'dir.
 *
 * Yakınlaştır/kaydır (kullanıcı isteği, 2026-07-11): `viewBox`, sabit `WIDTH×HEIGHT` yerine
 * DEĞİŞKEN bir dikdörtgeni gösterir — d3-force'un ürettiği düğüm koordinatları (0..WIDTH,
 * 0..HEIGHT) SABİT kalır, yalnız bu pencerenin hangi kısmını gördüğümüz değişir. Fare tekerleği:
 * imlecin ALTINDAKİ nokta sabit kalacak şekilde pencereyi küçültür/büyütür (harita uygulamalarının
 * standart "zoom to cursor" matematiği). Tekerlek TUŞU (orta tık) basılıyken sürükleme: pencereyi
 * öteler. `wheel` olayı native (non-passive) dinleyici GEREKTİRİR — React'ın sentetik `onWheel`'i
 * tarayıcıda passive kayıtlı olabilir, `preventDefault()` sessizce yok sayılır (sayfa kayardı).
 */

const WIDTH = 900;
const HEIGHT = 560;
const NODE_RADIUS: Record<ContextMapNode["kind"], number> = { session: 8, run: 7, project: 11 };

const DEFAULT_VIEW_BOX: ViewBox = { x: 0, y: 0, w: WIDTH, h: HEIGHT };
/** Yakınlaştırma sınırları — orijinal görünümün onda biri ile dört katı arası. */
const MIN_VIEW_W = WIDTH / 10;
const MAX_VIEW_W = WIDTH * 4;
/** Her tekerlek adımında ~%10 yakınlaş/uzaklaş — büyük sıçramasız, akıcı hissettirir. */
const ZOOM_STEP = 0.9;

type FetchState = "loading" | "empty" | "error" | "ready";

export function ContextMap(): React.JSX.Element {
  const [nodes, setNodes] = useState<LayoutNode[]>([]);
  const [edges, setEdges] = useState<LayoutEdge[]>([]);
  const [state, setState] = useState<FetchState>("loading");
  const [selected, setSelected] = useState<LayoutNode | null>(null);
  const [viewBox, setViewBox] = useState<ViewBox>(DEFAULT_VIEW_BOX);
  const svgRef = useRef<SVGSVGElement>(null);
  /** Aktif sürükleme oturumu — state DEĞİL ref: her mousemove'da re-render TETİKLEMEZ. */
  const dragRef = useRef<{ startClientX: number; startClientY: number; startViewBox: ViewBox } | null>(
    null,
  );
  const [panning, setPanning] = useState(false);

  // Fare tekerleği: imlecin altındaki nokta SABİT kalacak şekilde viewBox'ı küçült/büyüt.
  // Native (non-passive) dinleyici — React'ın sentetik onWheel'i passive kayıtlı olabilir.
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

  // Tekerlek tuşuna (orta tık) basılıyken sürükleme: viewBox'ı öteler. window seviyesinde
  // dinlenir — fare SVG dışına çıksa bile sürükleme/bırakma doğru yakalanır.
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

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>): void => {
    if (e.button !== 1) return; // yalnız tekerlek (orta) tuşu — sol tık düğüm seçimi için serbest kalır
    e.preventDefault();
    dragRef.current = { startClientX: e.clientX, startClientY: e.clientY, startViewBox: viewBox };
    setPanning(true);
  };

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setSelected(null);
    void fetchContextMap().then((graph) => {
      if (cancelled) return;
      if (graph === null) {
        setState("error");
        return;
      }
      if (graph.nodes.length === 0) {
        setNodes([]);
        setEdges([]);
        setState("empty");
        return;
      }
      const layout = layoutContextMap(graph, WIDTH, HEIGHT);
      setNodes(layout.nodes);
      setEdges(layout.edges);
      setState("ready");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const projectRunCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of edges) {
      if (e.kind === "project") counts.set(e.to, (counts.get(e.to) ?? 0) + 1);
    }
    return counts;
  }, [edges]);

  if (state === "loading") {
    return <p className="dim empty">Bağlam haritası yükleniyor…</p>;
  }
  if (state === "error") {
    return <p className="dim empty">Bağlam haritası yüklenemedi — daemon'a bağlantı yok.</p>;
  }
  if (state === "empty") {
    return (
      <p className="dim empty">
        Henüz haritalanacak veri yok — terminalde bir sohbet ya da agent koşusu başlat.
      </p>
    );
  }

  return (
    <div className="map-view">
      <svg
        ref={svgRef}
        className={`map-canvas${panning ? " map-canvas-panning" : ""}`}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        onMouseDown={handleMouseDown}
        role="img"
        aria-label="Bağlam haritası — fare tekerleği: yakınlaştır, tekerlek tuşu basılı sürükle: kaydır"
      >
        {edges.map((e, i) => (
          <line
            key={i}
            className={`map-edge map-edge-${e.kind}`}
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
          />
        ))}
        {nodes.map((n) => (
          <circle
            key={n.id}
            className={`map-node map-node-${n.kind} ${selected?.id === n.id ? "map-node-selected" : ""}`}
            cx={n.x}
            cy={n.y}
            r={NODE_RADIUS[n.kind]}
            onClick={() => setSelected(n)}
          >
            <title>{n.label}</title>
          </circle>
        ))}
      </svg>
      {selected !== null && (
        <MapDetailPanel
          node={selected}
          projectRunCount={projectRunCounts.get(selected.id)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function MapDetailPanel({
  node,
  projectRunCount,
  onClose,
}: {
  node: LayoutNode;
  projectRunCount: number | undefined;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <aside className="map-detail">
      <div className="map-detail-head">
        <span className={`map-kind-tag map-kind-${node.kind}`}>{node.kind}</span>
        <button type="button" className="map-detail-close" onClick={onClose} aria-label="kapat">
          ✕
        </button>
      </div>
      <h3 className="map-detail-title">{node.label}</h3>
      <p className="dim map-detail-at">{new Date(node.at).toLocaleString("tr-TR")}</p>
      {node.kind === "session" && <SessionDetail sessionId={node.id} />}
      {node.kind === "run" && <RunDetail meta={node.meta} />}
      {node.kind === "project" && <ProjectDetail meta={node.meta} runCount={projectRunCount} />}
    </aside>
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
