import { existsSync, readFileSync, writeFileSync } from "node:fs";
import picomatch from "picomatch";
import { z } from "zod";
import type { RiskClass } from "@lrgendie/shared";

/**
 * İzin denetimi (SPEC-AGENT.md §5). Kural dosyası `~/.symphony/permissions.json`;
 * karar sırası: **deny kuralı > allow kuralı > risk sınıfı varsayılanı**.
 * Dosyayı YALNIZ `permission.respond` akışı günceller (SPEC §8.2) — agent'ın
 * kendisi ~/.symphony altına yazamaz (workspace jail zaten engeller).
 */

export const PermissionRuleSchema = z
  .object({
    tool: z.string().min(1),
    pattern: z.string().min(1),
    decision: z.enum(["allow", "deny"]),
  })
  .strip();
export type PermissionRule = z.infer<typeof PermissionRuleSchema>;

const PermissionsFileSchema = z
  .object({ rules: z.array(PermissionRuleSchema).default([]) })
  .strip();

export type PermissionCheck = "allow" | "deny" | "ask";

export class PermissionEngine {
  constructor(private readonly file: string) {}

  /** Kuralları her seferinde taze okur: kullanıcı dosyayı elle düzenleyebilir. */
  rules(): PermissionRule[] {
    if (!existsSync(this.file)) return [];
    // Bozuk dosya sessizce boş sayılmaz: izin sistemi güvenlik sınırıdır,
    // kullanıcı elle bozduysa bunu duymalı (hata daemon'dan istemciye taşınır).
    const parsed = PermissionsFileSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    return parsed.rules;
  }

  decide(tool: string, target: string, riskClass: RiskClass): PermissionCheck {
    const matching = this.rules().filter(
      (rule) => rule.tool === tool && matchesPattern(tool, rule.pattern, target),
    );
    if (matching.some((rule) => rule.decision === "deny")) return "deny";
    if (matching.some((rule) => rule.decision === "allow")) return "allow";
    return riskClass === "safe" ? "allow" : "ask";
  }

  /**
   * `always_allow` kalıcılaştırması: bu ÇAĞRININ hedefini birebir eşleyen kural yazar
   * (genişletmek — ör. `pnpm test*` — kullanıcının elle yapacağı bilinçli iştir).
   * `destructive` sınıfında çağıran bu metoda hiç gelmemelidir.
   */
  addAllowRule(tool: string, target: string): void {
    const pattern = tool === "run_command" ? target : escapeGlob(target);
    const rules = this.rules();
    if (rules.some((r) => r.tool === tool && r.pattern === pattern && r.decision === "allow")) {
      return;
    }
    rules.push({ tool, pattern, decision: "allow" });
    writeFileSync(this.file, `${JSON.stringify({ rules }, null, 2)}\n`, "utf8");
  }
}

// Desen eşleme: dosya araçlarında picomatch — workspace-göreli posix yola karşı
// glob deseni (ör. **/*.md, SPEC §5 örneği). run_command'da `*` = "her şey" olan
// düz joker: komut metni `/` içerebileceği için glob kuralları uymaz (ör. pnpm test*).
export function matchesPattern(tool: string, pattern: string, target: string): boolean {
  if (tool === "run_command") {
    const regex = new RegExp(
      `^${pattern.trim().split("*").map(escapeRegExp).join("[\\s\\S]*")}$`,
    );
    return regex.test(target.trim());
  }
  return picomatch(pattern, { dot: true, nocase: true })(target);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Birebir yol kuralı için glob özel karakterlerini etkisizleştirir. */
function escapeGlob(text: string): string {
  return text.replace(/([\\{}()[\]*+?!@|])/g, "\\$1");
}
