import { z } from "zod";

/**
 * Agent koşusu durum makinesi (PROTOKOL.md §5).
 *
 *   queued → thinking → executing_tool → thinking → ... → completed
 *                 ↘ awaiting_permission ↗                ↘ failed
 *                 ↘ awaiting_user ↗ (konuşmalı koşu, ADR-012)
 *      (her durumdan) → cancelled
 */
export const AGENT_RUN_STATES = [
  "queued",
  "thinking",
  "awaiting_permission",
  "awaiting_user",
  "executing_tool",
  "completed",
  "failed",
  "cancelled",
] as const;

export const AgentRunStateSchema = z.enum(AGENT_RUN_STATES);
export type AgentRunState = z.infer<typeof AgentRunStateSchema>;

/** Geçerli geçişler — bunların dışındaki her geçiş protokol ihlalidir. */
export const VALID_TRANSITIONS: Readonly<Record<AgentRunState, readonly AgentRunState[]>> = {
  queued: ["thinking", "cancelled"],
  thinking: [
    "executing_tool",
    "awaiting_permission",
    "awaiting_user",
    "completed",
    "failed",
    "cancelled",
  ],
  awaiting_permission: ["executing_tool", "thinking", "cancelled"],
  // Konuşmalı koşu (ADR-012): tur araçsız bitince park; agent.say → thinking, iptal → cancelled.
  awaiting_user: ["thinking", "cancelled"],
  executing_tool: ["thinking", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export const TERMINAL_STATES: readonly AgentRunState[] = ["completed", "failed", "cancelled"];

export function isTerminalState(state: AgentRunState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function canTransition(from: AgentRunState, to: AgentRunState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
