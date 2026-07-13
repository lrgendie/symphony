import { describe, expect, it } from "vitest";
import { curationActionsFor, curationErrorMessage } from "./curation-actions";

describe("curationActionsFor (ADR-019 Karar 2/6, Dilim H3) — SAF", () => {
  it("session/run: sabitle + bağla + grupla (rename/delete YOK — türetilmiş)", () => {
    expect(curationActionsFor("session")).toEqual(["pin", "link", "group"]);
    expect(curationActionsFor("run")).toEqual(["pin", "link", "group"]);
  });

  it("project/model/agent: KORUMALI — yalnız bağla + grupla (pin/rename/delete YOK)", () => {
    for (const kind of ["project", "model", "agent"]) {
      const actions = curationActionsFor(kind);
      expect(actions).toEqual(["link", "group"]);
      expect(actions).not.toContain("pin");
      expect(actions).not.toContain("delete");
      expect(actions).not.toContain("rename");
    }
  });

  it("context: kürasyon → yeniden adlandır + bağla + grupla + sil (pin YOK, zaten sabit)", () => {
    expect(curationActionsFor("context")).toEqual(["rename", "link", "group", "delete"]);
  });

  it("group: yeniden adlandır + üye ekle + kopar + bağla + sil", () => {
    expect(curationActionsFor("group")).toEqual([
      "rename",
      "member-add",
      "member-remove",
      "link",
      "delete",
    ]);
  });

  it("week: yalnız drill-down", () => {
    expect(curationActionsFor("week")).toEqual(["open-week"]);
  });

  it("bilinmeyen tür (Karar 7b ileri sürüm düğümü): eylem yok", () => {
    expect(curationActionsFor("gelecek-tür")).toEqual([]);
  });
});

describe("curationErrorMessage — hata kodu → Türkçe mesaj", () => {
  it("PROTECTED → türetilmiş düğüm açıklaması", () => {
    expect(curationErrorMessage({ code: "VALIDATION_MAP_NODE_PROTECTED", message: "x" })).toContain(
      "türetilmiş",
    );
  });

  it("bilinmeyen kod (TIMEOUT/eski daemon): daemon'ın kendi mesajını AYNEN geçirir (güncelleme ipucu)", () => {
    const msg = "Daemon yanıt vermedi. Eski bir daemon olabilir — güncelle: symphony update";
    expect(curationErrorMessage({ code: "TIMEOUT", message: msg })).toBe(msg);
  });
});
