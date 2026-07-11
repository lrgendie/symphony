import { describe, expect, it } from "vitest";
import { join, sep } from "node:path";
import {
  DIAGNOSIS_SAMPLE_LIMIT,
  findRepoRoot,
  formatDiagnosis,
  sandboxBranch,
  slugForCode,
} from "./sandbox.js";
import type { TelemetryEntry } from "../db/store.js";

function row(overrides: Partial<TelemetryEntry> = {}): TelemetryEntry {
  return {
    id: 1,
    at: Date.UTC(2026, 6, 11, 9, 0, 0),
    scope: "agent",
    code: "AGENT_TOOL_LOOP",
    message: "aynı araç 3 kez aynı hatayı verdi",
    ...overrides,
  };
}

describe("slugForCode / sandboxBranch — SAF", () => {
  it("hata kodunu güvenli slug'a çevirir", () => {
    expect(slugForCode("AGENT_TOOL_LOOP")).toBe("agent-tool-loop");
    expect(sandboxBranch("AGENT_TOOL_LOOP")).toBe("doktor/agent-tool-loop");
  });

  it("ardışık/uçtaki özel karakterler tek tireye iner ve kırpılır", () => {
    expect(slugForCode("__A..B__")).toBe("a-b");
  });

  it("hiç harf/rakam yoksa 'bilinmeyen' (boş dal adı üretilmez)", () => {
    expect(slugForCode("___")).toBe("bilinmeyen");
    expect(sandboxBranch("___")).toBe("doktor/bilinmeyen");
  });
});

describe("findRepoRoot", () => {
  it("bu repo'nun kökünü bulur (pnpm-workspace.yaml)", () => {
    expect(findRepoRoot()).not.toBeNull();
  });

  it("node_modules İÇİNDEN çağrılırsa null döner — paketlenmiş kurulumda daemon kendi kaynağına sahip DEĞİL", () => {
    const inside = ["C:", "proj", "node_modules", "@symphony", "core", "dist"].join(sep);
    expect(findRepoRoot(inside)).toBeNull();
  });

  it("pnpm-workspace.yaml içermeyen bir ağaçta null döner", () => {
    expect(findRepoRoot(join(sep, "kesinlikle", "olmayan", "dizin"))).toBeNull();
  });
});

describe("formatDiagnosis — SAF (agent'a giden TEK veri kanalı)", () => {
  it("kod, tekrar sayısı ve pencereyi başlıkta taşır", () => {
    const text = formatDiagnosis("AGENT_TOOL_LOOP", 7, [row()], 7);
    expect(text).toContain("`AGENT_TOOL_LOOP`");
    expect(text).toContain("7 kez");
    expect(text).toContain("Son 7 günde");
  });

  it("mesaj/stack/bağlam kayıtları dosyaya girer", () => {
    const text = formatDiagnosis(
      "AGENT_TOOL_LOOP",
      1,
      [row({ stack: "Error: patladı\n  at x", context: { runId: "r1" } })],
      7,
    );
    expect(text).toContain("aynı araç 3 kez aynı hatayı verdi");
    expect(text).toContain("Error: patladı");
    expect(text).toContain('"runId": "r1"');
  });

  it("en çok DIAGNOSIS_SAMPLE_LIMIT kayıt yazılır (bağlam şişmesin)", () => {
    const many = Array.from({ length: DIAGNOSIS_SAMPLE_LIMIT + 5 }, (_, i) =>
      row({ id: i, message: `mesaj-${i}` }),
    );
    const text = formatDiagnosis("KOD", many.length, many, 7);
    expect(text).toContain(`mesaj-${DIAGNOSIS_SAMPLE_LIMIT - 1}`);
    expect(text).not.toContain(`mesaj-${DIAGNOSIS_SAMPLE_LIMIT}`);
  });

  it("kayıt yoksa çökmez", () => {
    expect(formatDiagnosis("KOD", 0, [], 7)).toContain("_kayıt yok_");
  });
});
