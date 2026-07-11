import { describe, expect, it } from "vitest";
import {
  checkCurationTarget,
  checkGraphReference,
  checkGroupTarget,
  checkPinRef,
  isDerivedNodeId,
  isKnownGraphReference,
  type MapNodeLookupFn,
  type MapRefExistsFn,
} from "./curation.js";

/** ADR-019 Karar 1/2 (Faz "H" Dilim H1) — kürasyon doğrulama çekirdeği, tamamen SAF. */

const noExists: MapRefExistsFn = () => false;
const noLookup: MapNodeLookupFn = () => null;

describe("isDerivedNodeId", () => {
  it("türetilmiş öneklerin (proje/model/agent/hafta) hepsini tanır", () => {
    expect(isDerivedNodeId("project:/repo/a")).toBe(true);
    expect(isDerivedNodeId("model:anthropic/claude-sonnet-5")).toBe(true);
    expect(isDerivedNodeId("agent:coder")).toBe(true);
    expect(isDerivedNodeId("week:2026-W28")).toBe(true);
  });

  it("kürasyon UUID'si ya da session/run id'si türetilmiş SAYILMAZ", () => {
    expect(isDerivedNodeId("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(false);
    expect(isDerivedNodeId("rastgele-metin")).toBe(false);
  });
});

describe("isKnownGraphReference", () => {
  it("türetilmiş id her zaman bilinir (exists hiç ÇAĞRILMASA bile)", () => {
    expect(isKnownGraphReference("project:/repo/a", noExists)).toBe(true);
  });

  it("türetilmemiş id: exists(session) true ise bilinir", () => {
    const exists: MapRefExistsFn = (kind, id) => kind === "session" && id === "s1";
    expect(isKnownGraphReference("s1", exists)).toBe(true);
  });

  it("türetilmemiş id: exists(run) true ise bilinir", () => {
    const exists: MapRefExistsFn = (kind, id) => kind === "run" && id === "r1";
    expect(isKnownGraphReference("r1", exists)).toBe(true);
  });

  it("hiçbir yerde karşılığı yoksa bilinmez", () => {
    expect(isKnownGraphReference("yok", noExists)).toBe(false);
  });
});

describe("checkCurationTarget — map.node.rename/delete hedefi", () => {
  it("GERÇEK bir kürasyon düğümüyse ok", () => {
    const lookup: MapNodeLookupFn = (id) => (id === "n1" ? { kind: "context" } : null);
    expect(checkCurationTarget("n1", lookup, noExists)).toEqual({ ok: true });
  });

  it("kürasyon değil ama türetilmiş/gerçek bir graf öğesiyse PROTECTED", () => {
    expect(checkCurationTarget("project:/repo/a", noLookup, noExists)).toEqual({
      ok: false,
      code: "VALIDATION_MAP_NODE_PROTECTED",
    });
  });

  it("gerçek bir session id'si de (kürasyon dışı) PROTECTED sayılır", () => {
    const exists: MapRefExistsFn = (kind, id) => kind === "session" && id === "s1";
    expect(checkCurationTarget("s1", noLookup, exists)).toEqual({
      ok: false,
      code: "VALIDATION_MAP_NODE_PROTECTED",
    });
  });

  it("hiçbir yerde karşılığı yoksa UNKNOWN", () => {
    expect(checkCurationTarget("yok", noLookup, noExists)).toEqual({
      ok: false,
      code: "VALIDATION_MAP_NODE_UNKNOWN",
    });
  });
});

describe("checkGraphReference — map.link.add/map.member.add uç noktası", () => {
  it("kürasyon düğümü kabul edilir", () => {
    const lookup: MapNodeLookupFn = (id) => (id === "n1" ? { kind: "group" } : null);
    expect(checkGraphReference("n1", lookup, noExists)).toEqual({ ok: true });
  });

  it("türetilmiş id kabul edilir", () => {
    expect(checkGraphReference("agent:coder", noLookup, noExists)).toEqual({ ok: true });
  });

  it("gerçek session/run id'si kabul edilir", () => {
    const exists: MapRefExistsFn = (kind, id) => kind === "run" && id === "r1";
    expect(checkGraphReference("r1", noLookup, exists)).toEqual({ ok: true });
  });

  it("hiçbir yerde karşılığı yoksa UNKNOWN", () => {
    expect(checkGraphReference("yok", noLookup, noExists)).toEqual({
      ok: false,
      code: "VALIDATION_MAP_NODE_UNKNOWN",
    });
  });
});

describe("checkGroupTarget — map.member.add/remove'un groupId'si", () => {
  it("gerçek bir 'group' düğümüyse ok", () => {
    const lookup: MapNodeLookupFn = (id) => (id === "g1" ? { kind: "group" } : null);
    expect(checkGroupTarget("g1", lookup)).toEqual({ ok: true });
  });

  it("var olan ama 'context' türünde bir düğümse UNKNOWN (yanlış tür grup SAYILMAZ)", () => {
    const lookup: MapNodeLookupFn = (id) => (id === "c1" ? { kind: "context" } : null);
    expect(checkGroupTarget("c1", lookup)).toEqual({
      ok: false,
      code: "VALIDATION_MAP_NODE_UNKNOWN",
    });
  });

  it("hiç yoksa UNKNOWN", () => {
    expect(checkGroupTarget("yok", noLookup)).toEqual({
      ok: false,
      code: "VALIDATION_MAP_NODE_UNKNOWN",
    });
  });
});

describe("checkPinRef — map.pin'in ref'i", () => {
  it("ref verilmemişse ok (title zorunluluğu ŞEMA seviyesinde, burada değil)", () => {
    expect(checkPinRef(undefined, noExists)).toEqual({ ok: true });
  });

  it("ref GERÇEK bir session'a işaret ediyorsa ok", () => {
    const exists: MapRefExistsFn = (kind, id) => kind === "session" && id === "s1";
    expect(checkPinRef({ kind: "session", id: "s1" }, exists)).toEqual({ ok: true });
  });

  it("ref bilinmeyen bir id'ye işaret ediyorsa REF_UNKNOWN", () => {
    expect(checkPinRef({ kind: "run", id: "yok" }, noExists)).toEqual({
      ok: false,
      code: "VALIDATION_MAP_REF_UNKNOWN",
    });
  });
});
