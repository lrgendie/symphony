import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { jsonSchema, type JSONSchema7 } from "ai";
import { z } from "zod";
import { AgentError } from "./errors.js";
import { DEFAULT_TOOL_TIMEOUT_MS, type AgentToolSpec } from "./tools.js";

/**
 * MCP istemcisi (ADR-007, SPEC-AGENT §2). Harici MCP sunucuları `~/.symphony/mcp-servers.json`
 * kayıt defterinde tanımlanır (stdio taşıma — v1 kapsamı); agent frontmatter'ındaki
 * `mcpServers: [ad, ...]` bunlardan hangilerine bağlanacağını seçer. Her sunucunun
 * her aracı `mcp__<sunucu>__<araç>` adıyla `AgentToolSpec`'e sarılır ve `mutating`
 * risk sınıfıyla başlar (kullanıcı `permissions.json`'da araca özel indirim yapabilir).
 */

export const McpServerConfigSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).optional(),
  })
  .strip();
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

const McpServersFileSchema = z
  .object({ servers: z.record(McpServerConfigSchema).default({}) })
  .strip();

/** Kayıt defterini her seferinde taze okur (kullanıcı/`symphony add` elle güncelleyebilir). */
export function loadMcpServerConfigs(file: string): Record<string, McpServerConfig> {
  if (!existsSync(file)) return {};
  const parsed = McpServersFileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  return parsed.servers;
}

interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface McpCallResult {
  content?: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** `Client.callTool`'un dar kesiti — testte gerçek SDK istemcisi kurmadan sahtelenebilir. */
export type McpCallToolFn = (
  params: { name: string; arguments: Record<string, unknown> },
  signal: AbortSignal,
) => Promise<McpCallResult>;

export interface McpConnection {
  serverName: string;
  tools: AgentToolSpec[];
  close(): Promise<void>;
}

/** MCP `content` parçalarından okunabilir metin çıkarır (metin dışı türler atlanır). */
function extractText(result: McpCallResult): string {
  const text = (result.content ?? [])
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
  if (text !== "") return text;
  if (result.structuredContent !== undefined) return JSON.stringify(result.structuredContent);
  return "(içerik yok)";
}

function summarizeArgs(args: unknown): string {
  const json = JSON.stringify(args) ?? "{}";
  return json.length > 200 ? `${json.slice(0, 200)}…` : json;
}

/** Tek bir MCP aracını `AgentToolSpec`'e sarar — çalıştırma dışındaki her şey diğer araçlarla aynıdır. */
export function wrapMcpTool(
  serverName: string,
  descriptor: McpToolDescriptor,
  callTool: McpCallToolFn,
): AgentToolSpec {
  const qualifiedName = `mcp__${serverName}__${descriptor.name}`;
  return {
    name: qualifiedName,
    description: descriptor.description ?? `MCP aracı (${serverName}): ${descriptor.name}`,
    inputSchema: jsonSchema(descriptor.inputSchema as JSONSchema7),
    timeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
    // SPEC-AGENT §2: MCP araçları mutating sınıfında başlar; sunucunun kendi
    // readOnlyHint'i bilinçli olarak yok sayılır — güvenli taraf budur.
    riskClass: () => "mutating",
    permissionTarget: (args) => summarizeArgs(args),
    argsSummary: (args) => `${qualifiedName} ${summarizeArgs(args)}`,
    execute: async (args, _ctx, signal) => {
      const result = await callTool(
        { name: descriptor.name, arguments: (args as Record<string, unknown>) ?? {} },
        signal,
      );
      if (result.isError === true) {
        throw new AgentError("AGENT_MCP_TOOL_ERROR", extractText(result));
      }
      return extractText(result);
    },
  };
}

export async function connectOne(
  serverName: string,
  config: McpServerConfig,
): Promise<McpConnection> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    ...(config.env !== undefined ? { env: config.env } : {}),
  });
  const client = new Client({ name: "symphony", version: "0.1.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const callTool: McpCallToolFn = async (params, signal) => {
      const raw = await client.callTool(
        { name: params.name, arguments: params.arguments },
        undefined,
        { signal },
      );
      // Eski sunucular `toolResult` biçiminde dönebilir (CompatibilityCallToolResultSchema);
      // istemeden hiç istemiyoruz ama tip union'ı yine de kapsıyor — normalize ederiz.
      return "toolResult" in raw
        ? { structuredContent: { toolResult: raw.toolResult } }
        : { content: raw.content, structuredContent: raw.structuredContent, isError: raw.isError };
    };
    return {
      serverName,
      tools: tools.map((descriptor) => wrapMcpTool(serverName, descriptor, callTool)),
      close: () => client.close(),
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw new AgentError(
      "AGENT_MCP_CONNECT_FAILED",
      `MCP sunucusuna bağlanılamadı (${serverName}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Bir koşu için gereken tüm MCP sunucularına bağlanır (SPEC-AGENT §4: koşu başında).
 * Herhangi biri başarısız olursa o ana dek açılan bağlantılar kapatılır ve hata fırlatılır —
 * agent'ın yarım bir araç setiyle çalışması istenmiyor.
 */
export async function connectMcpServers(
  serversFile: string,
  serverNames: readonly string[],
): Promise<McpConnection[]> {
  if (serverNames.length === 0) return [];
  const configs = loadMcpServerConfigs(serversFile);
  const connections: McpConnection[] = [];
  try {
    for (const name of serverNames) {
      const config = configs[name];
      if (config === undefined) {
        throw new AgentError(
          "AGENT_MCP_SERVER_UNKNOWN",
          `Tanımsız MCP sunucusu: ${name} (${serversFile} içinde yok)`,
        );
      }
      connections.push(await connectOne(name, config));
    }
    return connections;
  } catch (error) {
    await closeMcpConnections(connections);
    throw error;
  }
}

export async function closeMcpConnections(connections: readonly McpConnection[]): Promise<void> {
  await Promise.allSettled(connections.map((connection) => connection.close()));
}

/**
 * Eklenti sistemi (ROADMAP Faz 3, SPEC-AGENT §2.1, `symphony add`): sunucuya CANLI bağlanıp
 * doğrular (yanlış paket adı/bozuk komut hemen görülür), sonra kayıt defterine yazar.
 * Bağlantı başarısız olursa dosyaya HİÇ dokunulmaz — kayıt defteri yarım/bozuk girdi almaz.
 */
export async function registerMcpServer(
  serversFile: string,
  name: string,
  config: McpServerConfig,
): Promise<string[]> {
  const connection = await connectOne(name, config);
  // Kullanıcıya sunucunun HAM araç adları gösterilir — `mcp__<sunucu>__` öneki bir agent
  // koşusu içindeki namespace çakışmasını önlemek için var, kayıt sonucunda anlamsız.
  const prefix = `mcp__${name}__`;
  const toolNames = connection.tools.map((toolSpec) => toolSpec.name.slice(prefix.length));
  await connection.close();

  const existing = loadMcpServerConfigs(serversFile);
  const next = { ...existing, [name]: config };
  writeFileSync(serversFile, `${JSON.stringify({ servers: next }, null, 2)}\n`, "utf8");
  return toolNames;
}
