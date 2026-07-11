import { describe, expect, it } from "vitest";
import { PROTECTED_PATHS, protectedMatches, touchesProtected } from "./protected.js";

/**
 * ADR-018 Karar 4 — DEĞİŞMEZLER. Bu testler "kendini geliştiren sistem kendi frenlerini
 * gevşetemez" garantisinin kod karşılığıdır.
 */
describe("PROTECTED_PATHS (ADR-018 Karar 4) — SAF", () => {
  it("LİSTE KENDİNİ KORUR — ilk yama bu dosyayı boşaltıp sonrakilere geçiş açamaz", () => {
    expect(touchesProtected(["packages/core/src/doctor/protected.ts"])).toBe(true);
  });

  it("izin sistemi / jail / motor korumalı (araç çalıştırmanın TEK kapısı)", () => {
    expect(touchesProtected(["packages/core/src/agent/permissions.ts"])).toBe(true);
    expect(touchesProtected(["packages/core/src/agent/jail.ts"])).toBe(true);
    expect(touchesProtected(["packages/core/src/agent/engine.ts"])).toBe(true);
  });

  it("güncelleyici çekirdek + yama uygulama zincirinin KENDİSİ korumalı", () => {
    expect(touchesProtected(["packages/cli/src/commands/update.ts"])).toBe(true);
    expect(touchesProtected(["packages/cli/src/commands/patch.ts"])).toBe(true);
  });

  it("anahtar yönetimi DİZİN olarak korumalı (altındaki her dosya)", () => {
    expect(touchesProtected(["packages/core/src/secrets/secret-store.ts"])).toBe(true);
    expect(touchesProtected(["packages/core/src/secrets/yeni-dosya.ts"])).toBe(true);
  });

  it("daemon token'ı (kimlik doğrulamanın kökü) korumalı", () => {
    expect(touchesProtected(["packages/core/src/server/token.ts"])).toBe(true);
  });

  it("sıradan kaynak dosyalar korumalı DEĞİL (yama akışı tıkanmasın)", () => {
    expect(touchesProtected(["packages/core/src/router/router.ts"])).toBe(false);
    expect(touchesProtected(["packages/core/src/db/store.ts"])).toBe(false);
    expect(touchesProtected([])).toBe(false);
  });

  it("Windows ayracı (\\) normalize edilir — git '/' verir ama yol karışabilir", () => {
    expect(touchesProtected(["packages\\core\\src\\agent\\permissions.ts"])).toBe(true);
    expect(touchesProtected(["packages\\core\\src\\secrets\\secret-store.ts"])).toBe(true);
  });

  it("./ öneki normalize edilir", () => {
    expect(touchesProtected(["./packages/core/src/agent/engine.ts"])).toBe(true);
  });

  it("BENZER ama farklı yollar korumalı DEĞİL (önek yanlış eşleşmesi olmamalı)", () => {
    // `permissions.ts` korumalı ama `permissions.test.ts` DEĞİL (tam eşleşme, önek değil).
    expect(touchesProtected(["packages/core/src/agent/permissions.test.ts"])).toBe(false);
    // `secrets/` dizini korumalı ama `secrets-yardimci.ts` (dizin değil) değil.
    expect(touchesProtected(["packages/core/src/secrets-yardimci.ts"])).toBe(false);
  });

  it("protectedMatches yalnız EŞLEŞENLERİ döner (kullanıcıya hangisi olduğunu göstermek için)", () => {
    const hits = protectedMatches([
      "packages/core/src/router/router.ts",
      "packages/core/src/agent/engine.ts",
      "packages/core/src/db/store.ts",
      "packages/core/src/secrets/secret-store.ts",
    ]);
    expect(hits).toEqual([
      "packages/core/src/agent/engine.ts",
      "packages/core/src/secrets/secret-store.ts",
    ]);
  });

  it("liste boş DEĞİL (kazara boşaltılırsa test düşer — sigortanın sigortası)", () => {
    expect(PROTECTED_PATHS.length).toBeGreaterThanOrEqual(6);
  });
});
