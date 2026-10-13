import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Attestation, Project } from "../types.js";

/**
 * Recorded verifier investigations. A live LLM run (RECORD_TRACES=true) saves each trace;
 * demo mode replays them, so the recorded demo shows real model reasoning but never depends
 * on a live API call. A trace is only replayed for the exact same submission and registry.
 */
export interface TraceStep { tool: string; reason: string; result: unknown }
export interface Trace { key: string; model: string; recordedAt: string; steps: TraceStep[]; attestation: Attestation }

const DIR = new URL("../../../../data/traces/verifier/", import.meta.url);

export function traceKey(project: Project, registry: Project[]): string {
  const ids = registry.map((p) => p.projectId).filter((id) => id !== project.projectId).sort();
  return createHash("sha256").update(JSON.stringify({ project, ids })).digest("hex").slice(0, 16);
}

export function loadTrace(projectId: string, key: string): Trace | null {
  const file = new URL(`${projectId}.${key}.json`, DIR);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Trace) : null;
}

export function saveTrace(projectId: string, trace: Trace): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(new URL(`${projectId}.${trace.key}.json`, DIR), JSON.stringify(trace, null, 2));
}
