import type { RoadmapPhase } from "@symphony/shared";

/**
 * Yol haritası ayrıştırıcı (ADR-015 Karar 3, Dilim P2). SAF: dosya G/Ç yok, yalnız
 * metin → yapı. Sözleşme: `### başlık` = faz (başlıkta `✅` geçiyorsa `state:"done"`),
 * `- [ ]/- [x]/- [~]` = adım. `done`/`total` ilerleme çubuğu, `state` fazın genel rengi
 * içindir. Bu kalıba uyan HERHANGİ bir ROADMAP.md'de çalışır.
 */

const PHASE_HEADING = /^###\s+(.+)$/;
const STEP_LINE = /^-\s*\[([ xX~])\]/;

interface MutablePhase {
  title: string;
  headingDone: boolean;
  done: number;
  total: number;
  hasInProgress: boolean;
}

function deriveState(phase: MutablePhase): RoadmapPhase["state"] {
  if (phase.headingDone) return "done";
  if (phase.hasInProgress || (phase.done > 0 && phase.done < phase.total)) return "in_progress";
  if (phase.total > 0 && phase.done === phase.total) return "done";
  return "todo";
}

export function parseRoadmap(markdown: string): RoadmapPhase[] {
  const phases: MutablePhase[] = [];
  let current: MutablePhase | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const headingMatch = PHASE_HEADING.exec(rawLine);
    if (headingMatch !== null) {
      const title = (headingMatch[1] ?? "").trim();
      current = { title, headingDone: title.includes("✅"), done: 0, total: 0, hasInProgress: false };
      phases.push(current);
      continue;
    }
    if (current === null) continue;
    const stepMatch = STEP_LINE.exec(rawLine.trimStart());
    if (stepMatch === null) continue;
    const marker = stepMatch[1] ?? "";
    current.total += 1;
    if (marker === "x" || marker === "X") current.done += 1;
    else if (marker === "~") current.hasInProgress = true;
  }

  return phases.map((phase) => ({
    title: phase.title,
    done: phase.done,
    total: phase.total,
    state: deriveState(phase),
  }));
}
