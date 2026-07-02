import { z } from "zod";
import { ChatMessageSchema } from "./common.js";

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
  })
  .strip();

export const AgentCancelPayloadSchema = z.object({ runId: z.string().uuid() }).strip();

export const PermissionRespondPayloadSchema = z
  .object({
    requestId: z.string().uuid(),
    decision: z.enum(["allow", "deny", "always_allow"]),
  })
  .strip();

export const ModelsListPayloadSchema = z.object({}).strip();

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

export const UsageQueryPayloadSchema = z
  .object({
    from: z.number().int().nonnegative().optional(),
    to: z.number().int().nonnegative().optional(),
    groupBy: z.enum(["provider", "model", "day"]).optional(),
  })
  .strip();

export const REQUEST_PAYLOAD_SCHEMAS = {
  hello: HelloPayloadSchema,
  "state.sync": StateSyncPayloadSchema,
  "chat.start": ChatStartPayloadSchema,
  "chat.cancel": ChatCancelPayloadSchema,
  "agent.start": AgentStartPayloadSchema,
  "agent.cancel": AgentCancelPayloadSchema,
  "permission.respond": PermissionRespondPayloadSchema,
  "models.list": ModelsListPayloadSchema,
  "providers.status": ProvidersStatusPayloadSchema,
  "router.suggest": RouterSuggestPayloadSchema,
  "usage.query": UsageQueryPayloadSchema,
} as const;

export type RequestType = keyof typeof REQUEST_PAYLOAD_SCHEMAS;
export type RequestPayload<T extends RequestType> = z.infer<(typeof REQUEST_PAYLOAD_SCHEMAS)[T]>;
