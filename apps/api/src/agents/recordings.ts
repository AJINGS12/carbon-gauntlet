import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { AgentDecision, Mode } from "../types.js";
import { tracesDir } from "../traces-dir.js";

/**
 * Recorded agent decisions from a live run. Demo mode replays them round by round; together
 * with recorded verifier traces this reproduces a real model-driven run with no API calls.
 * If a recorded decision is missing or no longer valid, the engine uses the scripted policy.
 */
export interface RunRecording {
  mode: Mode;
  model: string;
  recordedAt: string;
  decisions: Record<string, AgentDecision>;
  /** Transaction hashes from replaying this run on a real chain (sim --demo --save-txs), keyed like decisions. */
  chain?: { network: string; registry: string; savedAt: string; txs: Record<string, string>; anchorTx?: string };
}

const file = (mode: Mode) => new URL(`${mode.toLowerCase()}.json`, tracesDir("runs"));
export const decisionKey = (round: number, agentId: string) => `r${round}:${agentId}`;

export function loadRecording(mode: Mode): RunRecording | null {
  return existsSync(file(mode)) ? (JSON.parse(readFileSync(file(mode), "utf8")) as RunRecording) : null;
}

export function saveRecording(rec: RunRecording): void {
  mkdirSync(tracesDir("runs"), { recursive: true });
  writeFileSync(file(rec.mode), JSON.stringify(rec, null, 2));
}
