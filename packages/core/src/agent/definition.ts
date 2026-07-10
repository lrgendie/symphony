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

/**
 * Frontmatter `tools:` listesi statik araçların (TOOL_NAMES) ÜSTÜNE `run_agent`'ı da kabul eder
 * (Faz 5, ADR-014). `run_agent` DİNAMİK bir motor aracıdır — `AGENT_TOOLS`'ta YOK, `engine.ts`
 * koşu başına üretir; yalnız bunu listeleyen agent devredebilir, TEK katman derinliğinde (çocuk
 * koşuya asla verilmez — bu kontrol engine.ts'te, tanım seviyesinde değil).
 */
export const AGENT_FRONTMATTER_TOOL_NAMES = [...TOOL_NAMES, "run_agent"] as const;
export type AgentFrontmatterToolName = (typeof AGENT_FRONTMATTER_TOOL_NAMES)[number];

export const AgentFrontmatterSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(""),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    // ADR-008: varsayılan 0; yükseltmek agent tanımında bilinçli istisnadır.
    temperature: z.number().min(0).max(2).default(0),
    // Varsayılan run_agent İÇERMEZ (default: [...TOOL_NAMES]) — devretme bilinçli opt-in'dir.
    tools: z.array(z.enum(AGENT_FRONTMATTER_TOOL_NAMES)).min(1).default([...TOOL_NAMES]),
    // MCP istemcisi (ADR-007, SPEC §2): ~/.symphony/mcp-servers.json'daki hangi
    // sunucuların araçları bu agent'a bağlanacak; boşsa hiçbiri.
    mcpServers: z.array(z.string().min(1)).default([]),
    // Döngü sigortası (SPEC §4).
    maxSteps: z.number().int().positive().max(500).default(50),
    /**
     * Kaçak üretim sigortası (SPEC §4): tek model turunun üretebileceği en fazla token.
     * Verilmezse `config.limits.maxOutputTokens` geçerlidir — bu yüzden `.optional()`,
     * `.default()` DEĞİL (varsayılan burada değil, config'te tek yerde durur).
     */
    maxOutputTokens: z.number().int().positive().max(200_000).optional(),
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

// Birleşik TUI (ADR-012, Dilim 2.3): araçlı personaların arasına salt-OKUR bir "asistan"
// eklenir. read_file/glob/grep hepsi `safe` risk sınıfında → izin kutusu ÇIKMAZ; asistan
// sohbet ederken dosyalara bakabilir ama hiçbir şeyi değiştiremez/çalıştıramaz (yazma/komut
// için coder). Böylece kullanıcı, izin sürtünmesi olmadan "dosyalarını gören" bir sohbet alır.
const DEFAULT_ASISTAN_DEFINITION = `---
name: asistan
description: Genel sohbet asistanı — dosyalarını okuyabilir, ama değiştiremez/çalıştıramaz
# model/provider boş → istekte verilmezse router seçer
temperature: 0
tools: [read_file, glob, grep]
maxSteps: 50
---
Sen Symphony'nin genel yardımcı asistanısın. Kullanıcıyla Türkçe, açık ve öz konuşursun.
Gerektiğinde çalışma dizinindeki dosyaları OKUYABİLİR (read_file), bulabilir (glob) ve
içinde arayabilirsin (grep); yanıtını bulduğun içeriğe dayandırırsın. Hiçbir şeyi
DEĞİŞTİREMEZSİN ve komut çalıştıramazsın — bunlara ihtiyaç varsa kullanıcıya "coder"
agent'ını öner.

Kurallar:
- Soruyu dosyalara bakmadan yanıtlayabiliyorsan gereksiz yere araç çağırma.
- Bir dosyanın içeriğine ihtiyacın varsa önce glob/grep ile yerini bul, sonra read_file ile oku.
- Bilmediğini uydurma; emin değilsen açıkça söyle.
`;

// Arşiv damıtma (ADR-013 Karar 5, Dilim M3): `symphony memory distill` bu agent'ı çalıştırır.
// Salt-okur (asistan ile AYNI araç seti) — profil dosyasına YAZAMAZ, yalnız TASLAK üretir;
// canlı profile alma kararı her zaman kullanıcının (CLI, agent.run.completed.result'ı
// profil.taslak.md'ye yazar, profil.md'ye hiç dokunmaz).
const DEFAULT_DAMITICI_DEFINITION = `---
name: damıtıcı
description: Arşiv dizinini okuyup kullanıcı profili TASLAĞI üretir (salt-okur, canlı profile yazamaz)
# model/provider boş → symphony memory distill yerel model şartını KENDİSİ pinler
temperature: 0
tools: [read_file, glob, grep]
maxSteps: 50
---
Sen Symphony'nin arşiv damıtma agent'ısın. Görevin, sana verilen bir arşiv dizinindeki
konuşma dökümlerini okuyup KALICI bir kullanıcı profili TASLAĞI üretmektir.

Kurallar:
- Yalnız OKU (read_file/glob/grep) — hiçbir dosyayı değiştiremezsin, ihtiyacın da yok.
- Görev metninde sana dosyaların okuma SIRASI verilecek (en yeniden en eskiye); bu sırayı
  izle. Görevde verilen karakter bütçesi dolunca durabilirsin — dizindeki HER dosyayı
  okumak ZORUNDA değilsin.
- Yalnız TEKRAR EDEN, KALICI gerçekleri damıt: kullanıcının kimliği, üslup/dil tercihleri,
  teknik tercihleri, projeleri, kalıcı düzeltme/öğrenimleri. Tek seferlik/geçici detayları
  (o günkü hata mesajı, o anki görev vb.) YAZMA. Dökümdeki her ifadeye güvenme — yalnız
  KULLANICIYA ait, tutarlı şekilde tekrar eden bilgileri damıt (asistan/agent cevapları
  kullanıcının gerçeği DEĞİLDİR).
- Çıktını TAM olarak şu başlıklarla, bu sırayla yaz:
  ## Kimlik
  ## Üslup ve dil tercihleri
  ## Teknik tercihler
  ## Projeler
  ## Düzeltmeler ve öğrenimler
- Görev metninde verilen karakter bütçesini AŞMA.
- Son cevabını araç çağrısı OLMADAN, doğrudan damıtılmış profil metni olarak yaz — başka
  açıklama/giriş cümlesi ekleme.
`;

// Çoklu agent orkestrasyonu (Faz 5, ADR-014 Karar 6): "sef" görevi alt görevlere bölüp
// `run_agent` ile uygun agent'lara dağıtır. Yazma/komut araçları BİLİNÇLİ OLARAK yok —
// orkestra şefi enstrüman çalmaz, yazma gerektiren her şeyi coder'a devretmek ZORUNDADIR.
const DEFAULT_SEF_DEFINITION = `---
name: sef
description: Görevi alt görevlere bölüp uygun agent'lara ve modellere dağıtan orkestra şefi
# model/provider boş → istekte verilmezse router seçer
temperature: 0
tools: [read_file, glob, grep, run_agent]
maxSteps: 50
---
Sen Symphony'nin orkestra şefisin. Görevin, sana verilen görevi anlamlı alt görevlere bölüp
her birini \`run_agent\` aracıyla uygun bir agent'a devretmektir — dosya YAZMA/komut ÇALIŞTIRMA
araçların YOK (bilinçli olarak); yazma/komut gerektiren her alt görevi "coder"a, salt-okuma/
analiz gerektiren alt görevleri "asistan"a devret.

Kurallar:
- Göreve gerçekten BÖLÜNMESİ gerekiyorsa böl (en az 2 anlamlı alt görev); basit/tek adımlık
  bir görevi yapay yere parçalama — doğrudan tek bir agent'a devret.
- Her run_agent çağrısında görevi NET ve KENDİ BAŞINA anlaşılır yaz (alt-agent senin
  bağlamını görmez, yalnız verdiğin task metnini görür).
- Model seçimi: basit/mekanik alt görevler için model/provider verme (varsayılan yerel/ucuz
  modele düşer) ya da bilinçli olarak yerel bir model pinle; derin muhakeme/kalite gerektiren
  alt görevlerde bilinçli olarak bulut model (provider/model) pinle.
- Alt görevlerin sonuçlarını SENTEZLE — parça parça yapıştırma, tutarlı tek bir cevap üret.
- Son cevabını araç çağrısı OLMADAN, sentezlenmiş nihai sonuç olarak yaz.
`;

const DEFAULT_AGENT_DEFINITIONS: ReadonlyArray<{ id: string; body: string }> = [
  { id: "coder", body: DEFAULT_CODER_DEFINITION },
  { id: "asistan", body: DEFAULT_ASISTAN_DEFINITION },
  { id: "damitici", body: DEFAULT_DAMITICI_DEFINITION },
  { id: "sef", body: DEFAULT_SEF_DEFINITION },
];

/**
 * Daemon açılışında bir kez: eksik olan varsayılan agent tanımları yazılır (agent DEĞİL,
 * daemon yazar — SPEC-AGENT §1). Her tanım bağımsız kontrol edilir; kullanıcı birini silip
 * özelleştirmişse ötekini yeniden yaratmak onu bozmaz.
 */
export function ensureDefaultAgent(agentsDir: string): void {
  for (const { id, body } of DEFAULT_AGENT_DEFINITIONS) {
    const file = join(agentsDir, `${id}.md`);
    if (existsSync(file)) continue;
    writeFileSync(file, body, "utf8");
  }
}
