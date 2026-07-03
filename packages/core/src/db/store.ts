import Database from "better-sqlite3";
import type { Usage } from "@symphony/shared";

/**
 * Veri katmanı (ADR-006): tüm kalıcı veri tek SQLite dosyasında
 * (`~/.symphony/data/symphony.db`). Şema sürümü `PRAGMA user_version` ile
 * izlenir; her göç bir kez, sırayla ve işlem (transaction) içinde koşar.
 *
 * Faz 1 tabloları:
 * - `requests`  — her model isteğinin kaydı (ROADMAP: router v2 ve
 *   kişiselleşme bu veriyle beslenecek)
 * - `telemetry` — hata telemetrisi: hangi işlem, hangi girdi ÖZETİ, stack
 *   (SPEC-AGENT §7: ham içerik saklanmaz — kendini onarmanın veri kaynağı)
 */
const MIGRATIONS: readonly string[] = [
  // v1 — istek kayıtları + hata telemetrisi
  `
  CREATE TABLE requests (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL,
    provider      TEXT NOT NULL,
    model         TEXT NOT NULL,
    started_at    INTEGER NOT NULL,
    duration_ms   INTEGER NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL NOT NULL DEFAULT 0,
    status        TEXT NOT NULL CHECK (status IN ('ok', 'error', 'cancelled')),
    error_code    TEXT
  );
  CREATE INDEX idx_requests_started_at ON requests (started_at);
  CREATE INDEX idx_requests_provider_model ON requests (provider, model);

  CREATE TABLE telemetry (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      INTEGER NOT NULL,
    scope   TEXT NOT NULL,
    code    TEXT NOT NULL,
    message TEXT NOT NULL,
    stack   TEXT,
    context TEXT
  );
  CREATE INDEX idx_telemetry_at ON telemetry (at);
  CREATE INDEX idx_telemetry_code ON telemetry (code);
  `,
];

export type RequestStatus = "ok" | "error" | "cancelled";

export interface RequestRecord {
  id: string;
  sessionId: string;
  provider: string;
  model: string;
  /** epoch ms */
  startedAt: number;
  durationMs: number;
  /** Hata/iptalde sıfırlar yazılır. */
  usage: Usage;
  status: RequestStatus;
  errorCode?: string;
}

export interface TelemetryRecord {
  /** Hangi işlem: "chat", "ws.message", "agent" ... */
  scope: string;
  code: string;
  message: string;
  stack?: string;
  /** Girdi ÖZETİ (model, oturum, mesaj sayısı gibi) — asla ham içerik. */
  context?: Record<string, unknown>;
}

export interface TelemetryEntry extends TelemetryRecord {
  id: number;
  /** epoch ms */
  at: number;
}

export interface UsageQueryParams {
  /** epoch ms, dahil */
  from?: number;
  /** epoch ms, dahil */
  to?: number;
  /** Varsayılan: provider */
  groupBy?: "provider" | "model" | "day";
}

export interface UsageQueryRow {
  key: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UsageQueryResult {
  rows: UsageQueryRow[];
  totals: Usage;
}

interface RequestRow {
  id: string;
  session_id: string;
  provider: string;
  model: string;
  started_at: number;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  status: string;
  error_code: string | null;
}

interface TelemetryRow {
  id: number;
  at: number;
  scope: string;
  code: string;
  message: string;
  stack: string | null;
  context: string | null;
}

interface SumRow {
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
}

export class DataStore {
  private readonly db: Database.Database;

  constructor(file: string) {
    this.db = new Database(file);
    // WAL: daemon yazar, testler/araçlar aynı anda okuyabilir; tek dosya ilkesi korunur.
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    const version = this.db.pragma("user_version", { simple: true }) as number;
    for (let next = version; next < MIGRATIONS.length; next++) {
      const sql = MIGRATIONS[next];
      if (sql === undefined) continue;
      this.db.transaction(() => {
        this.db.exec(sql);
        this.db.pragma(`user_version = ${next + 1}`);
      })();
    }
  }

  recordRequest(record: RequestRecord): void {
    this.db
      .prepare(
        `INSERT INTO requests
           (id, session_id, provider, model, started_at, duration_ms,
            input_tokens, output_tokens, cost_usd, status, error_code)
         VALUES
           (@id, @sessionId, @provider, @model, @startedAt, @durationMs,
            @inputTokens, @outputTokens, @costUsd, @status, @errorCode)`,
      )
      .run({
        id: record.id,
        sessionId: record.sessionId,
        provider: record.provider,
        model: record.model,
        startedAt: record.startedAt,
        durationMs: record.durationMs,
        inputTokens: record.usage.inputTokens,
        outputTokens: record.usage.outputTokens,
        costUsd: record.usage.costUsd,
        status: record.status,
        errorCode: record.errorCode ?? null,
      });
  }

  recordTelemetry(record: TelemetryRecord): void {
    this.db
      .prepare(
        `INSERT INTO telemetry (at, scope, code, message, stack, context)
         VALUES (@at, @scope, @code, @message, @stack, @context)`,
      )
      .run({
        at: Date.now(),
        scope: record.scope,
        code: record.code,
        message: record.message,
        stack: record.stack ?? null,
        context: record.context !== undefined ? JSON.stringify(record.context) : null,
      });
  }

  /** Bir sağlayıcı+model için kalıcı kümülatif toplamlar (usage.updated.totals). */
  usageTotals(provider: string, model: string): Usage {
    const row = this.db
      .prepare(
        `SELECT SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(cost_usd) AS cost_usd
         FROM requests WHERE provider = ? AND model = ?`,
      )
      .get(provider, model) as SumRow;
    return {
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      costUsd: row.cost_usd ?? 0,
    };
  }

  /** `usage.query` cevabı (PROTOKOL.md): gruplu satırlar + genel toplam. */
  usageQuery(params: UsageQueryParams = {}): UsageQueryResult {
    const conditions: string[] = [];
    const bind: number[] = [];
    if (params.from !== undefined) {
      conditions.push("started_at >= ?");
      bind.push(params.from);
    }
    if (params.to !== undefined) {
      conditions.push("started_at <= ?");
      bind.push(params.to);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const keyExpr =
      params.groupBy === "model"
        ? "model"
        : params.groupBy === "day"
          ? "strftime('%Y-%m-%d', started_at / 1000, 'unixepoch')"
          : "provider";

    const rows = this.db
      .prepare(
        `SELECT ${keyExpr} AS key,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(cost_usd) AS cost_usd
         FROM requests ${where} GROUP BY key ORDER BY key`,
      )
      .all(...bind) as Array<SumRow & { key: string }>;

    const totals = this.db
      .prepare(
        `SELECT SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(cost_usd) AS cost_usd
         FROM requests ${where}`,
      )
      .get(...bind) as SumRow;

    return {
      rows: rows.map((row) => ({
        key: row.key,
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        costUsd: row.cost_usd ?? 0,
      })),
      totals: {
        inputTokens: totals.input_tokens ?? 0,
        outputTokens: totals.output_tokens ?? 0,
        costUsd: totals.cost_usd ?? 0,
      },
    };
  }

  /** Son istek kayıtları (yeniden eskiye) — CLI geçmişi ve testler için. */
  recentRequests(limit = 50): RequestRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM requests ORDER BY started_at DESC, id LIMIT ?`)
      .all(limit) as RequestRow[];
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      provider: row.provider,
      model: row.model,
      startedAt: row.started_at,
      durationMs: row.duration_ms,
      usage: {
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        costUsd: row.cost_usd,
      },
      status: row.status as RequestStatus,
      ...(row.error_code !== null ? { errorCode: row.error_code } : {}),
    }));
  }

  /** Son telemetri kayıtları (yeniden eskiye) — Doktor agent'ın (Faz 8) okuyacağı tablo. */
  recentTelemetry(limit = 50): TelemetryEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM telemetry ORDER BY at DESC, id DESC LIMIT ?`)
      .all(limit) as TelemetryRow[];
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      scope: row.scope,
      code: row.code,
      message: row.message,
      ...(row.stack !== null ? { stack: row.stack } : {}),
      ...(row.context !== null
        ? { context: JSON.parse(row.context) as Record<string, unknown> }
        : {}),
    }));
  }

  close(): void {
    this.db.close();
  }
}
