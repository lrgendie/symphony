import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import type { AgentSummary } from "@symphony/shared";
import { AgentError } from "./errors.js";
import { TOOL_NAMES } from "./tools.js";

/**
 * Agent tanımları (SPEC-AGENT.md §1): `~/.symphony/agents/<ad>.md` —
 * YAML-altkümesi frontmatter + serbest metin sistem prompt'u. Bilinçli olarak
 * tam YAML ayrıştırıcı YOK: desteklenen değerler skaler (metin/sayı/bool) ve
 * düz dizi `[a, b]` — şartnamedeki alanlara yetiyor, bağımlılık eklemiyor.
 */

export const AgentFrontmatterSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(""),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    // ADR-008: varsayılan 0; yükseltmek agent tanımında bilinçli istisnadır.
    temperature: z.number().min(0).max(2).default(0),
    tools: z.array(z.enum(TOOL_NAMES)).min(1).default([...TOOL_NAMES]),
    // MCP istemcisi (ADR-007, SPEC §2): ~/.symphony/mcp-servers.json'daki hangi
    // sunucuların araçları bu agent'a bağlanacak; boşsa hiçbiri.
    mcpServers: z.array(z.string().min(1)).default([]),
    // Döngü sigortası (SPEC §4).
    maxSteps: z.number().int().positive().max(500).default(50),
  })
  .strip();

export interface AgentDefinition extends z.infer<typeof AgentFrontmatterSchema> {
  /** Dosya adı (uzantısız) — `agent.start.agentId` bununla eşleşir. */
  id: string;
  systemPrompt: string;
}

export function parseAgentMarkdown(id: string, raw: string): AgentDefinition {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (match === null) {
    throw new AgentError("AGENT_DEFINITION_INVALID", `${id}: frontmatter (---) bulunamadı`);
  }
  const meta: Record<string, unknown> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) {
      throw new AgentError("AGENT_DEFINITION_INVALID", `${id}: geçersiz satır: ${trimmed}`);
    }
    meta[trimmed.slice(0, colon).trim()] = parseScalar(trimmed.slice(colon + 1).trim());
  }
  const parsed = AgentFrontmatterSchema.safeParse(meta);
  if (!parsed.success) {
    throw new AgentError(
      "AGENT_DEFINITION_INVALID",
      `${id}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return { ...parsed.data, id, systemPrompt: (match[2] ?? "").trim() };
}

function parseScalar(value: string): unknown {
  // Satır sonu yorumu: `0  # açıklama` → `0`
  const hash = value.indexOf(" #");
  const bare = (hash === -1 ? value : value.slice(0, hash)).trim();
  if (bare.startsWith("[") && bare.endsWith("]")) {
    return bare
      .slice(1, -1)
      .split(",")
      .map((item) => stripQuotes(item.trim()))
      .filter((item) => item !== "");
  }
  if (/^-?\d+(\.\d+)?$/.test(bare)) return Number(bare);
  if (bare === "true") return true;
  if (bare === "false") return false;
  return stripQuotes(bare);
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadAgentDefinition(agentsDir: string, agentId: string): AgentDefinition {
  const file = join(agentsDir, `${agentId}.md`);
  if (!existsSync(file)) {
    throw new AgentError(
      "AGENT_UNKNOWN",
      `Agent tanımı yok: ${agentId} (beklenen dosya: ${file})`,
    );
  }
  return parseAgentMarkdown(agentId, readFileSync(file, "utf8"));
}

/** Bozuk tanım listeyi düşürmez; atlanır (yüklerken hatası zaten agent.start'ta görülür). */
export function listAgentDefinitions(agentsDir: string): AgentDefinition[] {
  if (!existsSync(agentsDir)) return [];
  const definitions: AgentDefinition[] = [];
  for (const entry of readdirSync(agentsDir)) {
    if (!entry.endsWith(".md")) continue;
    try {
      definitions.push(
        parseAgentMarkdown(basename(entry, ".md"), readFileSync(join(agentsDir, entry), "utf8")),
      );
    } catch {
      continue;
    }
  }
  return definitions.sort((a, b) => a.id.localeCompare(b.id));
}

export function toAgentSummary(definition: AgentDefinition): AgentSummary {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    ...(definition.provider !== undefined ? { provider: definition.provider } : {}),
    ...(definition.model !== undefined ? { model: definition.model } : {}),
    tools: [...definition.tools],
    mcpServers: [...definition.mcpServers],
    maxSteps: definition.maxSteps,
  };
}

const DEFAULT_CODER_DEFINITION = `---
name: coder
description: Kod yazan/düzenleyen genel agent
# model/provider boş → istekte verilmezse router seçer
temperature: 0
tools: [read_file, write_file, edit, glob, grep, run_command]
maxSteps: 50
---
Sen Symphony'nin kod agent'ısın. Görevini çalışma dizinindeki dosyaları okuyarak,
düzenleyerek ve komut çalıştırarak yerine getirirsin.

Kurallar:
- Önce oku, sonra değiştir: bir dosyayı düzenlemeden önce read_file ile mevcut hâlini gör.
- Küçük ve hedefli değişiklikler yap; istenmeyen yeniden biçimlendirme yapma.
- Bir araç hata döndürürse nedenini düşün ve yaklaşımını değiştir; aynı çağrıyı
  körlemesine yineleme.
- İş bittiğinde son cevabını araç çağrısı OLMADAN, yaptıklarının kısa özeti olarak yaz.
`;

/** Daemon açılışında bir kez: hiç tanım yoksa varsayılan coder yazılır (agent DEĞİL, daemon yazar). */
export function ensureDefaultAgent(agentsDir: string): void {
  const file = join(agentsDir, "coder.md");
  if (existsSync(file)) return;
  writeFileSync(file, DEFAULT_CODER_DEFINITION, "utf8");
}
