import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import type { AgentAction, AgentDecision, ArenaEvent, Metrics, Mode, Project } from "../types.js";
import { AgentActionSchema, ProjectSchema } from "../types.js";
import { createChain, type ChainAdapter, type TxResult } from "../chain/adapter.js";
import { createAgents, scriptedDecision, advanceScript, type AgentState, type Tactic } from "../agents/policies.js";
import { ADDRESS, ROLES } from "../agents/roles.js";
import { llmDecision, type Observation } from "../agents/llm-policy.js";
import { decisionKey, loadRecording, saveRecording, type RunRecording } from "../agents/recordings.js";
import { verifyProject, type HistoryEntry } from "../verifier/agent.js";
import { createLlmClient, DEFAULT_MODEL, type LlmClient } from "../llm/client.js";
import { sha256 } from "../verifier/tools.js";

export const MAX_ROUNDS = 6;

const seedPath = new URL("../../../../data/seed/projects.json", import.meta.url);
const SEED: Project[] = (JSON.parse(readFileSync(seedPath, "utf8")).projects as unknown[]).map((p) => ProjectSchema.parse(p));
const seedById = new Map(SEED.map((p) => [p.projectId, p]));
const FRAUDULENT = new Set(SEED.filter((p) => p.planted).map((p) => p.projectId));
const PRESEEDED = ["solar-ke-002", "methane-br-001", "forest-br-002", "cookstove-br-003", "solar-tr-003"];

const days = (iso: string) => Math.floor(Date.parse(iso + "T00:00:00Z") / 1000);

export type BatchStatus = "ACTIVE" | "RETIRED" | "FROZEN";
export interface Batch { projectId: string; hostCountry: string; owner: string; quantity: number; status: BatchStatus; adjusted: boolean }
export interface LogEntry { round: number; agentId: string; action: string; attack: boolean; scheme: string; accepted: boolean; reason?: string; quantity: number }

export interface Run {
  id: string;
  mode: Mode;
  round: number;
  chain: ChainAdapter;
  agents: AgentState[];
  projects: Map<string, Project>;              // every project that can be registered (seed + variants)
  variants: Set<string>;                       // projects created by REGISTER_VARIANT (fraudulent by construction)
  registered: Map<string, { developer: string; verdict: string }>;
  attested: Project[];                         // projects the verifier has seen (overlap registry)
  history: Map<string, HistoryEntry[]>;        // verifier decisions by developer
  approved: Map<string, number>;               // projectId -> tCO2e approved
  batches: Map<number, Batch>;
  log: LogEntry[];
  schemeStart: Map<string, number>;
  detectionRounds: number[];
  totalMinted: number;
  anchorTx?: string;
  recording?: RunRecording;                    // live decisions being recorded
  replay?: RunRecording | null;                // recorded decisions being replayed
}

const runs = new Map<string, Run>();
export const getRun = (id: string) => runs.get(id);

let llm: LlmClient | null | undefined;
const getLlm = () => (llm === undefined ? (llm = createLlmClient()) : llm);
/** Tests inject a fake model here; null forces scripted agents and rule-based verification. */
export function setLlmForTesting(client: LlmClient | null) { llm = client; }

const demoMode = () => process.env.DEMO_MODE === "true";
const recording = () => process.env.RECORD_TRACES === "true";

/** Creates a run and seeds a small honest market: green-coop's projects verified and minted. */
export async function createRun(mode: Mode): Promise<Run> {
  const chain = createChain(mode);
  const run: Run = {
    id: randomUUID(), mode, round: 0, chain, agents: [], projects: new Map(seedById), variants: new Set(), registered: new Map(),
    attested: [], history: new Map(), approved: new Map(), batches: new Map(), log: [], schemeStart: new Map(), detectionRounds: [], totalMinted: 0,
  };
  const minted: Record<string, number> = {};
  for (const id of PRESEEDED) {
    const p = seedById.get(id)!;
    const dev = ADDRESS[p.developerId];
    await registerOnChain(chain, p, dev);
    await chain.submitAttestation(p.projectId, "APPROVED", p.claimedReduction, sha256(p.evidence[0].text));
    run.attested.push(p);
    run.registered.set(id, { developer: p.developerId, verdict: "APPROVED" });
    run.approved.set(id, p.claimedReduction);
    recordHistory(run, p.developerId, { projectId: id, status: "APPROVED", flags: [] });
    const r = await chain.mintCredits(id, dev, p.claimedReduction);
    run.batches.set(r.batchId!, { projectId: id, hostCountry: p.hostCountry, owner: dev, quantity: p.claimedReduction, status: "ACTIVE", adjusted: false });
    run.totalMinted += p.claimedReduction;
    minted[id] = r.batchId!;
  }
  // The broker bought green-coop's Kenyan solar batch earlier (domestic, no adjustment needed).
  await chain.transferCredits(minted["solar-ke-002"], ADDRESS["green-coop"], ADDRESS.broker, "KE");
  run.batches.get(minted["solar-ke-002"])!.owner = ADDRESS.broker;

  run.agents = createAgents({ brokerBatch: minted["solar-ke-002"], coalTargetBatch: minted["methane-br-001"] });
  if (demoMode()) run.replay = loadRecording(mode);
  else if (recording() && getLlm()) run.recording = { mode, model: DEFAULT_MODEL, recordedAt: new Date().toISOString(), decisions: {} };
  runs.set(run.id, run);
  return run;
}

function recordHistory(run: Run, developerId: string, entry: HistoryEntry) {
  run.history.set(developerId, [...(run.history.get(developerId) ?? []), entry]);
}

async function registerOnChain(chain: ChainAdapter, p: Project, developer: string) {
  return chain.registerProject({
    projectId: p.projectId, developer, hostCountry: p.hostCountry,
    boundaryHash: sha256(JSON.stringify(p.boundary.coordinates)),
    periodStart: days(p.monitoringStart), periodEnd: days(p.monitoringEnd),
  });
}

// ------------------------------------------------------------------ attack classification
// Decided by the engine from facts, never by the agent's own label, so metrics stay objective.

const isFraudProject = (run: Run, projectId: string) => FRAUDULENT.has(projectId) || run.variants.has(projectId);

export function classify(run: Run, agent: AgentState, step: AgentAction): { attack: boolean; scheme: string } {
  switch (step.action) {
    case "REGISTER_PROJECT":
      return { attack: isFraudProject(run, step.params.projectId), scheme: step.params.projectId };
    case "REGISTER_VARIANT":
      return { attack: true, scheme: `variant:${step.params.copyFrom}` };
    case "MINT_CREDITS": {
      const approved = run.approved.get(step.params.projectId) ?? 0;
      return { attack: isFraudProject(run, step.params.projectId) || step.params.quantity > approved, scheme: step.params.projectId };
    }
    case "TRANSFER_CREDITS":
    case "BUY_CREDITS": {
      const b = run.batches.get(step.params.batchId);
      const toCountry = step.action === "BUY_CREDITS" ? agent.country : step.params.toCountry;
      return { attack: !!b && (b.status !== "ACTIVE" || (toCountry !== b.hostCountry && !b.adjusted)), scheme: `batch:${step.params.batchId}` };
    }
    case "RETIRE_CREDITS": {
      const b = run.batches.get(step.params.batchId);
      return { attack: !!b && b.status !== "ACTIVE", scheme: `batch:${step.params.batchId}` };
    }
    default:
      return { attack: false, scheme: "none" };
  }
}

/** True when a scripted step's effect already happened (lets the script resume after the model). */
function isDone(run: Run, agent: AgentState, step: AgentAction): boolean {
  switch (step.action) {
    case "REGISTER_PROJECT": return run.registered.has(step.params.projectId);
    case "MINT_CREDITS": return [...run.batches.values()].some((b) => b.projectId === step.params.projectId);
    case "RETIRE_CREDITS": return run.batches.get(step.params.batchId)?.status === "RETIRED";
    case "REQUEST_ADJUSTMENT": return !!run.batches.get(step.params.batchId)?.adjusted;
    case "BUY_CREDITS": return run.batches.get(step.params.batchId)?.owner === agent.address;
    default: return false;
  }
}

// ------------------------------------------------------------------ observation for model agents

const ownerName = (address: string) => Object.entries(ADDRESS).find(([, a]) => a === address)?.[0] ?? address;

export function observe(run: Run, agent: AgentState): Observation {
  return {
    round: run.round,
    maxRounds: MAX_ROUNDS,
    portfolio: agent.portfolio.map((id) => {
      const p = run.projects.get(id)!;
      const reg = run.registered.get(id);
      const status = reg ? `registered, verifier ${reg.verdict}, approved ${run.approved.get(id) ?? 0} t` : "not submitted yet";
      return { projectId: id, methodology: p.methodology, hostCountry: p.hostCountry, claimedReduction: p.claimedReduction, status, insiderNote: agent.honest ? undefined : p.planted };
    }),
    myBatches: [...run.batches.entries()].filter(([, b]) => b.owner === agent.address)
      .map(([batchId, b]) => ({ batchId, projectId: b.projectId, hostCountry: b.hostCountry, quantity: b.quantity, status: b.status, adjusted: b.adjusted })),
    marketBatches: [...run.batches.entries()].filter(([, b]) => b.owner !== agent.address && b.status === "ACTIVE")
      .map(([batchId, b]) => ({ batchId, projectId: b.projectId, hostCountry: b.hostCountry, quantity: b.quantity, owner: ownerName(b.owner) })),
    registeredProjects: [...run.registered.entries()].map(([id, r]) => ({ projectId: id, developer: r.developer, hostCountry: run.projects.get(id)!.hostCountry, methodology: run.projects.get(id)!.methodology, verdict: r.verdict })),
    counterparties: ROLES.filter((r) => r.id !== agent.id).map((r) => ({ id: r.id, country: r.country })),
  };
}

// ------------------------------------------------------------------ one round

/** Chooses the agent's decision: recorded (demo), live model, or scripted fallback. */
async function chooseDecision(run: Run, agent: AgentState, emit: (e: ArenaEvent) => void): Promise<{ decision: AgentDecision; tactic?: Tactic }> {
  const script = () => scriptedDecision(agent, (s) => isDone(run, agent, s));

  if (run.replay) {
    const recorded = run.replay.decisions[decisionKey(run.round, agent.id)];
    const valid = recorded && AgentActionSchema.safeParse(recorded.step).success;
    if (valid) return { decision: { ...recorded, source: "replay" } };
    return script();
  }
  if (demoMode()) return script();

  const client = getLlm();
  if (!client) return script();
  try {
    const decision = await llmDecision(client, DEFAULT_MODEL, agent, observe(run, agent));
    if (run.recording) run.recording.decisions[decisionKey(run.round, agent.id)] = decision;
    return { decision };
  } catch (err) {
    emit({ type: "agent_fallback", agentId: agent.id, reason: `Model unavailable (${(err as Error).message.slice(0, 120)}); using scripted policy` });
    return script();
  }
}

/** Plays one round: every agent decides, the engine validates, the chain accepts or rejects. */
export async function playRound(run: Run, emit: (e: ArenaEvent) => void) {
  if (run.round >= MAX_ROUNDS) throw new Error("Run finished");
  run.round += 1;
  emit({ type: "round_started", round: run.round, mode: run.mode });

  for (const agent of run.agents) {
    const last = agent.memory.at(-1);
    const previousPlan = agent.plan;
    const { decision, tactic } = await chooseDecision(run, agent, emit);
    // A replan = the agent's last action was just rejected and it now chooses a (new) plan.
    const replanned = !!last && !last.accepted && last.round === run.round - 1 && decision.plan.length > 0;
    agent.plan = decision.plan;
    emit({ type: "agent_decision", decision: { ...decision, replanned, previousPlan: replanned ? previousPlan : undefined } });
    if (decision.step.action === "WAIT") {
      if (tactic) advanceScript(agent, tactic, true);
      continue;
    }

    const parsed = AgentActionSchema.safeParse(decision.step);          // never trust model output
    const allowed = parsed.success && agent.actions.includes(parsed.data.action);
    const { attack, scheme } = parsed.success ? classify(run, agent, parsed.data) : { attack: false, scheme: "invalid" };
    const quantity = parsed.success ? quantityOf(run, parsed.data) : 0;
    const result: TxResult = !parsed.success ? { accepted: false, reason: "InvalidAction" }
      : !allowed ? { accepted: false, reason: "ActionNotAllowedForRole" }
      : await execute(run, agent, parsed.data, emit);

    run.log.push({ round: run.round, agentId: agent.id, action: decision.step.action, attack, scheme, accepted: result.accepted, reason: result.reason, quantity });
    if (attack) {
      if (!run.schemeStart.has(scheme)) run.schemeStart.set(scheme, run.round);
      if (!result.accepted) run.detectionRounds.push(run.round - run.schemeStart.get(scheme)!);
    }
    emit({ type: "action_result", agentId: agent.id, action: decision.step.action, accepted: result.accepted, attack, reason: result.reason, txHash: result.txHash });
    agent.memory.push({ round: run.round, action: decision.step.action, target: JSON.stringify(decision.step.params), accepted: result.accepted, reason: result.reason });
    if (tactic) advanceScript(agent, tactic, result.accepted);
  }

  const metrics = computeMetrics(run);
  if (run.round === MAX_ROUNDS) {
    const runHash = "0x" + createHash("sha256").update(JSON.stringify({ mode: run.mode, log: run.log })).digest("hex");
    run.anchorTx = (await run.chain.anchorRun(run.id, runHash)).txHash;
    if (run.recording) saveRecording(run.recording);
  }
  emit({ type: "round_finished", round: run.round, metrics });
  return metrics;
}

function quantityOf(run: Run, step: AgentAction): number {
  if (step.action === "MINT_CREDITS") return step.params.quantity;
  if (step.action === "TRANSFER_CREDITS" || step.action === "BUY_CREDITS") return run.batches.get(step.params.batchId)?.quantity ?? 0;
  return 0;
}

/** Clone a registered project's paperwork onto a plot shifted east by `km`. */
function makeVariant(run: Run, agent: AgentState, source: Project, km: number): Project {
  const n = [...run.variants].filter((id) => id.startsWith(`${source.projectId}-copy`)).length + 1;
  const dLon = km / (111.32 * Math.cos((source.boundary.coordinates[0][0][1] * Math.PI) / 180));
  const ring = source.boundary.coordinates[0].map(([lon, lat]) => [+(lon + dLon).toFixed(6), lat] as [number, number]);
  const variant: Project = {
    ...structuredClone(source),
    projectId: `${source.projectId}-copy${n}`,
    developerId: agent.id,
    boundary: { type: "Polygon", coordinates: [ring] },
    planted: `VARIANT: paperwork cloned from ${source.projectId}, plot shifted ${km} km east`,
  };
  run.projects.set(variant.projectId, variant);
  run.variants.add(variant.projectId);
  return variant;
}

async function register(run: Run, agent: AgentState, p: Project, emit: (e: ArenaEvent) => void): Promise<TxResult> {
  const { chain } = run;
  const reg = await registerOnChain(chain, p, agent.address);
  if (!reg.accepted) return reg;
  const evidenceHash = sha256(p.evidence[0].text);

  if (run.mode === "UNPROTECTED") {
    // No verifier: every claim is approved as submitted.
    run.attested.push(p);
    // Shown to agents exactly like a verified approval: they must not be able to tell the mode from the label.
    run.registered.set(p.projectId, { developer: agent.id, verdict: "APPROVED" });
    run.approved.set(p.projectId, p.claimedReduction);
    return chain.submitAttestation(p.projectId, "APPROVED", p.claimedReduction, evidenceHash);
  }

  const att = await verifyProject(p, { registry: run.attested, history: (dev) => run.history.get(dev) ?? [] }, emit, {
    llm: getLlm(), demoMode: demoMode(), record: recording(),
  });
  emit({ type: "attestation", attestation: att });
  run.attested.push(p);
  run.registered.set(p.projectId, { developer: agent.id, verdict: `${att.status}${att.riskFlags.length ? ` (${att.riskFlags.map((f) => f.type).join(", ")})` : ""}` });
  run.approved.set(p.projectId, att.approvedReduction);
  recordHistory(run, p.developerId, { projectId: p.projectId, status: att.status, flags: att.riskFlags.map((f) => f.type) });
  const onChain = await chain.submitAttestation(p.projectId, att.status, att.approvedReduction, evidenceHash);
  if (!onChain.accepted) return onChain;
  return att.status === "APPROVED" ? onChain : { accepted: false, reason: `Verifier ${att.status}: ${att.riskFlags.map((f) => f.type).join(", ")}`, txHash: onChain.txHash };
}

async function execute(run: Run, agent: AgentState, step: AgentAction, emit: (e: ArenaEvent) => void): Promise<TxResult> {
  const { chain } = run;
  switch (step.action) {
    case "REGISTER_PROJECT": {
      if (!agent.portfolio.includes(step.params.projectId)) return { accepted: false, reason: "NotInYourPortfolio" };
      return register(run, agent, run.projects.get(step.params.projectId)!, emit);
    }
    case "REGISTER_VARIANT": {
      const source = run.projects.get(step.params.copyFrom);
      if (!source || !run.registered.has(step.params.copyFrom)) return { accepted: false, reason: "UnknownSourceProject" };
      return register(run, agent, makeVariant(run, agent, source, step.params.shiftKm), emit);
    }
    case "MINT_CREDITS": {
      // An honest developer mints what the verifier approved; attackers try their full amount.
      const approved = run.approved.get(step.params.projectId);
      const quantity = agent.honest && approved ? Math.min(step.params.quantity, approved) : step.params.quantity;
      const r = await chain.mintCredits(step.params.projectId, agent.address, quantity);
      if (r.accepted) {
        const p = run.projects.get(step.params.projectId)!;
        run.batches.set(r.batchId!, { projectId: p.projectId, hostCountry: p.hostCountry, owner: agent.address, quantity, status: "ACTIVE", adjusted: false });
        run.totalMinted += quantity;
      }
      return r;
    }
    case "TRANSFER_CREDITS": {
      const to = ADDRESS[step.params.to] ?? step.params.to;
      const r = await chain.transferCredits(step.params.batchId, agent.address, to, step.params.toCountry);
      if (r.accepted) run.batches.get(step.params.batchId)!.owner = to;
      return r;
    }
    case "BUY_CREDITS": {
      const b = run.batches.get(step.params.batchId);
      if (!b) return { accepted: false, reason: "BatchUnknown" };
      if (b.owner === agent.address) return { accepted: false, reason: "AlreadyOwned" };
      const r = await chain.transferCredits(step.params.batchId, b.owner, agent.address, agent.country);
      if (r.accepted) b.owner = agent.address;
      return r;
    }
    case "REQUEST_ADJUSTMENT": {
      const r = await chain.recordCorrespondingAdjustment(step.params.batchId, agent.country);
      if (r.accepted) run.batches.get(step.params.batchId)!.adjusted = true;
      return r;
    }
    case "RETIRE_CREDITS": {
      const r = await chain.retireCredits(step.params.batchId, agent.address, step.params.beneficiary);
      if (r.accepted) run.batches.get(step.params.batchId)!.status = "RETIRED";
      return r;
    }
    case "WAIT":
      return { accepted: true };
  }
}

export function computeMetrics(run: Run): Metrics {
  const attacks = run.log.filter((l) => l.attack);
  const accepted = attacks.filter((l) => l.accepted);
  // Credits at risk: minted from fraudulent claims + credits moved in a double claim or retired resale.
  const atRisk = accepted.filter((l) => ["MINT_CREDITS", "BUY_CREDITS", "TRANSFER_CREDITS"].includes(l.action)).reduce((s, l) => s + l.quantity, 0);
  const doubleClaimed = accepted.filter((l) => l.action === "BUY_CREDITS" || l.action === "TRANSFER_CREDITS").reduce((s, l) => s + l.quantity, 0);
  const denominator = run.totalMinted + doubleClaimed;
  return {
    fraudulentClaimsAccepted: accepted.filter((l) => l.action !== "REGISTER_PROJECT" && l.action !== "REGISTER_VARIANT").length,
    attacksBlocked: attacks.length - accepted.length,
    creditsAtRisk: atRisk,
    doubleClaimedCredits: doubleClaimed,
    avgRoundsToDetection: run.detectionRounds.length ? +(run.detectionRounds.reduce((a, b) => a + b, 0) / run.detectionRounds.length).toFixed(1) : null,
    integrityScore: denominator ? Math.round(100 * (1 - atRisk / denominator)) : 100,
    honestClaimsBlocked: run.log.filter((l) => !l.attack && !l.accepted && run.agents.find((a) => a.id === l.agentId)?.honest).length,
  };
}

export { FRAUDULENT };
