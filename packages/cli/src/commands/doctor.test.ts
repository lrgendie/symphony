import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-018 Karar 5 (Faz 8, Dilim D4) — doktor→apply akışının GÜVEN eki: `doctor.ts` bir
 * `doctor.patch.proposed` aldığında, kategori GÜVENİLİR + test yeşili + korumalı yol YOK ise
 * `symphony patch apply`e SORMADAN (aynı süreç içinde) devam eder. Bu test WS/daemon'ı ve
 * `patchApplyCommand`'ı MOCK'lar — kanıtlanan şey üç koşulun HEPSİNİN birlikte gerektiği,
 * `patchApplyCommand`'ın zinciri (merge/build/test/restart) `patch.test.ts`'te zaten kanıtlı.
 */

type Handler = (payload: never) => void;
const handlers = new Map<string, Handler[]>();

const requestMock = vi.fn(async (type: string) => {
  if (type === "doctor.diagnose") return { candidates: [{ code: "KOD_A", count: 5 }] };
  return {};
});
const closeMock = vi.fn();
const connectMock = vi.fn(async () => ({
  request: requestMock,
  close: closeMock,
  on: (type: string, handler: Handler) => {
    const list = handlers.get(type) ?? [];
    list.push(handler);
    handlers.set(type, list);
    return () => undefined;
  },
}));
vi.mock("../client/daemon-client.js", () => ({ connectToDaemon: () => connectMock() }));

const patchApplyMock = vi.fn(async () => undefined);
vi.mock("./patch.js", () => ({ patchApplyCommand: (...args: unknown[]) => patchApplyMock(...args) }));

let trustFile = "";
vi.mock("@lrgendie/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lrgendie/core")>();
  return {
    ...actual, // isTrusted/readTrust/touchesProtected GERÇEK kalır — güven mantığı sahtelenmez
    getSymphonyPaths: () => ({ home: "/home", trustFile }),
  };
});

import { writeTrust } from "@lrgendie/core";
import { doctorCommand } from "./doctor.js";

function emit(type: string, payload: unknown): void {
  for (const h of handlers.get(type) ?? []) h(payload as never);
}

/** Handler kaydı `doctorCommand`in birkaç mikro-görev sonra oluşur — kısa polling ile bekle. */
async function waitForHandler(type: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if ((handlers.get(type) ?? []).length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`handler kaydolmadı: ${type}`);
}

const PROPOSED = {
  runId: "11111111-1111-4111-8111-111111111111",
  patchId: "22222222-2222-4222-8222-222222222222",
  errorCode: "KOD_A",
  branch: "doktor/kod-a",
  files: ["packages/core/src/router/router.ts"],
  testOk: true,
  testSummary: "hepsi geçti",
};

let trustDir: string;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  requestMock.mockImplementation(async (type: string) => {
    if (type === "doctor.diagnose") return { candidates: [{ code: "KOD_A", count: 5 }] };
    return {};
  });
  patchApplyMock.mockImplementation(async () => undefined);
  trustDir = mkdtempSync(join(tmpdir(), "symphony-doctor-trust-"));
  trustFile = join(trustDir, "trust.json");
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("__EXIT__");
  });
});

afterEach(() => {
  exitSpy.mockRestore();
  rmSync(trustDir, { recursive: true, force: true });
});

describe("doctorCommand → güven merdiveni entegrasyonu (D4)", () => {
  it("kategori GÜVENİLİR DEĞİLSE otomatik uygulamaz — öneri olarak biter", async () => {
    const promise = doctorCommand({});
    await waitForHandler("doctor.patch.proposed");
    emit("doctor.patch.proposed", PROPOSED);

    await expect(promise).rejects.toThrow("__EXIT__");
    expect(patchApplyMock).not.toHaveBeenCalled();
  });

  it("GÜVENİLİR + test yeşili + korumasız ⇒ SORMADAN patchApplyCommand çağırır", async () => {
    writeTrust(trustFile, { trusted: ["KOD_A"] });

    const promise = doctorCommand({});
    await waitForHandler("doctor.patch.proposed");
    emit("doctor.patch.proposed", PROPOSED);

    await expect(promise).rejects.toThrow("__EXIT__");
    expect(patchApplyMock).toHaveBeenCalledWith(PROPOSED.patchId, { evet: true });
  });

  it("GÜVENİLİR ama testler DÜŞMÜŞSE otomatik uygulamaz (tek koşulun eksikliği yeter)", async () => {
    writeTrust(trustFile, { trusted: ["KOD_A"] });

    const promise = doctorCommand({});
    await waitForHandler("doctor.patch.proposed");
    emit("doctor.patch.proposed", { ...PROPOSED, testOk: false });

    await expect(promise).rejects.toThrow("__EXIT__");
    expect(patchApplyMock).not.toHaveBeenCalled();
  });

  it("GÜVENİLİR ama dosyalar KORUMALIYSA otomatik uygulamaz (Karar 4 hiçbir güvenle geçilmez)", async () => {
    writeTrust(trustFile, { trusted: ["KOD_A"] });

    const promise = doctorCommand({});
    await waitForHandler("doctor.patch.proposed");
    emit("doctor.patch.proposed", { ...PROPOSED, files: ["packages/core/src/agent/engine.ts"] });

    await expect(promise).rejects.toThrow("__EXIT__");
    expect(patchApplyMock).not.toHaveBeenCalled();
  });

  it("otomatik uygulama patchApplyCommand'dan FIRLATIRSA hata basar, süreç yine sonlanır", async () => {
    writeTrust(trustFile, { trusted: ["KOD_A"] });
    patchApplyMock.mockImplementation(async () => {
      throw new Error("merge çakışması");
    });

    const promise = doctorCommand({});
    await waitForHandler("doctor.patch.proposed");
    emit("doctor.patch.proposed", PROPOSED);

    await expect(promise).rejects.toThrow("__EXIT__");
    expect(patchApplyMock).toHaveBeenCalled();
  });
});

describe("doctorCommand → --proje (bekçi modu, ADR-018 Karar 7, Dilim D6)", () => {
  it("--proje verilince doctor.diagnose ATLANIR, doctor.run { proje } gönderilir", async () => {
    const promise = doctorCommand({ proje: "proje-a" });
    await waitForHandler("doctor.patch.proposed");

    expect(requestMock).not.toHaveBeenCalledWith("doctor.diagnose", expect.anything());
    expect(requestMock).toHaveBeenCalledWith("doctor.run", { proje: "proje-a" });

    emit("doctor.patch.proposed", { ...PROPOSED, errorCode: "BEKCI_PROJE_A" });
    await expect(promise).rejects.toThrow("__EXIT__");
  });

  it("doctor.run reddederse (kayıtsız proje) hata basıp temiz çıkar", async () => {
    requestMock.mockImplementation(async (type: string) => {
      if (type === "doctor.run") throw new Error("VALIDATION_BEKCI_PROJECT_UNKNOWN: kayıtlı değil");
      return {};
    });

    const promise = doctorCommand({ proje: "hic-kayitli-olmayan" });
    await expect(promise).rejects.toThrow("__EXIT__");
  });

  it("--proje ve --kod birlikte verilirse --proje ÖNCELİKLİDİR (bekçi modu kod seçimini görmezden gelir)", async () => {
    const promise = doctorCommand({ proje: "proje-a", kod: "BASKA_KOD" });
    await waitForHandler("doctor.patch.proposed");

    expect(requestMock).toHaveBeenCalledWith("doctor.run", { proje: "proje-a" });
    expect(requestMock).not.toHaveBeenCalledWith("doctor.run", { errorCode: "BASKA_KOD" });

    emit("doctor.patch.proposed", { ...PROPOSED, errorCode: "BEKCI_PROJE_A" });
    await expect(promise).rejects.toThrow("__EXIT__");
  });
});
