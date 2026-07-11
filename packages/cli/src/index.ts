#!/usr/bin/env node
// symphony CLI — daemon'a bağlanan terminal arayüzü (ROADMAP Faz 2).
import { Command } from "commander";
import { PROTOCOL_VERSION } from "@symphony/shared";
import { modelsCommand } from "./commands/models.js";
import { statusCommand } from "./commands/status.js";
import { watchCommand } from "./commands/watch.js";
import { historyCommand } from "./commands/history.js";
import { memoryDistillCommand, memoryPathCommand, memoryShowCommand } from "./commands/memory.js";
import { agentsCommand } from "./commands/agents.js";
import { agentRunCommand } from "./commands/agent.js";
import { feedbackCommand } from "./commands/feedback.js";
import { reportCommand } from "./commands/report.js";
import { addCommand } from "./commands/add.js";
import { syncCommand, syncInitCommand } from "./commands/sync.js";
import { rollbackCommand, updateCommand } from "./commands/update.js";
import { doctorCommand } from "./commands/doctor.js";
import { bekciEkleCommand, bekciListeCommand } from "./commands/bekci.js";
import {
  patchApplyCommand,
  patchRejectCommand,
  patchesCommand,
  patchTrustCommand,
  patchUntrustCommand,
} from "./commands/patch.js";
import { ensureDesktopRunning } from "./client/desktop-launch.js";

const program = new Command();

program
  .name("symphony")
  .description(`Symphony — yerel+bulut LLM orkestrasyonu (protokol v${PROTOCOL_VERSION})`)
  .version("0.1.0");

program
  .command("models")
  .description("Tüm sağlayıcıların kullanılabilir modellerini listele")
  .action(wrap(modelsCommand));

program
  .command("status")
  .description("Daemon, sağlayıcı sağlığı ve kullanım özeti")
  .action(wrap(statusCommand));

program
  .command("watch")
  .description("Daemon olay akışını canlı izle (tüm istemcilerin sohbetleri)")
  .action(wrap(watchCommand));

program
  .command("agents")
  .description("Kayıtlı agent tanımlarını listele (~/.symphony/agents)")
  .action(wrap(agentsCommand));

program
  .command("agent <ad> <görev>")
  .description("Agent koşusu başlat: dosya okur/yazar, komut çalıştırır — izinle (Faz 3)")
  .option("--cwd <dizin>", "çalışma alanı (varsayılan: bulunduğun dizin)")
  .option("--model <model>", "model (provider ile birlikte; boşsa router seçer)")
  .option("--provider <sağlayıcı>", "sağlayıcı (model ile birlikte)")
  .action((ad: string, gorev: string, opts: { cwd?: string; model?: string; provider?: string }) =>
    agentRunCommand(ad, gorev, opts).catch(fail),
  );

program
  .command("add <npm-paketi> [ekstra...]")
  .description("MCP sunucusunu (npm paketi) canlı doğrulayıp agent aracı olarak kaydet")
  .option("--name <ad>", "kayıt adı (varsayılan: paket adından türetilir)")
  .action((paket: string, ekstra: string[], opts: { name?: string }) =>
    addCommand(paket, ekstra, opts).catch(fail),
  );

program
  .command("feedback <runId> <değer>")
  .description("Geçmiş bir agent koşusunu işaretle: iyi|kötü (router v2'yi besler, ADR-016)")
  .option("-n, --not <metin>", "kısa not (opsiyonel)")
  .action((runId: string, deger: string, opts: { not?: string }) =>
    feedbackCommand(runId, deger, opts).catch(fail),
  );

program
  .command("report")
  .description("Kullanım raporu: token/maliyet, model×görev başarı tablosu, bulgular (ADR-016)")
  .option("--from <tarih>", "başlangıç (YYYY-AA-GG, varsayılan: 7 gün önce)")
  .option("--to <tarih>", "bitiş (YYYY-AA-GG, varsayılan: şimdi)")
  .action((opts: { from?: string; to?: string }) => reportCommand(opts).catch(fail));

program
  .command("history [oturum]")
  .description("Sohbet geçmişi: oturum listesi ya da tek oturumun dökümü (id ön eki yeter)")
  .action((oturum?: string) => historyCommand(oturum).catch(fail));

const memory = program
  .command("memory")
  .description("Kullanıcı profili (~/.symphony/memory/profil.md, ADR-013)");

memory
  .command("show", { isDefault: true })
  .description("Profili göster: içerik + karakter + truncated uyarısı")
  .action(wrap(memoryShowCommand));

memory
  .command("path")
  .description("Profil dosyasının yolunu yazdırır (kendi editörünle aç)")
  .action(() => memoryPathCommand());

memory
  .command("distill <arşiv-dizini>")
  .description("Arşiv dizininden salt-okur agent ile profil TASLAĞI üretir (canlı profile dokunmaz)")
  .option("--bulut", "yerel model şartını bilinçli olarak geç (arşiv buluta gönderilebilir)")
  .action((dizin: string, opts: { bulut?: boolean }) =>
    memoryDistillCommand(dizin, opts).catch(fail),
  );

const sync = program
  .command("sync")
  .description("~/.symphony ayarlarını özel git deposuyla eşitle (config/agents/memory, ADR-017)");

sync
  .command("run", { isDefault: true })
  .description("Beyaz listeyi commit'le, uzaktan al (rebase), gönder")
  .action(wrap(syncCommand));

sync
  .command("init <uzak-depo-url>")
  .description("İlk kurulum / yeni makine: uzak depoya bağlan, varsa mevcut yapılandırmayı indir")
  .action((url: string) => syncInitCommand(url).catch(fail));

program
  .command("doctor")
  .description(
    "Kendini geliştirme (ADR-018): tekrarlayan hatayı sandbox'ta teşhis edip YAMA ÖNERİSİ üretir",
  )
  .option("--kod <hata-kodu>", "belirli bir hata kodu (varsayılan: en sık tekrarlayan)")
  .option("--proje <ad>", "bekçi projesi modu (Dilim D6): kayıtlı projenin repoPath'inde çalışır")
  .action((opts: { kod?: string; proje?: string }) => doctorCommand(opts).catch(fail));

const bekci = program
  .command("bekci")
  .description("Kendi projelerinin log dosyalarını izle (ADR-018 Karar 7, Faz 8 Dilim D6)");

bekci
  .command("ekle <ad> <repoPath> <logFile>")
  .description("Proje kaydet/güncelle — daemon 10sn içinde izlemeye başlar (restart gerekmez)")
  .option("--test <komut>", "doğrulama komutu (yoksa yama testsiz/dürüstçe testOk:false kaydedilir)")
  .action((ad: string, repoPath: string, logFile: string, opts: { test?: string }) =>
    bekciEkleCommand(ad, repoPath, logFile, opts).catch(fail),
  );

bekci
  .command("liste", { isDefault: true })
  .description("Kayıtlı projeleri listele")
  .action(() => bekciListeCommand());

program
  .command("patches")
  .description("Doktorun ürettiği yama önerilerini listele (ADR-018 Karar 3)")
  .action(wrap(patchesCommand));

const patch = program.command("patch").description("Yama önerisini uygula / reddet (Faz 8)");

patch
  .command("apply <id>")
  .description("Yamayı canlıya al: merge → build+test → daemon restart → bozuksa GERİ AL")
  .option("--evet", "sıradan yamalarda onayı atla (KORUMALI yollarda GEÇMEZ)")
  .action((id: string, opts: { evet?: boolean }) => patchApplyCommand(id, opts).catch(fail));

patch
  .command("reject <id>")
  .description("Yamayı reddet ve dalını sil")
  .action((id: string) => patchRejectCommand(id).catch(fail));

patch
  .command("trust <kategori>")
  .description(
    "Kategoriye güven (sicili göster + onay iste) — sonraki test-yeşili yamalar doctor içinde sormadan uygulanır (Karar 5)",
  )
  .action((kategori: string) => patchTrustCommand(kategori).catch(fail));

patch
  .command("untrust <kategori>")
  .description("Kategoriden güveni geri çek (onaysız — sıkılaştırma güvenlidir)")
  .action((kategori: string) => {
    try {
      patchUntrustCommand(kategori);
    } catch (error) {
      fail(error);
    }
  });

program
  .command("update")
  .description("npm'de yeni sürüm varsa kur, daemon'ı yeniden başlat (ADR-017 Karar 4)")
  .action(wrap(() => updateCommand()));

program
  .command("rollback")
  .description("Son `update`den önceki sürüme dön (ADR-017 Karar 4)")
  .action(wrap(() => rollbackCommand()));

// Argümansız `symphony` → TUI (model seçici + sohbet)
program.action(
  wrap(async () => {
    // Faz 4: masaüstü de otomatik açılır (kapalıysa, ~/.symphony/config.json → desktop.autoLaunch
    // ile kapatılabilir) — en iyi gayret, TUI'nin başlamasını asla bloklamaz/kırmaz.
    ensureDesktopRunning();
    const { runTui } = await import("./tui/app.js");
    await runTui();
  }),
);

program.parseAsync().catch(fail);

function wrap(action: () => Promise<void>): () => Promise<void> {
  return () => action().catch(fail);
}

function fail(error: unknown): void {
  console.error(`⚠ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
