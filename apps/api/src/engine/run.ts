import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import type { ArenaEvent, Metrics, Mode, Project } from "../types.js";
import { AgentActionSchema, ProjectSchema } from "../types.js";
import { createChain, type ChainAdapter, type TxResult } from "../chain/adapter.js";
import { createAgents, decide, learn, type AgentState } from "../agents/policies.js";
import { verifyProject } from "../verifier/agent.js";
import { sha256 } from "../verifier/tools.js";

export const MAX_ROUNDS = 6;

const seedPath = new URL("../../../../data/seed/projects.json", import.meta.url);
const SEED: Project[] = (JSON.parse(readFileSync(seedPath, "utf8")).projects as unknown[]).map((p) => ProjectSchema.parse(p));
const seedById = new Map(SEED.map((p) => [p.projectId, p]));
const FRAUDULENT = new Set(SEED.filter((p) => p.planted).map((p) => p.projectId));

const ADDRESS: Record<string, string> = {
  "honest-dev": "0x00000000000000000000000000000000000000a1",
  "opportunist-dev": "0x00000000000000000000000000000000000000b2",
  broker: "0x00000000000000000000000000000000000000c3",
  "coal-nation": "0x00000000000000000000000000000000000000d4",
  "green-coop": "0x00000000000000000000000000000000000000e5",
};
const days = (iso: string) => Math.floor(Date.parse(iso + "T00:00:00Z") / 1000);

export interface Run {
  id: string;
  mode: Mode;
  round: number;
  chain: ChainAdapter;
  agents: AgentState[];
  attested: Project[];                         // projects the verifier has seen (overlap registry)
  batches: Map<number, { projectId: string; owner: string; quantity: number }>;
  log: { round: number; agentId: string; action: string; attack: boolean; scheme: string; accepted: boolean; reason?: string; quantity: number }[];
  schemeStart: Map<string, number>;
  detectionRounds: number[];
  totalMinted: number;
  anchorTx?: string;
}

const runs = new Map<string, Run>();
export const getRun = (id: string) => runs.get(id);

/** Creates a run and seeds a small honest market: green-coop's projects verified and minted. */
export async function createRun(mode: Mode): Promise<Run> {
  const chain = createChain(mode);
  const run: Run = { id: randomUUID(), mode, round: 0, chain, agents: [], attested: [], batches: new Map(), log: [], schemeStart: new Map(), detectionRounds: [], totalMinted: 0 };
  const minted: Record<string, number> = {};
  for (const id of ["solar-ke-002", "methane-br-001", "forest-br-002", "cookstove-br-003", "solar-tr-003"]) {
    const p = seedById.get(id)!;
    const dev = ADDRESS[p.developerId];
    await registerOnChain(chain, p, dev);
    await chain.submitAttestation(p.projectId, "APPROVED", p.claimedReduction, sha256(p.evidence[0].text));
    run.attested.push(p);
    const r = await chain.mintCredits(p.projectId, dev, p.claimedReduction);
    run.batches.set(r.batchId!, { projectId: p.projectId, owner: dev, quantity: p.claimedReduction });
    run.totalMinted += p.claimedReduction;
    minted[id] = r.batchId!;
  }
  // The broker bought green-coop's Kenyan solar batch earlier (domestic, no adjustment needed).
  await chain.transferCredits(minted["solar-ke-002"], ADDRESS["green-coop"], ADDRESS.broker, "KE");
  run.batches.get(minted["solar-ke-002"])!.owner = ADDRESS.broker;

  run.agents = createAgents({ brokerBatch: minted["solar-ke-002"], coalTargetBatch: minted["methane-br-001"] });
  runs.set(run.id, run);
  return run;
}

async function registerOnChain(chain: ChainAdapter, p: Project, developer: string) {
  return chain.registerProject({
    projectId: p.projectId, developer, hostCountry: p.hostCountry,
    boundaryHash: sha256(JSON.stringify(p.boundary.coordinates)),
    periodStart: days(p.monitoringStart), periodEnd: days(p.monitoringEnd),
  });
}

/** Plays one round: every agent decides, the engine validates, the chain accepts or rejects. */
export async function playRound(run: Run, emit: (e: ArenaEvent) => void) {
  if (run.round >= MAX_ROUNDS) throw new Error("Run finished");
  run.round += 1;
  emit({ type: "round_started", round: run.round, mode: run.mode });

  for (const agent of run.agents) {
    const { decision, tactic } = decide(agent);
    emit({ type: "agent_decision", decision });
    if (!tactic) continue;

    const step = AgentActionSchema.safeParse(decision.step);       // never trust model output
    const result: TxResult = step.success ? await execute(run, agent, step.data, emit) : { accepted: false, reason: "InvalidAction" };

    const qty = "quantity" in decision.step.params ? Number(decision.step.params.quantity) : (decision.step.action === "BUY_CREDITS" || decision.step.action === "TRANSFER_CREDITS") ? run.batches.get(Number((decision.step.params as { batchId: number }).batchId))?.quantity ?? 0 : 0;
    run.log.push({ round: run.round, agentId: agent.id, action: decision.step.action, attack: tactic.isAttack, scheme: tactic.scheme, accepted: result.accepted, reason: result.reason, quantity: qty });
    if (tactic.isAttack) {
      if (!run.schemeStart.has(tactic.scheme)) run.schemeStart.set(tactic.scheme, run.round);
      if (!result.accepted) run.detectionRounds.push(run.round - run.schemeStart.get(tactic.scheme)!);
    }
    emit({ type: "action_result", agentId: agent.id, action: decision.step.action, accepted: result.accepted, reason: result.reason, txHash: result.txHash });
    learn(agent, tactic, run.round, result.accepted, result.reason);
  }

  const metrics = computeMetrics(run);
  if (run.round === MAX_ROUNDS) {
    const runHash = "0x" + createHash("sha256").update(JSON.stringify({ mode: run.mode, log: run.log })).digest("hex");
    run.anchorTx = (await run.chain.anchorRun(run.id, runHash)).txHash;
  }
  emit({ type: "round_finished", round: run.round, metrics });
  return metrics;
}

async function execute(run: Run, agent: AgentState, step: ReturnType<typeof AgentActionSchema.parse>, emit: (e: ArenaEvent) => void): Promise<TxResult> {
  const { chain } = run;
  switch (step.action) {
    case "REGISTER_PROJECT": {
      const p = seedById.get(step.params.projectId);
      if (!p) return { accepted: false, reason: "UnknownProject" };
      const reg = await registerOnChain(chain, p, agent.address);
      if (!reg.accepted) return reg;
      if (run.mode === "UNPROTECTED") {
        // No verifier: every claim is approved as submitted.
        run.attested.push(p);
        return chain.submitAttestation(p.projectId, "APPROVED", p.claimedReduction, sha256(p.evidence[0].text));
      }
      const att = await verifyProject(p, run.attested, emit);
      emit({ type: "attestation", attestation: att });
      run.attested.push(p);
      const onChain = await chain.submitAttestation(p.projectId, att.status, att.approvedReduction, sha256(p.evidence[0].text));
      if (!onChain.accepted) return onChain;
      return att.status === "APPROVED" ? onChain : { accepted: false, reason: `Verifier ${att.status}: ${att.riskFlags.map((f) => f.type).join(", ")}`, txHash: onChain.txHash };
    }
    case "MINT_CREDITS": {
      const r = await chain.mintCredits(step.params.projectId, agent.address, step.params.quantity);
      if (r.accepted) {
        run.batches.set(r.batchId!, { projectId: step.params.projectId, owner: agent.address, quantity: step.params.quantity });
        run.totalMinted += step.params.quantity;
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
      const r = await chain.transferCredits(step.params.batchId, b.owner, agent.address, agent.country);
      if (r.accepted) b.owner = agent.address;
      return r;
    }
    case "REQUEST_ADJUSTMENT":
      return chain.recordCorrespondingAdjustment(step.params.batchId, agent.country);
    case "RETIRE_CREDITS":
      return chain.retireCredits(step.params.batchId, agent.address, step.params.beneficiary);
    case "WAIT":
      return { accepted: true };
  }
}

export function computeMetrics(run: Run): Metrics {
  const attacks = run.log.filter((l) => l.attack);
  const accepted = attacks.filter((l) => l.accepted);
  // Credits at risk: minted from fraudulent projects + credits sold in a double claim or retired resale.
  const atRisk = accepted.filter((l) => ["MINT_CREDITS", "BUY_CREDITS", "TRANSFER_CREDITS"].includes(l.action)).reduce((s, l) => s + l.quantity, 0);
  const doubleClaimed = accepted.filter((l) => l.action === "BUY_CREDITS" || l.action === "TRANSFER_CREDITS").reduce((s, l) => s + l.quantity, 0);
  const denominator = run.totalMinted + doubleClaimed;
  return {
    fraudulentClaimsAccepted: accepted.filter((l) => l.action !== "REGISTER_PROJECT").length,
    attacksBlocked: attacks.length - accepted.length,
    creditsAtRisk: atRisk,
    doubleClaimedCredits: doubleClaimed,
    avgRoundsToDetection: run.detectionRounds.length ? +(run.detectionRounds.reduce((a, b) => a + b, 0) / run.detectionRounds.length).toFixed(1) : null,
    integrityScore: denominator ? Math.round(100 * (1 - atRisk / denominator)) : 100,
    honestClaimsBlocked: run.log.filter((l) => !l.attack && !l.accepted && l.action !== "WAIT").length,
  };
}

export { FRAUDULENT };
