// Types mirror apps/api/src/types.ts (kept in sync by hand; the API is the source of truth).
export const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
export const EXPLORER = import.meta.env.VITE_EXPLORER_URL ?? "https://sepolia.basescan.org";
export const REPO_URL = import.meta.env.VITE_REPO_URL ?? "https://github.com/AJINGS12/carbon-gauntlet";

export type Mode = "UNPROTECTED" | "PROTECTED";
export const MODES: Mode[] = ["UNPROTECTED", "PROTECTED"];

export interface Metrics {
  fraudulentClaimsAccepted: number;
  attacksBlocked: number;
  creditsAtRisk: number;
  doubleClaimedCredits: number;
  avgRoundsToDetection: number | null;
  integrityScore: number;
  honestClaimsBlocked: number;
}

export interface Polygon { type: "Polygon"; coordinates: [number, number][][] }
export interface PublicProject {
  projectId: string;
  developerId: string;
  hostCountry: string;
  methodology: "reforestation" | "cookstoves" | "solar" | "methane-capture";
  claimedReduction: number;
  boundary: Polygon;
}

export interface LedgerRow {
  batchId: number;
  projectId: string;
  hostCountry: string;
  owner: string;
  quantity: number;
  status: "ACTIVE" | "RETIRED" | "FROZEN";
  adjusted: boolean;
  atRisk: boolean;
}

export interface Role { id: string; name: string; honest: boolean; country: string; goal: string; portfolio: string[] }

export interface Deployment {
  recording: { model: string; recordedAt: string } | null;
  chain: { network: string; registry: string; anchorTx?: string } | null;
}

export interface ArenaInfo {
  maxRounds: number;
  demoMode: boolean;
  chainMode: string;
  roles: Role[];
  projects: PublicProject[];
  preseeded: string[];
  deployments: Record<Mode, Deployment>;
  /** Final result of the recorded run (demo mode), for the home page. */
  result: Record<Mode, { metrics: Metrics; ledger: LedgerRow[] }> | null;
  /** Live runs (Claude plays now) need an access code and are capped per day. */
  live?: { available: boolean; remainingToday: number };
  /** Live runs are saved (persistent: survives restarts) and their fingerprint anchored on-chain. */
  records?: { persistent: boolean; anchored: boolean };
}

export type Action =
  | { action: "REGISTER_PROJECT"; params: { projectId: string } }
  | { action: "REGISTER_VARIANT"; params: { copyFrom: string; shiftKm: number } }
  | { action: "MINT_CREDITS"; params: { projectId: string; quantity: number } }
  | { action: "TRANSFER_CREDITS"; params: { batchId: number; to: string; toCountry: string } }
  | { action: "RETIRE_CREDITS"; params: { batchId: number; beneficiary: string } }
  | { action: "BUY_CREDITS"; params: { batchId: number } }
  | { action: "REQUEST_ADJUSTMENT"; params: { batchId: number } }
  | { action: "WAIT"; params: Record<string, never> };

export interface Decision {
  agentId: string;
  plan: string[];
  step: Action;
  reason: string;
  source?: "llm" | "replay" | "script";
  replanned?: boolean;
  previousPlan?: string[];
}

export interface RiskFlag { type: string; severity: "LOW" | "MEDIUM" | "HIGH"; relatedProjectId?: string; detail: string; source?: "llm" | "rule" }
export interface Attestation {
  projectId: string;
  status: "APPROVED" | "REVIEW_REQUIRED" | "REJECTED";
  confidence: number;
  riskFlags: RiskFlag[];
  approvedReduction: number;
  explanation: string;
  engine?: "llm" | "replay" | "rules";
  guardrailOverride?: boolean;
}

export type ArenaEvent =
  | { type: "round_started"; round: number; mode: Mode }
  | { type: "agent_decision"; decision: Decision }
  | { type: "verifier_step"; projectId: string; step: number; tool: string; reason: string; result: unknown; source: "llm" | "replay" | "rules" }
  | { type: "attestation"; attestation: Attestation }
  | { type: "action_result"; agentId: string; action: string; accepted: boolean; attack: boolean; reason?: string; txHash?: string; network?: string }
  | { type: "agent_fallback"; agentId: string; reason: string }
  | { type: "project_submitted"; project: PublicProject; variantOf?: string }
  | { type: "round_finished"; round: number; metrics: Metrics; ledger: LedgerRow[] }
  | { type: "error"; message: string };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    let message = text.slice(0, 200);
    try { message = (JSON.parse(text) as { error?: string }).error ?? message; } catch { /* not JSON */ }
    throw new Error(message || `The API answered ${res.status}.`);
  }
  return res.json() as Promise<T>;
}

let arenaInfo: Promise<ArenaInfo> | undefined;
/** Fetched once per page load and shared by the home page and the Arena. */
export const fetchArena = () => (arenaInfo ??= fetch(`${API}/arena`).then((r) => json<ArenaInfo>(r)).catch((err) => { arenaInfo = undefined; throw err; }));

export const createRun = (mode: Mode) =>
  fetch(`${API}/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) })
    .then((r) => json<{ runId: string; maxRounds: number; metrics: Metrics; ledger: LedgerRow[] }>(r));

/** Plays one round, calling onEvent for each event the moment it arrives (Server-Sent Events over a POST). */
export async function playRoundStream(runId: string, onEvent: (e: ArenaEvent) => void): Promise<void> {
  const res = await fetch(`${API}/runs/${runId}/rounds`, { method: "POST" });
  if (!res.ok || !res.body) throw new Error(`The API answered ${res.status} when playing a round.`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) if (part.startsWith("data: ")) onEvent(JSON.parse(part.slice(6)) as ArenaEvent);
  }
}

export interface LiveStart {
  maxRounds: number;
  recordId: string;
  UNPROTECTED: { runId: string; metrics: Metrics; ledger: LedgerRow[] };
  PROTECTED: { runId: string; metrics: Metrics; ledger: LedgerRow[] };
  remainingToday: number;
}
/** Starts a live run in both markets. Needs the access code. */
export const startLive = (code: string) =>
  fetch(`${API}/live`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) })
    .then((r) => json<LiveStart>(r));

export const txUrl = (hash?: string) => (hash?.startsWith("0x") && hash.length === 66 ? `${EXPLORER}/tx/${hash}` : undefined);
export const addressUrl = (address: string) => `${EXPLORER}/address/${address}`;

export type TrickId = "copy-report" | "claim-land" | "inflate" | "resell-retired" | "no-adjustment" | "sweet-talk";
export interface TrickRequest { trick: TrickId; copyFrom?: string; shiftKm?: number; note?: string }

/** Runs one trick in a fresh open market and a fresh protected market (rule checks only, no AI calls). */
export const tryTrick = (req: TrickRequest) =>
  fetch(`${API}/sandbox`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) })
    .then((r) => json<Record<Mode, ArenaEvent[]>>(r));

// ---------------------------------------------------------------- saved live runs

export type MarketStart = Record<Mode, { metrics: Metrics; ledger: LedgerRow[] }>;
export interface RecordBody { id: string; createdAt: string; model: string; start: MarketStart; events: Record<Mode, ArenaEvent[]> }
export interface RecordMeta {
  id: string;
  createdAt: string;
  model: string;
  metrics: Record<Mode, Metrics>;
  digest: string;
  anchorTx?: string;
  registry?: string;
}
export type AnchorState = "off" | "pending" | "done" | "failed";
export type RecordView =
  | { status: "playing"; runIds: Record<Mode, string>; round: number; busy: boolean; body: RecordBody }
  | ({ id: string; status: "saving" | "saved" | "failed"; anchor: AnchorState } & Partial<RecordMeta>);

export const fetchRecords = () => fetch(`${API}/records`).then((r) => json<{ records: RecordMeta[] }>(r)).then((d) => d.records);
export const fetchRecord = (id: string) => fetch(`${API}/records/${encodeURIComponent(id)}`).then((r) => json<RecordView>(r));
/** The exact stored text of a saved run: what its fingerprint was computed from. */
export async function fetchRecordText(id: string): Promise<string> {
  const res = await fetch(`${API}/records/${encodeURIComponent(id)}/body`);
  if (!res.ok) await json(res);
  return res.text();
}

export async function sha256Hex(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return "0x" + [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const RPC_URL = import.meta.env.VITE_RPC_URL ?? "https://sepolia.base.org";
/** IDs up to 31 characters are stored on-chain as readable text, right-padded to 32 bytes. */
const idToBytes32 = (id: string) => [...new TextEncoder().encode(id)].map((b) => b.toString(16).padStart(2, "0")).join("").padEnd(64, "0");
/** Reads registry.runAnchors(id) straight from the chain, without going through our API. */
export async function readAnchor(registry: string, id: string): Promise<string | null> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: registry, data: "0x050db52f" + idToBytes32(id) }, "latest"] }),
  });
  const out = (await res.json()) as { result?: string; error?: { message: string } };
  if (out.error) throw new Error(out.error.message);
  return out.result && !/^0x0*$/.test(out.result) ? out.result.toLowerCase() : null;
}

/** Link to a saved run in the Arena. */
export const recordLink = (id: string) => `${window.location.origin}/arena?run=${encodeURIComponent(id)}`;
