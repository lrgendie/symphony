import { useEffect, useRef } from "react";
import { PROTOCOL_VERSION } from "@symphony/shared";
import { DaemonConnection } from "./daemon/client";
import { useStore, type ConnStatus, type LogTone } from "./store";

/**
 * Faz 4 dilim 1 — "Şef Paneli" minimal: bağlantı durumu, sağlayıcı sağlığı,
 * aktif agent koşuları ve canlı olay akışı. Terminalde başlatılan bir koşu
 * buraya 1 sn içinde düşer (daemon EventBus tüm istemcilere yayınlar, ADR-001).
 */
export function App(): React.JSX.Element {
  useEffect(() => {
    const connection = new DaemonConnection();
    connection.start();
    return () => connection.stop();
  }, []);

  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const daemonVersion = useStore((s) => s.daemonVersion);
  const providers = useStore((s) => s.providers);
  const runs = useStore((s) => s.runs);
  const pending = useStore((s) => s.pendingPermissions);
  const log = useStore((s) => s.log);

  const active = runs.length > 0 || pending > 0;

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
          Aktif koşular <span className="count">{runs.length}</span>
          {pending > 0 && <span className="count count-warn">{pending} izin bekliyor</span>}
        </h2>
        {runs.length === 0 ? (
          <p className="dim empty">Şu an çalışan agent yok. Terminalde `symphony agent …` başlat.</p>
        ) : (
          <ul className="runs">
            {runs.map((r) => (
              <li key={r.runId} className="run">
                <span className={`state state-${r.state}`}>{r.state}</span>
                <span className="run-agent">{r.agentId}</span>
                {r.model !== undefined && <span className="dim">{r.model}</span>}
                <span className="run-task">{r.task}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel panel-grow">
        <h2>Canlı akış</h2>
        <LogFeed items={log} />
      </section>
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
