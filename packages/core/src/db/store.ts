import Database from "better-sqlite3";
import type {
  ChatMessage,
  HistoryMessage,
  HistorySessionDetailResponse,
  HistorySessionSummary,
  Usage,
} from "@symphony/shared";

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
  // v2 — sohbet geçmişi (Faz 2): oturumlar + mesajlar. Mesajlar her başarılı
  // turda TAM geçmişle değiştirilir (PROTOKOL §3 — replace, idempotent).
  `
  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    provider   TEXT NOT NULL,
    model      TEXT NOT NULL,
    title      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_updated_at ON sessions (updated_at);

  CREATE TABLE messages (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    idx        INTEGER NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
    content    TEXT NOT NULL,
    at         INTEGER NOT NULL,
    PRIMARY KEY (session_id, idx)
  );
  `,
  // v3 — agent koşuları (Faz 3, SPEC-AGENT §7): koşu meta + adım kayıtları.
  // Ham dosya içerikleri DEĞİL, özetler saklanır; Doktor agent (Faz 8) bunları okur.
  `
  CREATE TABLE agent_runs (
    id            TEXT PRIMARY KEY,
    agent_id      TEXT NOT NULL,
    task          TEXT NOT NULL,
    provider      TEXT NOT NULL,
    model         TEXT NOT NULL,
    cwd           TEXT NOT NULL,
    state         TEXT NOT NULL CHECK (state IN
      ('queued','thinking','awaiting_permission','executing_tool','completed','failed','cancelled')),
    result        TEXT,
    error_code    TEXT,
    steps         INTEGER NOT NULL DEFAULT 0,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL NOT NULL DEFAULT 0,
    started_at    INTEGER NOT NULL,
    finished_at   INTEGER
  );
  CREATE INDEX idx_agent_runs_started_at ON agent_runs (started_at);

  CREATE TABLE agent_steps (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id       TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    step         INTEGER NOT NULL,
    tool         TEXT NOT NULL,
    args_summary TEXT NOT NULL,
    ok           INTEGER NOT NULL,
    error_code   TEXT,
    duration_ms  INTEGER NOT NULL,
    at           INTEGER NOT NULL
  );
  CREATE INDEX idx_agent_steps_run_id ON agent_steps (run_id);
  `,
  // v4 — konuşmalı koşu (ADR-012, dilim 2.2): agent_runs.state CHECK'ine 'awaiting_user'
  // eklendi. SQLite CHECK'i değiştiremez → tablo yeniden kurulur (kopyala-taşı; agent_steps'in
  // FK'sı tablo ADI üzerinden çalıştığı için rename sonrası aynen geçerli kalır).
  `
  CREATE TABLE agent_runs_v4 (
    id            TEXT PRIMARY KEY,
    agent_id      TEXT NOT NULL,
    task          TEXT NOT NULL,
    provider      TEXT NOT NULL,
    model         TEXT NOT NULL,
    cwd           TEXT NOT NULL,
    state         TEXT NOT NULL CHECK (state IN
      ('queued','thinking','awaiting_permission','awaiting_user','executing_tool',
       'completed','failed','cancelled')),
    result        TEXT,
    error_code    TEXT,
    steps         INTEGER NOT NULL DEFAULT 0,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL NOT NULL DEFAULT 0,
    started_at    INTEGER NOT NULL,
    finished_at   INTEGER
  );
  INSERT INTO agent_runs_v4 SELECT * FROM agent_runs;
  DROP INDEX idx_agent_runs_started_at;
  DROP TABLE agent_runs;
  ALTER TABLE agent_runs_v4 RENAME TO agent_runs;
  CREATE INDEX idx_agent_runs_started_at ON agent_runs (started_at);
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

export interface ChatTurnRecord {
  sessionId: string;
  provider: string;
  model: string;
  /** İstemcinin gönderdiği TAM mesaj geçmişi (asistan cevabı hariç). */
  messages: ChatMessage[];
  assistantText: string;
}

interface SessionRow {
  id: string;
  provider: string;
  model: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}

interface MessageRow {
  idx: number;
  role: string;
  content: string;
  at: number;
}

/** Başlık ilk kullanıcı mesajından türetilir: tek satır, en çok 80 karakter. */
function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.content ?? "";
  return first.replace(/\s+/g, " ").trim().slice(0, 80);
}

function toSessionSummary(row: SessionRow): HistorySessionSummary {
  return {
    sessionId: row.id,
    provider: row.provider,
    model: row.model,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
  };
}

export class DataStore {
  private readonly db: Database.Database;

  constructor(file: string) {
    this.db = new Database(file);
    // WAL: daemon yazar, testler/araçlar aynı anda okuyabilir; tek dosya ilkesi korunur.
    this.db.pragma("journal_mode = WAL");
    // messages.session_id REFERENCES + ON DELETE CASCADE ancak bununla işler.
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version >= MIGRATIONS.length) return;
    // Tablo-yeniden-kurma göçleri (ör. v4) FK zorlaması AÇIKKEN parent DROP'unda ON DELETE
    // CASCADE ile çocuk satırları da silerdi — standart SQLite reçetesi: göç boyunca FK'yı
    // kapat, bitince foreign_key_check ile doğrula, sonra yeniden aç (pragma transaction
    // içinde no-op olduğundan burada, dışarıda yapılır).
    this.db.pragma("foreign_keys = OFF");
    try {
      for (let next = version; next < MIGRATIONS.length; next++) {
        const sql = MIGRATIONS[next];
        if (sql === undefined) continue;
        this.db.transaction(() => {
          this.db.exec(sql);
          this.db.pragma(`user_version = ${next + 1}`);
        })();
      }
      const violations = this.db.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(`Göç sonrası FK ihlali: ${JSON.stringify(violations.slice(0, 3))}`);
      }
    } finally {
      this.db.pragma("foreign_keys = ON");
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

  /**
   * Bir oturumun TÜM mesajlarını verilen tam listeyle DEĞİŞTİRİR (PROTOKOL §3, replace —
   * idempotent). Oturum upsert edilir; değişmeyen satırların `at` zamanı korunur (mesajın ilk
   * yazıldığı tur). Hem chat.start (saveChatTurn) hem konuşmalı-agent (Dilim 2.3b) bunu kullanır.
   */
  saveConversation(record: {
    sessionId: string;
    provider: string;
    model: string;
    messages: ChatMessage[];
  }): void {
    const now = Date.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO sessions (id, provider, model, title, created_at, updated_at)
           VALUES (@id, @provider, @model, @title, @now, @now)
           ON CONFLICT (id) DO UPDATE SET
             provider = @provider, model = @model, title = @title, updated_at = @now`,
        )
        .run({
          id: record.sessionId,
          provider: record.provider,
          model: record.model,
          title: deriveTitle(record.messages),
          now,
        });

      const previous = this.db
        .prepare(`SELECT idx, at FROM messages WHERE session_id = ?`)
        .all(record.sessionId) as Array<{ idx: number; at: number }>;
      const previousAt = new Map(previous.map((row) => [row.idx, row.at]));
      this.db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(record.sessionId);

      const insert = this.db.prepare(
        `INSERT INTO messages (session_id, idx, role, content, at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      record.messages.forEach((message, idx) => {
        insert.run(record.sessionId, idx, message.role, message.content, previousAt.get(idx) ?? now);
      });
    })();
  }

  /**
   * Başarıyla biten bir sohbet turunu kaydeder (PROTOKOL §3): tam geçmiş + asistan cevabı
   * `saveConversation` ile REPLACE edilir.
   */
  saveChatTurn(turn: ChatTurnRecord): void {
    this.saveConversation({
      sessionId: turn.sessionId,
      provider: turn.provider,
      model: turn.model,
      messages: [...turn.messages, { role: "assistant", content: turn.assistantText }],
    });
  }

  /** Son sohbet oturumları (yeniden eskiye) — REST /api/history/sessions. */
  listSessions(limit = 50): HistorySessionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT s.*,
                (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
         FROM sessions s ORDER BY s.updated_at DESC, s.id LIMIT ?`,
      )
      .all(limit) as SessionRow[];
    return rows.map(toSessionSummary);
  }

  /** Bir oturumun tam dökümü — REST /api/history/sessions/:id. Yoksa null. */
  sessionDetail(sessionId: string): HistorySessionDetailResponse | null {
    const row = this.db
      .prepare(
        `SELECT s.*,
                (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
         FROM sessions s WHERE s.id = ?`,
      )
      .get(sessionId) as SessionRow | undefined;
    if (row === undefined) return null;
    const messages = this.db
      .prepare(`SELECT idx, role, content, at FROM messages WHERE session_id = ? ORDER BY idx`)
      .all(sessionId) as MessageRow[];
    return {
      session: toSessionSummary(row),
      messages: messages.map((m): HistoryMessage => ({
        role: m.role as HistoryMessage["role"],
        content: m.content,
        at: m.at,
      })),
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

  // ---- Agent koşuları (v3, SPEC-AGENT §7) ----

  createAgentRun(record: AgentRunCreate): void {
    this.db
      .prepare(
        `INSERT INTO agent_runs (id, agent_id, task, provider, model, cwd, state, started_at)
         VALUES (@id, @agentId, @task, @provider, @model, @cwd, 'queued', @startedAt)`,
      )
      .run(record);
  }

  updateAgentRunState(id: string, state: string): void {
    this.db.prepare(`UPDATE agent_runs SET state = ? WHERE id = ?`).run(state, id);
  }

  finishAgentRun(id: string, finish: AgentRunFinish): void {
    this.db
      .prepare(
        `UPDATE agent_runs SET
           state = @state, result = @result, error_code = @errorCode, steps = @steps,
           input_tokens = @inputTokens, output_tokens = @outputTokens, cost_usd = @costUsd,
           finished_at = @finishedAt
         WHERE id = @id`,
      )
      .run({
        id,
        state: finish.state,
        result: finish.result,
        errorCode: finish.errorCode,
        steps: finish.steps,
        inputTokens: finish.usage.inputTokens,
        outputTokens: finish.usage.outputTokens,
        costUsd: finish.usage.costUsd,
        finishedAt: Date.now(),
      });
  }

  recordAgentStep(record: AgentStepRecord): void {
    this.db
      .prepare(
        `INSERT INTO agent_steps (run_id, step, tool, args_summary, ok, error_code, duration_ms, at)
         VALUES (@runId, @step, @tool, @argsSummary, @ok, @errorCode, @durationMs, @at)`,
      )
      .run({ ...record, ok: record.ok ? 1 : 0, at: Date.now() });
  }

  /**
   * Daemon açılışı (SPEC-AGENT §4): önceki ömürden yarım kalmış koşular
   * failed(AGENT_DAEMON_RESTART) işaretlenir — otomatik devam YOK (v1 kararı).
   */
  markInterruptedAgentRuns(): number {
    const result = this.db
      .prepare(
        `UPDATE agent_runs
         SET state = 'failed', error_code = 'AGENT_DAEMON_RESTART', finished_at = ?
         WHERE state NOT IN ('completed', 'failed', 'cancelled')`,
      )
      .run(Date.now());
    return result.changes;
  }

  /** Son koşular (yeniden eskiye) — CLI listesi ve testler için. */
  recentAgentRuns(limit = 50): AgentRunRow[] {
    return this.db
      .prepare(`SELECT * FROM agent_runs ORDER BY started_at DESC, id LIMIT ?`)
      .all(limit) as AgentRunRow[];
  }

  /**
   * Router v2 (ADR-016 Karar 1): tamamlanmış koşuların ham listesi — görev türü sınıflandırması
   * ÇAĞIRAN TARAFTA (router/stats.ts) yapılır, burada yalnız veri çekilir. `cancelled` koşular
   * BİLİNÇLE dışarıda (kullanıcı vazgeçti — ne başarı ne başarısızlık kanıtıdır).
   */
  runsSince(sinceMs: number): RouterRunRow[] {
    const rows = this.db
      .prepare(
        `SELECT task, provider, model, state, cost_usd
         FROM agent_runs WHERE started_at >= ? AND state IN ('completed', 'failed')`,
      )
      .all(sinceMs) as Array<{
      task: string;
      provider: string;
      model: string;
      state: string;
      cost_usd: number;
    }>;
    return rows.map((row) => ({
      task: row.task,
      provider: row.provider,
      model: row.model,
      ok: row.state === "completed",
      costUsd: row.cost_usd,
    }));
  }

  /**
   * Router v2 (ADR-016 Karar 1): sağlayıcı+model başına ortalama tur süresi. `requests.duration_ms`
   * KULLANILIR — `agent_runs`'ın toplam süresi insan beklemesini (awaiting_permission/awaiting_user)
   * içerir, model hızını ÖLÇMEZ; `requests` yalnız model turlarını kapsar.
   */
  turnStatsSince(sinceMs: number): RouterTurnStatsRow[] {
    const rows = this.db
      .prepare(
        `SELECT provider, model, AVG(duration_ms) AS avg_duration_ms, COUNT(*) AS turns
         FROM requests WHERE started_at >= ? AND status = 'ok'
         GROUP BY provider, model`,
      )
      .all(sinceMs) as Array<{
      provider: string;
      model: string;
      avg_duration_ms: number;
      turns: number;
    }>;
    return rows.map((row) => ({
      provider: row.provider,
      model: row.model,
      avgDurationMs: row.avg_duration_ms,
      turns: row.turns,
    }));
  }

  close(): void {
    this.db.close();
  }
}

/** `runsSince` satırı — router/stats.ts girdisi. */
export interface RouterRunRow {
  task: string;
  provider: string;
  model: string;
  ok: boolean;
  costUsd: number;
}

/** `turnStatsSince` satırı — router/stats.ts girdisi. */
export interface RouterTurnStatsRow {
  provider: string;
  model: string;
  avgDurationMs: number;
  turns: number;
}

export interface AgentRunCreate {
  id: string;
  agentId: string;
  task: string;
  provider: string;
  model: string;
  cwd: string;
  startedAt: number;
}

export interface AgentRunFinish {
  state: "completed" | "failed" | "cancelled";
  result: string | null;
  errorCode: string | null;
  usage: Usage;
  steps: number;
}

export interface AgentStepRecord {
  runId: string;
  step: number;
  tool: string;
  argsSummary: string;
  ok: boolean;
  errorCode: string | null;
  durationMs: number;
}

/** agent_runs satırı (SQLite sütun adlarıyla) — rapor/test amaçlı ham görünüm. */
export interface AgentRunRow {
  id: string;
  agent_id: string;
  task: string;
  provider: string;
  model: string;
  cwd: string;
  state: string;
  result: string | null;
  error_code: string | null;
  steps: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  started_at: number;
  finished_at: number | null;
}
