import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startDaemon, type RunningDaemon } from "@symphony/core";
import {
  DaemonClient,
  DaemonError,
  ensureDaemonRunning,
  resolveDaemonEntry,
} from "./daemon-client.js";

/** İstemci, GERÇEK daemon'a karşı test edilir (in-process, geçici home, boş port). */
let home: string;
let daemon: RunningDaemon;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "symphony-cli-test-"));
  daemon = await startDaemon({ port: 0, home });
  // ensureDaemonRunning keşfi config.json'dan yapar → gerçek portu yaz
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ daemon: { port: daemon.port } }, null, 2),
  );
});

afterAll(async () => {
  await daemon.close();
  rmSync(home, { recursive: true, force: true });
});

function makeClient(token = daemon.token): DaemonClient {
  return new DaemonClient({ port: daemon.port, token, reconnect: false });
}

describe("DaemonClient", () => {
  it("hello el sıkışması snapshot getirir", async () => {
    const client = makeClient();
    await client.open();
    expect(client.snapshot?.providers.map((p) => p.provider)).toContain("anthropic");
    client.close();
  });

  it("yanlış token AUTH_TOKEN_INVALID ile reddedilir", async () => {
    const client = makeClient("sahte-token");
    await expect(client.open()).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
    client.close();
  });

  it("request/cevap korelasyonu: models.list tüm sağlayıcıları getirir", async () => {
    const client = makeClient();
    await client.open();
    const { models } = await client.request("models.list", {});
    const providers = new Set(models.map((m) => m.provider));
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("google");
    client.close();
  });

  it("chat: chat.start.ok SONRASI gelen hata da yakalanıp reddedilir", async () => {
    const client = makeClient();
    await client.open();
    await expect(
      client.chat(
        {
          provider: "yok-boyle-saglayici",
          model: "hayalet",
          messages: [{ role: "user", content: "selam" }],
        },
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_UNKNOWN" });
    expect(DaemonError.name).toBe("DaemonError");
    client.close();
  });
});

describe("daemon keşfi ve otomatik başlatma", () => {
  it("çalışan daemon'ı bulur ve yeniden BAŞLATMAZ", async () => {
    const result = await ensureDaemonRunning(home);
    expect(result).toEqual({ started: false, port: daemon.port });
  });

  it("spawn hedefi (core dist/main.js) gerçekten var", () => {
    const entry = resolveDaemonEntry();
    expect(entry.endsWith("main.js")).toBe(true);
    expect(existsSync(entry)).toBe(true);
  });
});
