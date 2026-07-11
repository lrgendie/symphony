import { z } from "zod";
import { ChatMessageSchema, PatchStateSchema } from "./common.js";

/**
 * İstemci → Daemon istekleri (PROTOKOL.md §3).
 * Her isteğin cevabı: başarıda `<type>.ok` (events.ts), hatada `error`.
 */

export const HelloPayloadSchema = z
  .object({
    token: z.string().min(1),
    client: z.enum(["cli", "desktop", "web"]),
    protocolVersion: z.number().int().positive(),
  })
  .strip();

export const StateSyncPayloadSchema = z.object({}).strip();

export const ChatStartPayloadSchema = z
  .object({
    sessionId: z.string().uuid().optional(),
    provider: z.string().min(1),
    model: z.string().min(1),
    messages: z.array(ChatMessageSchema).min(1),
    options: z
      .object({
        // Determinizm varsayılandır (ADR-008): açıkça verilmezse 0.
        temperature: z.number().min(0).max(2).default(0),
        maxTokens: z.number().int().positive().optional(),
      })
      .strip()
      .default({}),
  })
  .strip();

export const ChatCancelPayloadSchema = z.object({ sessionId: z.string().uuid() }).strip();

export const AgentStartPayloadSchema = z
  .object({
    agentId: z.string().min(1),
    task: z.string().min(1),
    cwd: z.string().min(1),
    model: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    // Workspace hapsine ek dizinler — her biri açık onay ister (SPEC-AGENT.md §3).
    extraDirs: z.array(z.string().min(1)).optional(),
    // ADR-012: true → tur araçsız bitince completed yerine awaiting_user'a park, agent.say ile sürer.
    conversational: z.boolean().optional(),
    // Dilim 2.3b: verilirse konuşmalı koşu o oturuma DEVAM eder (geçmiş bağlama tohumlanır) ve
    // aynı sessionId'ye yazar; yalnız `conversational` ile anlamlıdır.
    sessionId: z.string().uuid().optional(),
  })
  .strip();

export const AgentCancelPayloadSchema = z.object({ runId: z.string().uuid() }).strip();

/** Konuşmalı koşuya sonraki kullanıcı turu (ADR-012) — yalnız awaiting_user'dayken geçerli. */
export const AgentSayPayloadSchema = z
  .object({ runId: z.string().uuid(), text: z.string().min(1) })
  .strip();

export const PermissionRespondPayloadSchema = z
  .object({
    requestId: z.string().uuid(),
    decision: z.enum(["allow", "deny", "always_allow", "allow_for_run"]),
  })
  .strip();

export const ModelsListPayloadSchema = z.object({}).strip();

export const AgentsListPayloadSchema = z.object({}).strip();

export const ProvidersStatusPayloadSchema = z.object({}).strip();

export const RouterSuggestPayloadSchema = z
  .object({
    task: z.string().min(1),
    constraints: z
      .object({
        maxCostUsd: z.number().nonnegative().optional(),
        preferLocal: z.boolean().optional(),
      })
      .strip()
      .optional(),
  })
  .strip();

/** Eklenti sistemi (ROADMAP Faz 3, SPEC-AGENT §2.1): daemon canlı bağlanıp doğrular. */
export const McpAddServerPayloadSchema = z
  .object({
    name: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
  })
  .strip();

export const UsageQueryPayloadSchema = z
  .object({
    from: z.number().int().nonnegative().optional(),
    to: z.number().int().nonnegative().optional(),
    groupBy: z.enum(["provider", "model", "day"]).optional(),
  })
  .strip();

/**
 * Açık kullanıcı geri bildirimi (ADR-016 Karar 4): router v2 skorlarını besler. `subject`/`verdict`
 * wire değerleridir (tanımlayıcı → İngilizce, ADR notu); `id` koşuysa `agent_runs.id`, sohbetse
 * `sessions.id` — daemon doğrular, yoksa `VALIDATION_FEEDBACK_SUBJECT_UNKNOWN`.
 */
export const FeedbackSubmitPayloadSchema = z
  .object({
    subject: z.enum(["run", "chat"]),
    id: z.string().uuid(),
    verdict: z.enum(["good", "bad"]),
    note: z.string().min(1).optional(),
  })
  .strip();

/**
 * Kendini geliştirme (ADR-018, Faz 8 Dilim D2): tekrarlayan hata adaylarını sorar — teşhis
 * DETERMİNİSTİKTİR (eşik tabanlı), LLM'e "hangi hata önemli" sorulmaz.
 */
export const DoctorDiagnosePayloadSchema = z.object({}).strip();

/**
 * Doktor boru hattını başlatır (ADR-018 Karar 2): sandbox (git worktree) aç → teşhis dosyasını
 * yaz → `doktor` agent'ını koştur → BORU HATTI testleri koşar → yama önerisi kaydedilir.
 * Cevap koşu başlar başlamaz döner (`doctor.run.ok {runId}`); koşunun kendisi NORMAL agent
 * olaylarıyla izlenir, yama hazır olunca `doctor.patch.proposed` yayınlanır.
 */
export const DoctorRunPayloadSchema = z.object({ errorCode: z.string().min(1) }).strip();

/** Yama önerileri (ADR-018 Karar 3, Dilim D3) — `diff` taşınmaz (büyük olabilir). */
export const PatchesListPayloadSchema = z.object({}).strip();

/**
 * Bir yamanın durumunu değiştirir. **Uygulamanın KENDİSİ burada DEĞİL** — merge/build/test/
 * restart/geri-alma zinciri CLI'nin `symphony patch apply` komutundadır (ADR-018 Karar 3:
 * "restart'ı daemon'ın içinden yönetmek kendi bacağını kesmektir"). Daemon yalnız SONUCU yazar.
 */
export const PatchResolvePayloadSchema = z
  .object({ patchId: z.string().uuid(), state: PatchStateSchema })
  .strip();

export const REQUEST_PAYLOAD_SCHEMAS = {
  hello: HelloPayloadSchema,
  "state.sync": StateSyncPayloadSchema,
  "chat.start": ChatStartPayloadSchema,
  "chat.cancel": ChatCancelPayloadSchema,
  "agent.start": AgentStartPayloadSchema,
  "agent.cancel": AgentCancelPayloadSchema,
  "agent.say": AgentSayPayloadSchema,
  "permission.respond": PermissionRespondPayloadSchema,
  "models.list": ModelsListPayloadSchema,
  "agents.list": AgentsListPayloadSchema,
  "providers.status": ProvidersStatusPayloadSchema,
  "router.suggest": RouterSuggestPayloadSchema,
  "usage.query": UsageQueryPayloadSchema,
  "mcp.addServer": McpAddServerPayloadSchema,
  "feedback.submit": FeedbackSubmitPayloadSchema,
  "doctor.diagnose": DoctorDiagnosePayloadSchema,
  "doctor.run": DoctorRunPayloadSchema,
  "patches.list": PatchesListPayloadSchema,
  "patch.resolve": PatchResolvePayloadSchema,
} as const;

export type RequestType = keyof typeof REQUEST_PAYLOAD_SCHEMAS;
export type RequestPayload<T extends RequestType> = z.infer<(typeof REQUEST_PAYLOAD_SCHEMAS)[T]>;
