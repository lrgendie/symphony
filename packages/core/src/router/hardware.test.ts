import { describe, expect, it } from "vitest";
import { parseGpuCsv } from "./hardware.js";

/**
 * parseGpuCsv saf: nvidia-smi olmadan test edilir (sampleGpus alt-süreci CI'da yok).
 * Sütun sırası GPU_QUERY_FIELDS ile eşleşmeli: index,name,util,memTotal,memUsed,temp.
 */
describe("parseGpuCsv", () => {
  it("çok GPU'lu csv,noheader,nounits çıktısını ayrıştırır", () => {
    const out =
      "0, NVIDIA GeForce RTX 4070, 90, 12282, 8100, 72\n" +
      "1, NVIDIA GeForce RTX 3060, 5, 12288, 1024, 41";
    const gpus = parseGpuCsv(out);
    expect(gpus).toHaveLength(2);
    expect(gpus[0]).toEqual({
      index: 0,
      name: "NVIDIA GeForce RTX 4070",
      utilizationPct: 90,
      memTotalMb: 12282,
      memUsedMb: 8100,
      temperatureC: 72,
    });
    expect(gpus[1]?.temperatureC).toBe(41);
  });

  it("sıcaklık '[N/A]' → null, util 100'e sıkışır, eksik sütunlu satır atlanır", () => {
    const out = ["0, Tesla T4, 130, 16000, 200, [N/A]", "", "eksik, satir"].join("\n");
    const gpus = parseGpuCsv(out);
    expect(gpus).toHaveLength(1);
    expect(gpus[0]?.utilizationPct).toBe(100);
    expect(gpus[0]?.temperatureC).toBeNull();
    expect(gpus[0]?.memUsedMb).toBe(200);
  });

  it("tamamen boş çıktı → boş dizi", () => {
    expect(parseGpuCsv("\n  \n")).toHaveLength(0);
  });
});
