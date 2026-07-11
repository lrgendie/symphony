import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-018 Karar 3+4 — `patch apply` TEHLİKELİ bir zincirdir (ana dala merge + daemon restart).
 * Testin işi: **SIRAYI ve GÜVENLİK KAPILARINI** kanıtlamak. Gerçek merge/build/restart YOK
 * (git/execa/daemon MOCK'lu — `update.test.ts` deseni); kanıtlanan şey "ne, hangi sırayla,
 * hangi koşulda" çalıştığıdır.
 */

// ---- Mock'lar (import'lardan ÖNCE) ----
const gitRaw = vi.fn(async () => "");
const gitStatus = vi.fn(async () => ({ isClean: () => true, files: [] as unknown[] }));
const gitBranchLocal = vi.fn(async () => ({ all: ["main", "doktor/kod"] }));
const gitRevparse = vi.fn(async () => "base-sha-1234567890\n");
vi.mock("simple-git", () => ({
  simpleGit: () => ({
    raw: gitRaw,
    status: gitStatus,
    branchLocal: gitBranchLocal,
    revparse: gitRevparse,
  }),
}));

const execaMock = vi.fn(async () => ({ stdout: "" }));
vi.mock("execa", () => ({ execa: (...args: unknown[]) => execaMock(...args) }));

const requestMock = vi.fn();
const closeMock = vi.fn();
const connectMock = vi.fn(async () => ({ request: requestMock, close: closeMock }));
const ensureDaemonRunningMock = vi.fn(async () => ({ started: true, port: 7770 }));
vi.mock("../client/daemon-client.js", () => ({
  connectToDaemon: () => connectMock(),
  ensureDaemonRunning: () => ensureDaemonRunningMock(),
}));

const shutdownMock = vi.fn(async () => undefined);
vi.mock("./update.js", () => ({ shutdownDaemonIfRunning: () => shutdownMock() }));

const questionMock = vi.fn(async () => "e");
vi.mock("node:readline/promises", () => ({
  createInterface: () => ({ question: questionMock, close: vi.fn() }),
}));

// Gerçek dosyaya yazar (trust.ts'in readTrust/writeTrust'ı GERÇEK kalır — ...actual ile) ki
// `patch trust`in dosya kalıcılığı da kanıtlansın, yalnız iç mantığı değil.
let trustFile = "";
vi.mock("@symphony/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@symphony/core")>();
  return {
    ...actual, // protectedMatches/readTrust/writeTrust/categoryRecord GERÇEK kalır
    findRepoRoot: () => "/repo",
    getSymphonyPaths: () => ({ home: "/home", trustFile }),
    loadConfig: () => ({ selfDev: { repoPath: "/repo" }, daemon: { port: 7770 } }),
  };
});

import { patchApplyCommand, patchTrustCommand, patchUntrustCommand } from "./patch.js";
import { readTrust, writeTrust } from "@symphony/core";

const PATCH = {
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: 1,
  errorCode: "AGENT_TOOL_LOOP",
  category: "AGENT_TOOL_LOOP",
  branch: "doktor/kod",
  files: ["packages/core/src/router/router.ts"],
  testOk: true,
  testSummary: "hepsi geçti",
  state: "proposed" as const,
  resolvedAt: null,
};

function patchList(overrides: Partial<typeof PATCH> = {}) {
  return { patches: [{ ...PATCH, ...overrides }] };
}

/** `patch.resolve` ile kaydedilen durum (yoksa null). */
function resolvedState(): string | null {
  const call = requestMock.mock.calls.find(([type]) => type === "patch.resolve");
  return call === undefined ? null : (call[1] as { state: string }).state;
}

/** git komutlarını sırayla düz metin olarak verir — ZİNCİR SIRASI böyle doğrulanır. */
function gitCommands(): string[] {
  return gitRaw.mock.calls.map((call) => (call[0] as string[]).join(" "));
}

function execaSteps(): string[] {
  return execaMock.mock.calls.map((call) => `${call[0] as string} ${(call[1] as string[]).join(" ")}`);
}

let exitSpy: ReturnType<typeof vi.spyOn>;
let trustDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  execaMock.mockImplementation(async () => ({ stdout: "" }));
  gitStatus.mockImplementation(async () => ({ isClean: () => true, files: [] }));
  gitBranchLocal.mockImplementation(async () => ({ all: ["main", "doktor/kod"] }));
  ensureDaemonRunningMock.mockImplementation(async () => ({ started: true, port: 7770 }));
  questionMock.mockImplementation(async () => "e");
  requestMock.mockImplementation(async (type: string) =>
    type === "patches.list" ? patchList() : {},
  );
  // waitUntilDown: sağlık ucu cevap vermiyor = daemon kapandı.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("__EXIT__");
  });
  // trust.json GERÇEK bir dosyaya yazılır (readTrust/writeTrust mock'lanmadı — trust.test.ts
  // iç mantığı zaten kanıtlıyor; burada CLI komutunun dosya kalıcılığını da kanıtlıyoruz).
  trustDir = mkdtempSync(join(tmpdir(), "symphony-patch-trust-"));
  trustFile = join(trustDir, "trust.json");
});

afterEach(() => {
  exitSpy.mockRestore();
  vi.unstubAllGlobals();
  rmSync(trustDir, { recursive: true, force: true });
});

describe("patch apply — ÖN KOŞULLAR (merge'e HİÇ ulaşmadan reddeder)", () => {
  it("repo KİRLİYSE reddeder — kullanıcının kaydedilmemiş işi merge ile mahvolmaz", async () => {
    gitStatus.mockImplementation(async () => ({ isClean: () => false, files: [{}, {}] }));

    await expect(patchApplyCommand("1111", {})).rejects.toThrow(/temiz değil/);
    expect(gitCommands()).toEqual([]); // MERGE HİÇ ÇALIŞMADI
  });

  it("yama 'proposed' değilse reddeder (iki kez uygulanamaz)", async () => {
    requestMock.mockImplementation(async (type: string) =>
      type === "patches.list" ? patchList({ state: "applied" }) : {},
    );
    await expect(patchApplyCommand("1111", {})).rejects.toThrow(/proposed/);
    expect(gitCommands()).toEqual([]);
  });

  it("yama dalı yoksa reddeder", async () => {
    gitBranchLocal.mockImplementation(async () => ({ all: ["main"] }));
    await expect(patchApplyCommand("1111", {})).rejects.toThrow(/dalı yok/);
    expect(gitCommands()).toEqual([]);
  });
});

describe("patch apply — MUTLU YOL", () => {
  it("merge → build → test → shutdown → restart → applied → dal silinir (SIRA)", async () => {
    await patchApplyCommand("1111", { evet: true });

    const git = gitCommands();
    expect(git[0]).toContain("merge --no-ff doktor/kod");
    expect(execaSteps()).toEqual(["pnpm build", "pnpm test"]); // ANA DALDA doğrulama
    expect(shutdownMock).toHaveBeenCalled();
    expect(ensureDaemonRunningMock).toHaveBeenCalled();
    expect(resolvedState()).toBe("applied");
    expect(git.some((c) => c.startsWith("branch -d doktor/kod"))).toBe(true);
    // Geri alma YAPILMAMALI.
    expect(git.some((c) => c.includes("reset --hard"))).toBe(false);
  });
});

describe("patch apply — WATCHDOG (bozuk yama canlıya ÇIKAMAZ)", () => {
  it("pnpm test DÜŞERSE: reset + YENİDEN DERLE + failed; daemon HİÇ yeniden başlatılmaz", async () => {
    execaMock.mockImplementation(async (_cmd: unknown, args: unknown) => {
      if ((args as string[])[0] === "test") throw new Error("2 test düştü");
      return { stdout: "" };
    });

    await expect(patchApplyCommand("1111", { evet: true })).rejects.toThrow("__EXIT__");

    const git = gitCommands();
    expect(git.some((c) => c.includes("reset --hard base-sha-1234567890"))).toBe(true);
    // KRİTİK: reset sonrası YENİDEN DERLEME — yoksa daemon bir sonraki açılışta BOZUK dist'i yükler.
    expect(execaSteps().filter((s) => s === "pnpm build")).toHaveLength(2);
    expect(shutdownMock).not.toHaveBeenCalled(); // restart'a HİÇ ulaşmadı
    expect(resolvedState()).toBe("failed");
  });

  it("pnpm build DÜŞERSE: aynı şekilde geri alınır, test bile koşmaz", async () => {
    execaMock.mockImplementationOnce(async () => {
      throw new Error("tsc hatası");
    });

    await expect(patchApplyCommand("1111", { evet: true })).rejects.toThrow("__EXIT__");

    expect(gitCommands().some((c) => c.includes("reset --hard"))).toBe(true);
    expect(shutdownMock).not.toHaveBeenCalled();
    expect(resolvedState()).toBe("failed");
  });

  it("yeni daemon AYAĞA KALKMAZSA: geri al + ESKİ kodla yeniden başlat + reverted", async () => {
    // İlk ensureDaemonRunning (yeni kod) DÜŞER; ikincisi (geri alınmış kod) başarılı.
    ensureDaemonRunningMock
      .mockImplementationOnce(async () => {
        throw new Error("daemon 10sn içinde ayağa kalkmadı");
      })
      .mockImplementation(async () => ({ started: true, port: 7770 }));

    await expect(patchApplyCommand("1111", { evet: true })).rejects.toThrow("__EXIT__");

    const git = gitCommands();
    expect(git.some((c) => c.includes("reset --hard base-sha-1234567890"))).toBe(true);
    expect(execaSteps().filter((s) => s === "pnpm build")).toHaveLength(2); // geri alma sonrası yeniden derleme
    expect(ensureDaemonRunningMock).toHaveBeenCalledTimes(2); // eski kodla YENİDEN başlatıldı
    expect(resolvedState()).toBe("reverted");
  });
});

describe("patch apply — DEĞİŞMEZLER (ADR-018 Karar 4)", () => {
  it("KORUMALI yola dokunan yamada --evet ONAYI ATLAYAMAZ; 'EVET' yazılmazsa merge YOK", async () => {
    requestMock.mockImplementation(async (type: string) =>
      type === "patches.list"
        ? patchList({ files: ["packages/core/src/agent/permissions.ts"] })
        : {},
    );
    questionMock.mockImplementation(async () => "e"); // sıradan onay YETMEZ

    await patchApplyCommand("1111", { evet: true }); // --evet verilmiş OLMASINA RAĞMEN

    expect(questionMock).toHaveBeenCalled(); // sorulmuş
    expect(gitCommands()).toEqual([]); // MERGE YOK — iptal
    expect(resolvedState()).toBeNull();
  });

  it("KORUMALI yolda 'EVET' yazılırsa uygulanır (insan açıkça onayladı)", async () => {
    requestMock.mockImplementation(async (type: string) =>
      type === "patches.list"
        ? patchList({ files: ["packages/core/src/secrets/secret-store.ts"] })
        : {},
    );
    questionMock.mockImplementation(async () => "EVET");

    await patchApplyCommand("1111", { evet: true });

    expect(gitCommands()[0]).toContain("merge --no-ff");
    expect(resolvedState()).toBe("applied");
  });

  it("sandbox testleri DÜŞMÜŞ yamada --evet onayı atlamaz (ayrı uyarı + onay)", async () => {
    requestMock.mockImplementation(async (type: string) =>
      type === "patches.list" ? patchList({ testOk: false }) : {},
    );
    questionMock.mockImplementation(async () => "h"); // hayır

    await patchApplyCommand("1111", { evet: true });

    expect(questionMock).toHaveBeenCalled();
    expect(gitCommands()).toEqual([]); // iptal
  });
});

describe("patch trust <kategori> (ADR-018 Karar 5, Dilim D4)", () => {
  it("sonuçlanmış (applied/reverted/failed) yama yoksa reddeder — sicil yok", async () => {
    requestMock.mockImplementation(async (type: string) =>
      type === "patches.list" ? patchList({ state: "proposed" }) : {},
    );
    await expect(patchTrustCommand("AGENT_TOOL_LOOP")).rejects.toThrow(/sicil yok/);
    expect(questionMock).not.toHaveBeenCalled(); // onay bile SORULMAZ
  });

  it("kategori GEÇMİŞTE korumalı yola dokunduysa reddeder (Karar 4 — blanket-trust değişmezi anlamsız kılmaz)", async () => {
    requestMock.mockImplementation(async (type: string) =>
      type === "patches.list"
        ? {
            patches: [
              { ...PATCH, state: "applied" },
              {
                ...PATCH,
                id: crypto.randomUUID(),
                state: "reverted",
                files: ["packages/core/src/agent/engine.ts"],
              },
            ],
          }
        : {},
    );
    await expect(patchTrustCommand("AGENT_TOOL_LOOP")).rejects.toThrow(/KORUMALI/);
    expect(readTrust(trustFile).trusted).toEqual([]);
  });

  it("onaylanırsa trust.json'a KALICI olarak yazılır", async () => {
    requestMock.mockImplementation(async (type: string) =>
      type === "patches.list" ? patchList({ state: "applied" }) : {},
    );
    questionMock.mockImplementation(async () => "e");

    await patchTrustCommand("AGENT_TOOL_LOOP");

    expect(readTrust(trustFile).trusted).toContain("AGENT_TOOL_LOOP");
  });

  it("onaylanmazsa YAZILMAZ", async () => {
    requestMock.mockImplementation(async (type: string) =>
      type === "patches.list" ? patchList({ state: "applied" }) : {},
    );
    questionMock.mockImplementation(async () => "h");

    await patchTrustCommand("AGENT_TOOL_LOOP");

    expect(readTrust(trustFile).trusted).not.toContain("AGENT_TOOL_LOOP");
  });
});

describe("patch untrust <kategori>", () => {
  it("güvenilir değilse yalnız mesaj verir, çökmez", () => {
    expect(() => patchUntrustCommand("HIC_GUVENILMEMIS_KOD")).not.toThrow();
  });

  it("güveniliyse ONAYSIZ kaldırır — sıkılaştırma her zaman güvenlidir", () => {
    writeTrust(trustFile, { trusted: ["AGENT_TOOL_LOOP"] });

    patchUntrustCommand("AGENT_TOOL_LOOP");

    expect(readTrust(trustFile).trusted).not.toContain("AGENT_TOOL_LOOP");
    expect(questionMock).not.toHaveBeenCalled();
  });
});
