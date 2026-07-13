import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-019 Karar 2/6 (Faz "H" Dilim H4) — `agent-suggestion.test.ts` ile AYNI desen: daemon
 * bağlantısı mock'lanır (WS `map.pin` isteğinin GERÇEKTEN çalıştığı `daemon.test.ts`'in
 * "kürasyon roundtrip" testinde H1'de zaten kanıtlandı) — burada id-çözümleme (ön ek eşleşmesi)
 * ve çıktı biçimlendirme test edilir.
 */

const getContextMapMock = vi.fn();
const requestMock = vi.fn();
const closeMock = vi.fn();
vi.mock("../client/daemon-client.js", () => ({
  connectToDaemon: async () => ({
    getContextMap: getContextMapMock,
    request: requestMock,
    close: closeMock,
  }),
}));

import { haritaEkleCommand, haritaListeCommand } from "./harita.js";

const SESSION_NODE = {
  id: "11111111-1111-1111-1111-111111111111",
  kind: "session",
  label: "tasarım sohbeti",
  at: 2_000,
  meta: {},
};
const RUN_NODE = {
  id: "22222222-2222-2222-2222-222222222222",
  kind: "run",
  label: "coder görevi",
  at: 1_000,
  meta: {},
};
const OTHER_SESSION_NODE = {
  id: "11111111-1bbb-1111-1111-111111111111", // "11111111-1" ön ekini SESSION_NODE ile PAYLAŞIR
  kind: "session",
  label: "başka sohbet",
  at: 3_000,
  meta: {},
};

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  requestMock.mockImplementation(async () => ({ nodeId: "node-abc" }));
});

afterEach(() => {
  logSpy.mockRestore();
});

describe("haritaEkleCommand", () => {
  it("TAM id ile eşleşen bir session'ı sabitler — ref.kind='session'", async () => {
    getContextMapMock.mockResolvedValue({ nodes: [SESSION_NODE, RUN_NODE], edges: [] });
    await haritaEkleCommand(SESSION_NODE.id, {});
    expect(requestMock).toHaveBeenCalledWith("map.pin", {
      ref: { kind: "session", id: SESSION_NODE.id },
    });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("TAM id ile eşleşen bir run'ı sabitler — ref.kind='run'", async () => {
    getContextMapMock.mockResolvedValue({ nodes: [SESSION_NODE, RUN_NODE], edges: [] });
    await haritaEkleCommand(RUN_NODE.id, {});
    expect(requestMock).toHaveBeenCalledWith("map.pin", { ref: { kind: "run", id: RUN_NODE.id } });
  });

  it("benzersiz bir ÖN EK ile de çözülür (kısa id kolaylığı)", async () => {
    getContextMapMock.mockResolvedValue({ nodes: [SESSION_NODE, RUN_NODE], edges: [] });
    await haritaEkleCommand("2222", {});
    expect(requestMock).toHaveBeenCalledWith("map.pin", { ref: { kind: "run", id: RUN_NODE.id } });
  });

  it("--baslik verilirse title alanı payload'a eklenir", async () => {
    getContextMapMock.mockResolvedValue({ nodes: [SESSION_NODE], edges: [] });
    await haritaEkleCommand(SESSION_NODE.id, { baslik: "önemli karar" });
    expect(requestMock).toHaveBeenCalledWith("map.pin", {
      ref: { kind: "session", id: SESSION_NODE.id },
      title: "önemli karar",
    });
  });

  it("hiçbir öğe eşleşmezse reddeder — map.pin HİÇ çağrılmaz", async () => {
    getContextMapMock.mockResolvedValue({ nodes: [SESSION_NODE], edges: [] });
    await expect(haritaEkleCommand("hic-boyle-bir-id", {})).rejects.toThrow(/bulunamadı/);
    expect(requestMock).not.toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalledTimes(1); // bağlantı yine de kapatılır
  });

  it("ön ek BİRDEN ÇOK öğeye uyarsa reddeder (belirsizlik)", async () => {
    getContextMapMock.mockResolvedValue({ nodes: [SESSION_NODE, OTHER_SESSION_NODE], edges: [] });
    await expect(haritaEkleCommand("11111111-1", {})).rejects.toThrow(/birden çok öğeye uyuyor/);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("project/model/agent/week/context/group düğümleri id çözümlemesine GİRMEZ (yalnız session/run)", async () => {
    const projectNode = { id: "project:/x", kind: "project", label: "x", at: 1, meta: {} };
    getContextMapMock.mockResolvedValue({ nodes: [SESSION_NODE, projectNode], edges: [] });
    await expect(haritaEkleCommand("project:", {})).rejects.toThrow(/bulunamadı/);
  });
});

describe("haritaListeCommand", () => {
  it("kürasyon YOKSA çökmez, bilgilendirir", async () => {
    getContextMapMock.mockResolvedValue({ nodes: [SESSION_NODE, RUN_NODE], edges: [] });
    await expect(haritaListeCommand()).resolves.not.toThrow();
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("henüz haritaya sabitlenmiş");
  });

  it("context düğümünü [BAĞLAM] etiketiyle + ref okunuşuyla basar", async () => {
    const ctx = {
      id: "ctx-1",
      kind: "context",
      label: "önemli koşu",
      at: 5_000,
      meta: { refKind: "run", refId: RUN_NODE.id },
    };
    getContextMapMock.mockResolvedValue({ nodes: [ctx], edges: [] });
    await haritaListeCommand();
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("[BAĞLAM]");
    expect(output).toContain("önemli koşu");
    expect(output).toContain("run");
  });

  it("group düğümünü [GRUP] etiketiyle basar", async () => {
    const grp = { id: "grp-1", kind: "group", label: "Sprint-1", at: 5_000, meta: {} };
    getContextMapMock.mockResolvedValue({ nodes: [grp], edges: [] });
    await haritaListeCommand();
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("[GRUP]");
    expect(output).toContain("Sprint-1");
  });

  it("session/run/project/model/agent/week düğümleri LİSTEYE GİRMEZ (yalnız context/group)", async () => {
    getContextMapMock.mockResolvedValue({ nodes: [SESSION_NODE, RUN_NODE], edges: [] });
    await haritaListeCommand();
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).not.toContain(SESSION_NODE.label);
    expect(output).not.toContain(RUN_NODE.label);
  });

  it("en yeni (at DESC) önce basılır", async () => {
    const eski = { id: "c-eski", kind: "context", label: "ESKİ", at: 1_000, meta: {} };
    const yeni = { id: "c-yeni", kind: "context", label: "YENİ", at: 9_000, meta: {} };
    getContextMapMock.mockResolvedValue({ nodes: [eski, yeni], edges: [] });
    await haritaListeCommand();
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output.indexOf("YENİ")).toBeLessThan(output.indexOf("ESKİ"));
  });
});
