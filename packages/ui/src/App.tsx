import { useEffect, useRef } from "react";
import {
  PROTOCOL_VERSION,
  type ActiveRun,
  type PendingPermission,
  type ProviderLimitsPayload,
  type Usage,
} from "@symphony/shared";
import { daemon, type PermissionDecision } from "./daemon/client";
import { LivingScene } from "./scene/LivingScene";
import {
  groupRunsByProject,
  useStore,
  type ConnStatus,
  type LogTone,
  type ModelUsage,
  type RunFilePreview,
} from "./store";

/**
 * Faz 4 dilim 1-2 — "Şef Paneli": bağlantı durumu, sağlayıcı sağlığı, aktif agent
 * koşuları, İZİN İSTEKLERİ (masaüstünden cevaplanabilir) ve canlı olay akışı.
 * Terminalde başlatılan bir koşunun izin isteği buraya düşer; buradan verilen karar
 * daemon üzerinden TÜM istemcilere yayılır (ilk cevap kazanır, SPEC-AGENT §5).
 */
export function App(): React.JSX.Element {
  useEffect(() => {
    daemon.start();
    return () => daemon.stop();
  }, []);

  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const daemonVersion = useStore((s) => s.daemonVersion);
  const providers = useStore((s) => s.providers);
  const runs = useStore((s) => s.runs);
  const runStreams = useStore((s) => s.runStreams);
  const runFiles = useStore((s) => s.runFiles);
  const pending = useStore((s) => s.pendingPermissions);
  const log = useStore((s) => s.log);
  const usageTotals = useStore((s) => s.usageTotals);
  const usageByModel = useStore((s) => s.usageByModel);
  const sessionTokens = useStore((s) => s.sessionTokens);
  const sessionCostUsd = useStore((s) => s.sessionCostUsd);
  const sessionCacheReadTokens = useStore((s) => s.sessionCacheReadTokens);
  const sessionCacheCreationTokens = useStore((s) => s.sessionCacheCreationTokens);
  const limits = useStore((s) => s.limits);

  const active = runs.length > 0 || pending.length > 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className={`pulse ${active ? "pulse-on" : ""}`} aria-hidden />
          <span className="wordmark">SYMPHONY</span>
        </div>
        <div className="meta">
          <StatusPill status={status} />
          <span className="dim">
            {daemonVersion !== null ? `daemon ${daemonVersion} · ` : ""}protokol v{PROTOCOL_VERSION}
          </span>
        </div>
      </header>

      {error !== null && <div className="banner banner-error">{error}</div>}

      <LivingScene />

      {pending.length > 0 && (
        <section className="panel panel-perm">
          <h2>
            İzin bekliyor <span className="count count-warn">{pending.length}</span>
          </h2>
          {pending.map((p) => (
            <PermissionCard key={p.requestId} permission={p} />
          ))}
        </section>
      )}

      <section className="panel">
        <h2>Sağlayıcılar</h2>
        <div className="chips">
          {providers.length === 0 && <span className="dim">—</span>}
          {providers.map((p) => (
            <span key={p.provider} className={`chip chip-${p.status}`}>
              <span className="dot" /> {p.provider}
            </span>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>
          Model panosu <span className="count">${fmtCost(usageTotals.costUsd)}</span>
        </h2>
        <ModelBoard
          totals={usageTotals}
          byModel={usageByModel}
          sessionTokens={sessionTokens}
          sessionCostUsd={sessionCostUsd}
          cacheReadTokens={sessionCacheReadTokens}
          cacheCreationTokens={sessionCacheCreationTokens}
        />
      </section>

      {Object.keys(limits).length > 0 && (
        <section className="panel">
          <h2>API kapasitesi</h2>
          <div className="limits">
            {Object.values(limits)
              .sort((a, b) => a.provider.localeCompare(b.provider))
              .map((l) => (
                <LimitGauge key={l.provider} limits={l} />
              ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h2>
          Aktif koşular <span className="count">{runs.length}</span>
        </h2>
        {runs.length === 0 ? (
          <p className="dim empty">Şu an çalışan agent yok. Terminalde `symphony agent …` başlat.</p>
        ) : (
          // Faz 4 (ADR-015): "proje" = cwd'nin kendisi, kayıt defteri YOK — grup adı basename.
          groupRunsByProject(runs).map((group) => (
            <div key={group.cwd} className="project-group">
              <div className="project-head">
                <span className="project-name">{group.name}</span>
                <span className="dim project-path">{group.cwd}</span>
              </div>
              <ul className="runs">
                {group.runs.map((r) => (
                  <RunRow key={r.runId} run={r} stream={runStreams[r.runId]} file={runFiles[r.runId]} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className="panel panel-grow">
        <h2>Canlı akış</h2>
        <LogFeed items={log} />
      </section>
    </div>
  );
}

function PermissionCard({ permission }: { permission: PendingPermission }): React.JSX.Element {
  // destructive'de "bu koşu boyunca"/"daima" SUNULMAZ (SPEC-AGENT §5, CLI/TUI ile aynı).
  const canAlways = permission.riskClass !== "destructive";
  const respond = (decision: PermissionDecision): void => {
    daemon.respond(permission.requestId, decision);
    // İyimser kaldırma; permission.resolved yayını da aynı requestId'yi temizler (idempotent).
    useStore.getState().removePending(permission.requestId);
  };
  return (
    <div className={`perm perm-${permission.riskClass}`}>
      <div className="perm-head">
        🔐 <b>{permission.tool}</b>
        <span className={`risk risk-${permission.riskClass}`}>{permission.riskClass}</span>
      </div>
      <div className="perm-args dim">{JSON.stringify(permission.args)}</div>
      {permission.diff !== undefined && <Diff diff={permission.diff} />}
      <div className="perm-actions">
        <button type="button" className="btn btn-yes" onClick={() => respond("allow")}>
          Evet
        </button>
        {canAlways && (
          <button type="button" className="btn" onClick={() => respond("allow_for_run")}>
            Bu koşu boyunca
          </button>
        )}
        {canAlways && (
          <button type="button" className="btn" onClick={() => respond("always_allow")}>
            Daima izin ver
          </button>
        )}
        <button type="button" className="btn btn-no" onClick={() => respond("deny")}>
          Hayır
        </button>
      </div>
    </div>
  );
}

/** Bir koşu satırı: durum + agent + model + görev + (varsa) akış metni/dosya önizlemesi. */
function RunRow({
  run,
  stream,
  file,
}: {
  run: ActiveRun;
  stream: string | undefined;
  file: RunFilePreview | undefined;
}): React.JSX.Element {
  return (
    <li className={run.parentRunId !== undefined ? "run run-child" : "run"}>
      {run.parentRunId !== undefined && <span className="run-child-arrow">↳</span>}
      <span className={`state state-${run.state}`}>{run.state}</span>
      <span className="run-agent">{run.agentId}</span>
      {run.model !== undefined && <span className="dim">{run.model}</span>}
      <span className="run-task">{run.task}</span>
      {stream !== undefined && stream !== "" && <p className="run-stream">{stream}</p>}
      {file !== undefined && <RunFile file={file} />}
    </li>
  );
}

/**
 * Faz 4 "hangi dosya" zengin görünümü: koşu satırının altında kalıcı — izin kartı onaylanıp
 * kapansa da (write_file/edit) diff burada kalır; read_file'da (izin istemez) sonuç önizlemesi
 * gösterilir. `agent.tool.completed`'a dek yalnız başlık (summary) görünür.
 */
function RunFile({ file }: { file: RunFilePreview }): React.JSX.Element {
  return (
    <div className="run-file">
      <div className="run-file-head dim">📄 {file.summary}</div>
      {file.diff !== undefined && <Diff diff={file.diff} />}
      {file.result !== undefined && <p className="run-file-result dim">{file.result}</p>}
    </div>
  );
}

function Diff({ diff }: { diff: string }): React.JSX.Element {
  return (
    <pre className="diff">
      {diff.split("\n").map((line, i) => {
        const added = line.startsWith("+") && !line.startsWith("+++");
        const removed = line.startsWith("-") && !line.startsWith("---");
        return (
          <div key={i} className={added ? "d-add" : removed ? "d-del" : "d-ctx"}>
            {line}
          </div>
        );
      })}
    </pre>
  );
}

function ModelBoard({
  totals,
  byModel,
  sessionTokens,
  sessionCostUsd,
  cacheReadTokens,
  cacheCreationTokens,
}: {
  totals: Usage;
  byModel: ModelUsage[];
  sessionTokens: number;
  sessionCostUsd: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): React.JSX.Element {
  // Çubuk genişliği en pahalı modele göre orantılı (göreli maliyet payı okunur olsun).
  const maxCost = byModel.reduce((m, r) => Math.max(m, r.costUsd), 0);
  return (
    <div className="usage">
      <div className="usage-summary">
        <Metric label="giriş" value={fmtTokens(totals.inputTokens)} accent="cyan" />
        <Metric label="çıkış" value={fmtTokens(totals.outputTokens)} accent="magenta" />
        <Metric label="toplam maliyet" value={`$${fmtCost(totals.costUsd)}`} accent="green" />
        <Metric
          label="bu oturum"
          value={`${fmtTokens(sessionTokens)} · $${fmtCost(sessionCostUsd)}`}
          accent="amber"
        />
        {(cacheReadTokens > 0 || cacheCreationTokens > 0) && (
          <Metric
            label="önbellek ↓okundu ↑yazıldı"
            value={`${fmtTokens(cacheReadTokens)} · ${fmtTokens(cacheCreationTokens)}`}
            accent="cyan"
          />
        )}
      </div>
      {byModel.length === 0 ? (
        <p className="dim empty">Henüz kullanım yok — terminalde bir sohbet ya da agent koşusu başlat.</p>
      ) : (
        <ul className="models">
          {byModel.map((m) => (
            <li key={m.model} className="model-row">
              <div className="model-head">
                <span className="model-name">{m.model}</span>
                {m.provider !== undefined && <span className="dim">{m.provider}</span>}
                <span className="model-cost">${fmtCost(m.costUsd)}</span>
              </div>
              <div className="model-bar-track">
                <div
                  className="model-bar"
                  style={{ width: `${maxCost > 0 ? (m.costUsd / maxCost) * 100 : 0}%` }}
                />
              </div>
              <div className="model-tokens dim">
                {fmtTokens(m.inputTokens)} giriş · {fmtTokens(m.outputTokens)} çıkış
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "cyan" | "magenta" | "green" | "amber";
}): React.JSX.Element {
  return (
    <div className="metric">
      <span className={`metric-value metric-${accent}`}>{value}</span>
      <span className="metric-label dim">{label}</span>
    </div>
  );
}

/** Token sayısını okunur kısaltır: 1234 → 1.2K, 2_500_000 → 2.5M. */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Maliyet: dev'de çok küçük olabildiği için <$1'de 4 hane, üstünde 2 hane. */
function fmtCost(n: number): string {
  return n >= 1 ? n.toFixed(2) : n.toFixed(4);
}

/** Reset anına kalan süre (render anında hesaplanır; yeni limit gelince tazelenir). */
function fmtReset(epochMs: number): string {
  const s = Math.max(0, Math.round((epochMs - Date.now()) / 1000));
  return s >= 60 ? `${Math.round(s / 60)}dk` : `${s}s`;
}

/** Bir sağlayıcının rate-limit göstergesi: istek + token kovaları, 429 uyarısı. */
function LimitGauge({ limits: l }: { limits: ProviderLimitsPayload }): React.JSX.Element {
  return (
    <div className="limit">
      <div className="limit-head">
        <span className="limit-provider">{l.provider}</span>
        {l.retryAfterSec !== undefined && (
          <span className="limit-retry">429 · {l.retryAfterSec}s bekle</span>
        )}
      </div>
      {l.requestsLimit !== undefined && (
        <LimitBar
          label="istek/dk"
          remaining={l.requestsRemaining}
          limit={l.requestsLimit}
          resetAt={l.requestsResetAt}
        />
      )}
      {l.tokensLimit !== undefined && (
        <LimitBar
          label="token/dk"
          remaining={l.tokensRemaining}
          limit={l.tokensLimit}
          resetAt={l.tokensResetAt}
        />
      )}
    </div>
  );
}

function LimitBar({
  label,
  remaining,
  limit,
  resetAt,
}: {
  label: string;
  remaining?: number;
  limit: number;
  resetAt?: number;
}): React.JSX.Element {
  const rem = remaining ?? limit;
  const pct = limit > 0 ? (rem / limit) * 100 : 0;
  // Kalan kapasiteye göre ton: >%50 yeşil, %20–50 amber, <%20 kırmızı (throttle'a yaklaşıyor).
  const tone = pct > 50 ? "good" : pct > 20 ? "warn" : "bad";
  return (
    <div className="limit-row">
      <div className="limit-row-head">
        <span className="dim">{label}</span>
        <span className={`limit-val limit-${tone}`}>
          {fmtTokens(rem)} / {fmtTokens(limit)}
        </span>
        {resetAt !== undefined && <span className="dim limit-reset">yeniler {fmtReset(resetAt)}</span>}
      </div>
      <div className="limit-bar-track">
        <div className={`limit-bar limit-bar-${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: ConnStatus }): React.JSX.Element {
  const label = status === "connected" ? "bağlı" : status === "connecting" ? "bağlanıyor" : "kopuk";
  return (
    <span className={`status status-${status}`}>
      <span className="dot" /> {label}
    </span>
  );
}

function LogFeed({ items }: { items: ReadonlyArray<{ id: number; ts: number; tone: LogTone; text: string }> }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [items]);

  if (items.length === 0) {
    return <p className="dim empty">Henüz olay yok — bağlandıktan sonra canlı akacak.</p>;
  }
  return (
    <div className="log" ref={ref}>
      {items.map((item) => (
        <div key={item.id} className={`log-row tone-${item.tone}`}>
          <span className="log-time">{formatTime(item.ts)}</span>
          <span className="log-text">{item.text}</span>
        </div>
      ))}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
