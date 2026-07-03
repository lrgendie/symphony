import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * VRAM tespiti (ROADMAP Faz 1: router "donanımını da tanır").
 * v1: yalnız NVIDIA (`nvidia-smi` sürücüyle PATH'e gelir; Win/Linux aynı komut).
 * Tespit edilemezse null — router yerel modeli dışlamaz, sadece gerekçede
 * donanım notu veremez. AMD/Apple Silicon desteği ihtiyaç doğunca eklenecek.
 */
export async function detectVramGb(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", [
      "--query-gpu=memory.total",
      "--format=csv,noheader,nounits",
    ]);
    const firstLine = stdout.trim().split(/\r?\n/)[0];
    if (firstLine === undefined) return null;
    const totalMb = Number.parseInt(firstLine.trim(), 10);
    if (Number.isNaN(totalMb) || totalMb <= 0) return null;
    return Math.round((totalMb / 1024) * 10) / 10;
  } catch {
    return null;
  }
}
