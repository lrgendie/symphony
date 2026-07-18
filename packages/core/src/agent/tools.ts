import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { glob as tinyGlob } from "tinyglobby";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import type { FlexibleSchema } from "ai";
import type { RiskClass } from "@lrgendie/shared";
import { AgentError } from "./errors.js";
import type { WorkspaceJail } from "./jail.js";

/**
 * Agent araç seti (SPEC-AGENT.md §2). Her aracın argümanları zod ile doğrulanır
 * (AI SDK aynı şemayı sağlayıcıya JSON Schema olarak da verir), her yol jail'den
 * geçer, her mutasyon izin kapısının (engine) arkasındadır — araçların kendisi
 * izin BİLMEZ; tek kapı ilkesi engine'de korunur (SPEC §8.1).
 */

export const TOOL_NAMES = [
  "read_file",
  "write_file",
  "edit",
  "glob",
  "grep",
  "run_command",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Zaman aşımı (SPEC §4): run_command 120 sn, diğerleri 30 sn. */
export const RUN_COMMAND_TIMEOUT_MS = 120_000;
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

const MAX_FILE_CHARS = 128_000;
const MAX_OUTPUT_CHARS = 16_000;
const MAX_MATCHES = 200;
const MAX_GREP_FILE_BYTES = 1_000_000;
const IGNORE_GLOBS = ["**/node_modules/**", "**/.git/**"];

export interface ToolContext {
  jail: WorkspaceJail;
}

/** write/edit izin isteğine eklenen önizleme (SPEC §6): diff + bayatlık denetim hash'i. */
export interface ToolPreview {
  diff: string;
  baseHash: string;
}

export interface AgentToolSpec {
  /** Yerleşik araçlarda ToolName; MCP araçlarında `mcp__<sunucu>__<araç>` (SPEC-AGENT §2). */
  name: string;
  description: string;
  /** Yerleşik araçlarda zod; MCP araçlarında `jsonSchema()` sarmalı (agent/mcp.ts). */
  inputSchema: FlexibleSchema<unknown>;
  timeoutMs: number;
  riskClass(args: unknown): RiskClass;
  /** İzin deseni hedefi: dosya araçlarında workspace-göreli posix yol, komutta komut metni. */
  permissionTarget(args: unknown, ctx: ToolContext): string;
  argsSummary(args: unknown): string;
  preview?(args: unknown, ctx: ToolContext): ToolPreview;
  execute(args: unknown, ctx: ToolContext, signal: AbortSignal): Promise<string>;
}

// ---- Sır maskeleme (SPEC §8.3): özet/log'a anahtar deseni sızmaz ----

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g, // Anthropic/OpenAI
  /AIza[0-9A-Za-z_-]{10,}/g, // Google
  /gh[pousr]_[A-Za-z0-9]{16,}/g, // GitHub
];

export function maskSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((masked, pattern) => masked.replace(pattern, "***"), text);
}

// ---- Yardımcılar ----

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [kırpıldı: toplam ${text.length} karakter]`;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Dosyanın istek anındaki durumu; yeni dosya için ayrık bir hash üretilir. */
export function fileBaseHash(absolute: string): string {
  return existsSync(absolute) ? hashContent(readFileSync(absolute, "utf8")) : "YENI-DOSYA";
}

// ---- read_file ----

const ReadFileArgs = z
  .object({ path: z.string().min(1).describe("Okunacak dosya (cwd'ye göreli veya mutlak)") })
  .strip();

const readFileTool: AgentToolSpec = {
  name: "read_file",
  description: "Bir metin dosyasının içeriğini okur.",
  inputSchema: ReadFileArgs,
  timeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
  riskClass: () => "safe",
  permissionTarget: (args, ctx) => relTarget(ReadFileArgs.parse(args).path, ctx),
  argsSummary: (args) => `read_file ${ReadFileArgs.parse(args).path}`,
  // async: sync fırlatma yerine reddedilen Promise — arayüz sözleşmesi bu.
  execute: async (args, ctx) => {
    const { path: requested } = ReadFileArgs.parse(args);
    const absolute = ctx.jail.resolve(requested);
    if (!existsSync(absolute)) {
      throw new AgentError("AGENT_FILE_NOT_FOUND", `Dosya yok: ${requested}`);
    }
    return truncate(readFileSync(absolute, "utf8"), MAX_FILE_CHARS);
  },
};

// ---- write_file ----

const WriteFileArgs = z
  .object({
    path: z.string().min(1).describe("Yazılacak dosya (yoksa oluşturulur)"),
    content: z.string().describe("Dosyanın YENİ tam içeriği"),
  })
  .strip();

const writeFileTool: AgentToolSpec = {
  name: "write_file",
  description: "Bir dosyayı tümüyle yazar (yoksa oluşturur). Kısmi değişiklik için edit kullan.",
  inputSchema: WriteFileArgs,
  timeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
  riskClass: () => "mutating",
  permissionTarget: (args, ctx) => relTarget(WriteFileArgs.parse(args).path, ctx),
  argsSummary: (args) => {
    const { path: p, content } = WriteFileArgs.parse(args);
    return `write_file ${p} (${content.length} karakter)`;
  },
  preview: (args, ctx) => {
    const { path: requested, content } = WriteFileArgs.parse(args);
    const absolute = ctx.jail.resolve(requested);
    const rel = ctx.jail.relative(absolute);
    const before = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
    return {
      diff: createTwoFilesPatch(rel, rel, before, content, "önce", "sonra"),
      baseHash: fileBaseHash(absolute),
    };
  },
  execute: async (args, ctx) => {
    const { path: requested, content } = WriteFileArgs.parse(args);
    const absolute = ctx.jail.resolve(requested);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
    return `Yazıldı: ${ctx.jail.relative(absolute)} (${content.length} karakter)`;
  },
};

// ---- edit ----

const EditArgs = z
  .object({
    path: z.string().min(1).describe("Düzenlenecek dosya"),
    oldText: z.string().min(1).describe("Dosyada birebir aranacak metin"),
    newText: z.string().describe("Yerine yazılacak metin"),
    replaceAll: z.boolean().default(false).describe("true → tüm eşleşmeler değiştirilir"),
  })
  .strip();

function applyEdit(args: z.infer<typeof EditArgs>, ctx: ToolContext): {
  absolute: string;
  next: string;
  count: number;
} {
  const absolute = ctx.jail.resolve(args.path);
  if (!existsSync(absolute)) {
    throw new AgentError("AGENT_FILE_NOT_FOUND", `Dosya yok: ${args.path}`);
  }
  const before = readFileSync(absolute, "utf8");
  const count = before.split(args.oldText).length - 1;
  if (count === 0) {
    throw new AgentError("VALIDATION_EDIT_NOT_FOUND", "oldText dosyada bulunamadı");
  }
  if (count > 1 && !args.replaceAll) {
    throw new AgentError(
      "VALIDATION_EDIT_AMBIGUOUS",
      `oldText ${count} kez geçiyor; benzersizleştir ya da replaceAll: true ver`,
    );
  }
  const next = args.replaceAll
    ? before.replaceAll(args.oldText, args.newText)
    : before.replace(args.oldText, args.newText);
  return { absolute, next, count };
}

const editTool: AgentToolSpec = {
  name: "edit",
  description: "Dosyada birebir metin değiştirir (oldText → newText).",
  inputSchema: EditArgs,
  timeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
  riskClass: () => "mutating",
  permissionTarget: (args, ctx) => relTarget(EditArgs.parse(args).path, ctx),
  argsSummary: (args) => {
    const parsed = EditArgs.parse(args);
    return `edit ${parsed.path} (${parsed.oldText.length}→${parsed.newText.length} karakter)`;
  },
  preview: (args, ctx) => {
    const parsed = EditArgs.parse(args);
    const { absolute, next } = applyEdit(parsed, ctx);
    const rel = ctx.jail.relative(absolute);
    const before = readFileSync(absolute, "utf8");
    return {
      diff: createTwoFilesPatch(rel, rel, before, next, "önce", "sonra"),
      baseHash: fileBaseHash(absolute),
    };
  },
  execute: async (args, ctx) => {
    const parsed = EditArgs.parse(args);
    const { absolute, next, count } = applyEdit(parsed, ctx);
    writeFileSync(absolute, next, "utf8");
    return `Düzenlendi: ${ctx.jail.relative(absolute)} (${parsed.replaceAll ? count : 1} değişiklik)`;
  },
};

// ---- glob ----

const GlobArgs = z
  .object({
    pattern: z.string().min(1).describe("Glob deseni, ör. src/**/*.ts"),
    path: z.string().optional().describe("Arama kökü (varsayılan: cwd)"),
  })
  .strip();

const globTool: AgentToolSpec = {
  name: "glob",
  description: "Desene uyan dosya/dizinleri listeler (node_modules/.git hariç).",
  inputSchema: GlobArgs,
  timeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
  riskClass: () => "safe",
  permissionTarget: (args, ctx) => relTarget(GlobArgs.parse(args).path ?? ".", ctx),
  argsSummary: (args) => `glob ${GlobArgs.parse(args).pattern}`,
  execute: async (args, ctx) => {
    const parsed = GlobArgs.parse(args);
    const base = ctx.jail.resolve(parsed.path ?? ".");
    const entries = await tinyGlob(parsed.pattern, {
      cwd: base,
      ignore: IGNORE_GLOBS,
      onlyFiles: false,
    });
    if (entries.length === 0) return "Eşleşme yok.";
    const shown = entries.sort().slice(0, MAX_MATCHES);
    const suffix =
      entries.length > shown.length ? `\n… [+${entries.length - shown.length} eşleşme daha]` : "";
    return shown.join("\n") + suffix;
  },
};

// ---- grep ----

const GrepArgs = z
  .object({
    pattern: z.string().min(1).describe("JavaScript düzenli ifadesi"),
    path: z.string().optional().describe("Arama kökü (varsayılan: cwd)"),
    glob: z.string().optional().describe("Dosya süzgeci, ör. **/*.ts"),
    ignoreCase: z.boolean().default(false),
  })
  .strip();

const grepTool: AgentToolSpec = {
  name: "grep",
  description: "Dosya içeriklerinde düzenli ifadeyle satır arar.",
  inputSchema: GrepArgs,
  timeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
  riskClass: () => "safe",
  permissionTarget: (args, ctx) => relTarget(GrepArgs.parse(args).path ?? ".", ctx),
  argsSummary: (args) => `grep /${GrepArgs.parse(args).pattern}/`,
  execute: async (args, ctx, signal) => {
    const parsed = GrepArgs.parse(args);
    let regex: RegExp;
    try {
      regex = new RegExp(parsed.pattern, parsed.ignoreCase ? "i" : "");
    } catch (error) {
      throw new AgentError(
        "VALIDATION_TOOL_ARGS",
        `Geçersiz düzenli ifade: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const base = ctx.jail.resolve(parsed.path ?? ".");
    const files = await tinyGlob(parsed.glob ?? "**/*", {
      cwd: base,
      ignore: IGNORE_GLOBS,
      onlyFiles: true,
    });
    const matches: string[] = [];
    for (const file of files.sort()) {
      if (signal.aborted || matches.length >= MAX_MATCHES) break;
      const absolute = path.join(base, file);
      try {
        if (statSync(absolute).size > MAX_GREP_FILE_BYTES) continue;
        const lines = readFileSync(absolute, "utf8").split(/\r?\n/);
        for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
          const line = lines[i] ?? "";
          if (regex.test(line)) matches.push(`${file}:${i + 1}: ${line.trim().slice(0, 300)}`);
        }
      } catch {
        continue; // okunamayan dosya (kilitli/ikili) aramayı durdurmaz
      }
    }
    if (matches.length === 0) return "Eşleşme yok.";
    const suffix = matches.length >= MAX_MATCHES ? `\n… [ilk ${MAX_MATCHES} eşleşme]` : "";
    return matches.join("\n") + suffix;
  },
};

// ---- run_command ----

const RunCommandArgs = z
  .object({
    command: z.string().min(1).describe("Çalıştırılacak kabuk komutu"),
    cwd: z.string().optional().describe("Çalışma dizini (varsayılan: workspace kökü)"),
  })
  .strip();

/**
 * Yıkıcı komut sezgiseli (SPEC §2): dosya silme, git push, yayınlama, ağ yazması.
 * `destructive` → izin istenir ve always_allow SUNULMAZ; sezgisel yanlış-pozitifi
 * kullanıcı tek seferlik onayla aşar — güvenli taraf budur.
 */
const DESTRUCTIVE_COMMAND_PATTERNS: readonly RegExp[] = [
  /(^|[\s;&|])(rm|rmdir|rd|del|erase)($|[\s;&|])/i,
  /remove-item/i,
  /\bgit\s+push\b/i,
  /\b(npm|pnpm|yarn)\s+publish\b/i,
  /\bcurl\b.*(-X\s*(POST|PUT|DELETE|PATCH)|--data|\s-d\s|--upload-file)/i,
  /invoke-(webrequest|restmethod).*-method\s*(post|put|delete|patch)/i,
  /\bwget\b.*--(post-data|post-file)/i,
  // (?!-): "format"/"mkfs" disk biçimlendirme komutlarını yakalar (format C:, mkfs.ext4);
  // PowerShell'in zararsız Format-Table/Format-List/Format-Wide gibi görüntüleme
  // cmdlet'lerini (her zaman tireyle devam eder) YANLIŞ POZİTİF olarak işaretlemez.
  /\b(format|mkfs)\b(?!-)/i,
];

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

/** SPEC §8.4: anahtar taşıyan ortam değişkenleri alt sürece geçmez. */
export function sanitizedEnv(): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/KEY|TOKEN|SECRET|PASSW|CREDENTIAL/i.test(key)) continue;
    clean[key] = value;
  }
  return clean;
}

const runCommandTool: AgentToolSpec = {
  name: "run_command",
  description:
    "Kabuk komutu çalıştırır (Windows: PowerShell, diğer: bash) ve çıktıyı döndürür.",
  inputSchema: RunCommandArgs,
  timeoutMs: RUN_COMMAND_TIMEOUT_MS,
  riskClass: (args) =>
    isDestructiveCommand(RunCommandArgs.parse(args).command) ? "destructive" : "mutating",
  permissionTarget: (args) => RunCommandArgs.parse(args).command,
  argsSummary: (args) => `run_command ${truncate(RunCommandArgs.parse(args).command, 200)}`,
  execute: async (args, ctx, signal) => {
    const parsed = RunCommandArgs.parse(args);
    const workdir = ctx.jail.resolve(parsed.cwd ?? ".");
    const isWindows = process.platform === "win32";
    const result = await execa(
      isWindows ? "powershell.exe" : "bash",
      isWindows
        ? ["-NoProfile", "-NonInteractive", "-Command", parsed.command]
        : ["-c", parsed.command],
      {
        cwd: workdir,
        env: sanitizedEnv(),
        extendEnv: false,
        cancelSignal: signal,
        timeout: RUN_COMMAND_TIMEOUT_MS,
        // SPEC §4 iptal sözleşmesi: SIGTERM → 5 sn → SIGKILL
        forceKillAfterDelay: 5_000,
        reject: false,
        all: true,
        windowsHide: true,
        maxBuffer: 8_000_000,
      },
    );
    if (result.timedOut) {
      throw new AgentError(
        "AGENT_TOOL_TIMEOUT",
        `Komut ${RUN_COMMAND_TIMEOUT_MS / 1000} sn içinde bitmedi ve öldürüldü`,
      );
    }
    if (result.isCanceled) {
      throw new AgentError("AGENT_CANCELLED", "Komut iptal edildi");
    }
    const output = truncate(result.all ?? "", MAX_OUTPUT_CHARS);
    return `çıkış kodu: ${result.exitCode ?? "?"}\n${output}`;
  },
};

// ---- Kayıt ----

export const AGENT_TOOLS: Readonly<Record<ToolName, AgentToolSpec>> = {
  read_file: readFileTool,
  write_file: writeFileTool,
  edit: editTool,
  glob: globTool,
  grep: grepTool,
  run_command: runCommandTool,
};

function relTarget(requested: string, ctx: ToolContext): string {
  return ctx.jail.relative(ctx.jail.resolve(requested));
}
