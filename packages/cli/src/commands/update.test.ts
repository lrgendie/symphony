import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getSymphonyPaths } from "@lrgendie/core";

/**
 * ADR-017 Karar 4 — `npm`/daemon yeniden başlatma GERÇEK yan etkiler ister (global paket
 * kurulumu, süreç başlatma); burada MOCK'lanır — yalnız SAF versions.json mantığı + `execa`'ya
 * geçen argümanlar doğrulanır.
 */
const execaMock = vi.fn(async () => ({ stdout: "9.9.9" }));
vi.mock("execa", () => ({ execa: (...args: unknown[]) => execaMock(...args) }));

const ensureDaemonRunningMock = vi.fn(async () => ({ started: true, port: 7770 }));
vi.mock("../client/daemon-client.js", () => ({
  ensureDaemonRunning: (...args: unknown[]) => ensureDaemonRunningMock(...args),
}));

import {
  nextVersions,
  readVersions,
  rollbackCommand,
  swappedVersions,
  updateCommand,
  writeVersions,
} from "./update.js";

const testHome = join(tmpdir(), `symphony-update-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(testHome, { recursive: true });
});

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
  execaMock.mockClear();
  ensureDaemonRunningMock.mockClear();
});

describe("versions.json — SAF roundtrip/karşılaştırma", () => {
  it("dosya yoksa null", () => {
    expect(readVersions(join(testHome, "yok.json"))).toBeNull();
  });

  it("yaz-oku roundtrip birebir", () => {
    const file = join(testHome, "v.json");
    writeVersions(file, { previous: "0.1.0", current: "0.2.0", at: 1_000 });
    expect(readVersions(file)).toEqual({ previous: "0.1.0", current: "0.2.0", at: 1_000 });
  });

  it("nextVersions: şimdiki sürüm previous olur, yeni sürüm current", () => {
    const v = nextVersions("0.1.0", "0.2.0");
    expect(v.previous).toBe("0.1.0");
    expect(v.current).toBe("0.2.0");
    expect(typeof v.at).toBe("number");
  });

  it("swappedVersions: previous/current yer değiştirir", () => {
    const v = swappedVersions({ previous: "0.1.0", current: "0.2.0", at: 1_000 });
    expect(v.previous).toBe("0.2.0");
    expect(v.current).toBe("0.1.0");
  });
});

describe("updateCommand — execa/ensureDaemonRunning MOCK", () => {
  it("registry sürümü AYNIYSA npm install ÇAĞRILMAZ, versions.json yazılmaz", async () => {
    const ownVersion = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8"))
      .version as string;
    execaMock.mockImplementationOnce(async () => ({ stdout: ownVersion }));

    await updateCommand(testHome);

    expect(execaMock).toHaveBeenCalledTimes(1); // yalnız `npm view`, install YOK
    expect(ensureDaemonRunningMock).not.toHaveBeenCalled();
  });

  it("registry sürümü FARKLIYSA npm install çağrılır, versions.json yazılır, daemon yeniden başlatılır", async () => {
    execaMock.mockImplementationOnce(async () => ({ stdout: "99.0.0" })); // npm view
    execaMock.mockImplementationOnce(async () => ({ stdout: "" })); // npm install

    await updateCommand(testHome);

    expect(execaMock).toHaveBeenCalledTimes(2);
    const installCall = execaMock.mock.calls[1] as unknown[];
    expect(installCall[0]).toBe("npm");
    expect(installCall[1]).toEqual(["install", "-g", expect.stringContaining("@99.0.0")]);
    expect(ensureDaemonRunningMock).toHaveBeenCalledWith(testHome);

    const paths = getSymphonyPaths(testHome);
    const versions = readVersions(paths.versionsFile);
    expect(versions?.current).toBe("99.0.0");
  });
});

describe("rollbackCommand — execa/ensureDaemonRunning MOCK", () => {
  it("versions.json yoksa net hata + exit(1), npm install ÇAĞRILMAZ", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("__EXIT__");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(rollbackCommand(testHome)).rejects.toThrow("__EXIT__");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("update"));
      expect(execaMock).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("versions.json VARSA previous sürüme kurar, kaydı SWAP eder", async () => {
    const paths = getSymphonyPaths(testHome);
    writeVersions(paths.versionsFile, { previous: "0.1.0", current: "0.2.0", at: 1_000 });
    execaMock.mockImplementationOnce(async () => ({ stdout: "" })); // npm install

    await rollbackCommand(testHome);

    expect(execaMock).toHaveBeenCalledTimes(1);
    const installCall = execaMock.mock.calls[0] as unknown[];
    expect(installCall[1]).toEqual(["install", "-g", expect.stringContaining("@0.1.0")]);
    expect(ensureDaemonRunningMock).toHaveBeenCalledWith(testHome);

    const after = readVersions(paths.versionsFile);
    expect(after).toMatchObject({ previous: "0.2.0", current: "0.1.0" });
  });
});
