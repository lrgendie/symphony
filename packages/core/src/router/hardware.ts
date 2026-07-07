import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GpuSample } from "@symphony/shared";

const execFileAsync = promisify(execFile);

/**
 * VRAM tespiti (ROADMAP Faz 1: router "donanımını da tanır").
 * v1: yalnız NVIDIA (`nvidia-smi` sürücüyle PATH'e gelir; Win/Linux aynı komut).
 * Tespit edilemezse null — router yerel modeli dışlamaz, sadece gerekçede
 * donanım notu veremez. AMD/Apple Silicon desteği ihtiyaç doğunca eklenecek.
 */
export async function detectVramGb(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=memory.total", "--format=csv,noheader,nounits"],
      // Windows: aksi hâlde nvidia-smi.exe (konsol uygulaması) görünür bir konsol penceresi
      // flaşlatır. POSIX'te etkisizdir. sampleGpus 2sn'de bir çağrıldığından bu ŞART.
      { windowsHide: true },
    );
    const firstLine = stdout.trim().split(/\r?\n/)[0];
    if (firstLine === undefined) return null;
    const totalMb = Number.parseInt(firstLine.trim(), 10);
    if (Number.isNaN(totalMb) || totalMb <= 0) return null;
    return Math.round((totalMb / 1024) * 10) / 10;
  } catch {
    return null;
  }
}

/** nvidia-smi sorgu alanları — parseGpuCsv sütun sırası bununla EŞLEŞMELİDİR. */
const GPU_QUERY_FIELDS = "index,name,utilization.gpu,memory.total,memory.used,temperature.gpu";

function clampPct(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function nonNegMb(s: string | undefined): number {
  const n = Number.parseInt((s ?? "").trim(), 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

/** "[N/A]"/"[Not Supported]" gibi sayı-olmayan sıcaklıklar → null (bazı GPU'lar bildirmez). */
function parseTemp(s: string | undefined): number | null {
  const n = Number.parseInt((s ?? "").trim(), 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * `nvidia-smi --format=csv,noheader,nounits` çıktısını ayrıştırır (satır başına bir GPU).
 * SAF fonksiyon — nvidia-smi olmadan birim test edilir. Bozuk/eksik satırları atlar.
 */
export function parseGpuCsv(stdout: string): GpuSample[] {
  const samples: GpuSample[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const cols = line.split(",").map((c) => c.trim());
    if (cols.length < 6) continue;
    const index = Number.parseInt(cols[0] ?? "", 10);
    const name = cols[1] ?? "";
    if (Number.isNaN(index) || name === "") continue;
    samples.push({
      index,
      name,
      utilizationPct: clampPct(Number.parseInt(cols[2] ?? "", 10)),
      memTotalMb: nonNegMb(cols[3]),
      memUsedMb: nonNegMb(cols[4]),
      temperatureC: parseTemp(cols[5]),
    });
  }
  return samples;
}

/**
 * Yerel GPU'ların anlık vitallerini örnekler (util/VRAM/sıcaklık). NVIDIA v1.
 * nvidia-smi yoksa/başarısızsa boş dizi (GPU yok = küre yalnız mood'la sürülür).
 */
export async function sampleGpus(): Promise<GpuSample[]> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      [`--query-gpu=${GPU_QUERY_FIELDS}`, "--format=csv,noheader,nounits"],
      // Windows: her 2sn'de bir çalışır → windowsHide olmadan periyodik konsol penceresi flaşı.
      { windowsHide: true },
    );
    return parseGpuCsv(stdout);
  } catch {
    return [];
  }
}
