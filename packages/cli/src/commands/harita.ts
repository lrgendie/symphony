import chalk from "chalk";
import type { ContextMapNode } from "@symphony/shared";
import { connectToDaemon } from "../client/daemon-client.js";

/**
 * `symphony harita ekle <sessionId|runId> [--baslik X]` + `symphony harita liste`
 * (ADR-019 Karar 2/6, Dilim H4) — TUI'nin `/harita` anının komut satırı karşılığı: hangi ekranda
 * olursan ol (geçmiş bir sohbet/koşu dahil) haritaya sabitleyebilir ya da mevcut kürasyonu
 * listeleyebilirsin. Ayrı bir REST/WS ucu GEREKMEDİ — `getContextMap` (mevcut `/api/context-map`)
 * hem id çözümlemesi (session/run düğümleri arasında ön ek arama) hem kürasyon listesi
 * (context/group düğümleri) için tek veri kaynağı.
 */

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * id'nin (TAM ya da ÖN EK) hangi session/run düğümüne işaret ettiğini bağlam haritasından bulur
 * — `history.ts`'in `resolveSession`iyle AYNI desen (kısa id kolaylığı).
 */
function resolvePinTarget(prefix: string, nodes: ContextMapNode[]): ContextMapNode {
  const candidates = nodes.filter(
    (n) => (n.kind === "session" || n.kind === "run") && n.id.startsWith(prefix),
  );
  const exact = candidates.find((n) => n.id === prefix);
  if (exact !== undefined) return exact;
  if (candidates.length === 0) {
    throw new Error(`'${prefix}' ile başlayan bir oturum/koşu bulunamadı (son 500 öğe arasında).`);
  }
  const first = candidates[0];
  if (candidates.length > 1 || first === undefined) {
    throw new Error(
      `'${prefix}' birden çok öğeye uyuyor: ${candidates.map((n) => n.id.slice(0, 12)).join(", ")}` +
        " — daha uzun bir ön ek ver.",
    );
  }
  return first;
}

export async function haritaEkleCommand(
  idPrefix: string,
  options: { baslik?: string },
): Promise<void> {
  const client = await connectToDaemon();
  try {
    const graph = await client.getContextMap(500);
    const target = resolvePinTarget(idPrefix, graph.nodes);
    const result = await client.request("map.pin", {
      ref: { kind: target.kind === "session" ? "session" : "run", id: target.id },
      ...(options.baslik !== undefined ? { title: options.baslik } : {}),
    });
    console.log(chalk.green("✔ Haritaya sabitlendi."));
    console.log(chalk.dim(`  kaynak: ${target.kind} "${target.label}" (${target.id.slice(0, 12)})`));
    console.log(chalk.dim(`  düğüm:  ${result.nodeId}`));
  } finally {
    client.close();
  }
}

export async function haritaListeCommand(): Promise<void> {
  const client = await connectToDaemon();
  try {
    const graph = await client.getContextMap(500);
    const curated = graph.nodes
      .filter((n) => n.kind === "context" || n.kind === "group")
      .sort((a, b) => b.at - a.at);
    if (curated.length === 0) {
      console.log(
        chalk.dim("henüz haritaya sabitlenmiş/gruplanmış bir öğe yok — `symphony harita ekle <id>` ile ekle."),
      );
      return;
    }
    console.log(chalk.bold(`🗺 Bağlam haritası kürasyonu (${curated.length})`));
    for (const node of curated) {
      const tag = node.kind === "group" ? chalk.magenta("[GRUP]") : chalk.cyan("[BAĞLAM]");
      console.log(
        `  ${tag} ${node.label} ${chalk.dim(`· ${formatTime(node.at)} · ${node.id.slice(0, 8)}`)}`,
      );
      if (typeof node.meta.refKind === "string" && typeof node.meta.refId === "string") {
        console.log(chalk.dim(`         → ${node.meta.refKind} ${node.meta.refId.slice(0, 12)}`));
      }
    }
  } finally {
    client.close();
  }
}
