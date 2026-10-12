import type { AgentDecision } from "../types.js";

/**
 * Agents (section 8). Each keeps a short plan plus memory of results, takes one step per round,
 * and replans after a rejection.
 *
 * These deterministic policies are the FALLBACK and the DEMO_MODE behaviour: reproducible, no LLM.
 * TODO (Phase 4): an LLM policy per agent that receives { goal, plan, memory, visible market state }
 * and returns AgentDecisionSchema JSON; on timeout or invalid output, call these instead.
 */

export interface Memory { round: number; action: string; target: string; accepted: boolean; reason?: string }

export interface AgentState {
  id: string;
  name: string;
  goal: string;
  address: string;            // simulated identity; the backend relays its txs as operator
  country: string;
  memory: Memory[];
  plan: string[];
  tactics: Tactic[];          // remaining moves, in order
  pending?: Tactic;           // follow-up step queued by a successful move
}

export interface Tactic {
  decision: AgentDecision["step"];
  isAttack: boolean;
  scheme: string;             // groups the steps of one fraud for metrics
  note: string;               // plan line shown in the Arena
  onSuccess?: Tactic;         // next step if this one is accepted
  onReject?: Tactic[];        // replacement tactics if rejected (replanning)
}

const t = (step: AgentDecision["step"], note: string, scheme: string, isAttack: boolean, extra: Partial<Tactic> = {}): Tactic =>
  ({ decision: step, note, scheme, isAttack, ...extra });

export function createAgents(batches: { brokerBatch: number; coalTargetBatch: number }): AgentState[] {
  const { brokerBatch, coalTargetBatch } = batches;
  return [
    {
      id: "honest-dev", name: "Honest Developer", goal: "Earn revenue from real, verified reductions",
      address: "0x00000000000000000000000000000000000000a1", country: "TR", memory: [], plan: [],
      tactics: [
        t({ action: "REGISTER_PROJECT", params: { projectId: "forest-tr-001" } }, "Register the Antalya pine project", "honest-1", false,
          { onSuccess: t({ action: "MINT_CREDITS", params: { projectId: "forest-tr-001", quantity: 300 } }, "Mint the verified 300 t", "honest-1", false) }),
        t({ action: "REGISTER_PROJECT", params: { projectId: "cookstove-ke-001" } }, "Register the Kibera cookstove project", "honest-2", false,
          { onSuccess: t({ action: "MINT_CREDITS", params: { projectId: "cookstove-ke-001", quantity: 150 } }, "Mint the verified 150 t", "honest-2", false) }),
        t({ action: "REGISTER_PROJECT", params: { projectId: "forest-tr-005" } }, "Register the riverside corridor next door", "honest-3", false,
          { onSuccess: t({ action: "MINT_CREDITS", params: { projectId: "forest-tr-005", quantity: 250 } }, "Mint the verified 250 t", "honest-3", false) }),
      ],
    },
    {
      id: "opportunist-dev", name: "Opportunist Developer", goal: "Maximise credits issued, whatever it takes",
      address: "0x00000000000000000000000000000000000000b2", country: "TR", memory: [], plan: [],
      tactics: [
        t({ action: "REGISTER_PROJECT", params: { projectId: "forest-tr-002", copyFrom: "forest-tr-001", shiftKm: 0.5 } }, "Claim an overlapping plot next to a verified forest", "overlap", true,
          { onSuccess: t({ action: "MINT_CREDITS", params: { projectId: "forest-tr-002", quantity: 300 } }, "Mint 300 t from the overlapping plot", "overlap", true),
            onReject: [t({ action: "MINT_CREDITS", params: { projectId: "forest-tr-002", quantity: 300 } }, "Try minting anyway before attestation clears", "mint-early", true)] }),
        t({ action: "REGISTER_PROJECT", params: { projectId: "cookstove-ke-004" } }, "Reuse another project's cookstove report", "reuse", true,
          { onSuccess: t({ action: "MINT_CREDITS", params: { projectId: "cookstove-ke-004", quantity: 150 } }, "Mint 150 t on copied evidence", "reuse", true) }),
        t({ action: "REGISTER_PROJECT", params: { projectId: "forest-br-004" } }, "Inflate the baseline on a new forest claim", "inflate", true,
          { onSuccess: t({ action: "MINT_CREDITS", params: { projectId: "forest-br-004", quantity: 2400 } }, "Mint 2,400 t at mature-forest rates", "inflate", true) }),
      ],
    },
    {
      id: "broker", name: "Credit Broker", goal: "Maximise resale profit",
      address: "0x00000000000000000000000000000000000000c3", country: "KE", memory: [], plan: [],
      tactics: [
        t({ action: "RETIRE_CREDITS", params: { batchId: brokerBatch, beneficiary: "Client A offset claim" } }, "Retire a batch for a paying client", "retire-legit", false,
          { onSuccess: t({ action: "TRANSFER_CREDITS", params: { batchId: brokerBatch, to: "coal-nation", toCountry: "KE" } }, "Sell the same retired batch again", "resell-retired", true) }),
        t({ action: "REGISTER_PROJECT", params: { projectId: "solar-br-005" } }, "Clone a solar project's paperwork in another country", "lookalike", true,
          { onSuccess: t({ action: "MINT_CREDITS", params: { projectId: "solar-br-005", quantity: 800 } }, "Mint 800 t from the clone", "lookalike", true) }),
      ],
    },
    {
      id: "coal-nation", name: "Coal Nation", goal: "Meet its national target as cheaply as possible",
      address: "0x00000000000000000000000000000000000000d4", country: "ZZ", memory: [], plan: [],
      tactics: [
        t({ action: "WAIT", params: {} }, "Watch credit prices for a round", "wait", false),
        t({ action: "BUY_CREDITS", params: { batchId: coalTargetBatch } }, "Buy Brazilian methane credits and count them at home", "double-claim", true,
          { onReject: [
            t({ action: "REQUEST_ADJUSTMENT", params: { batchId: coalTargetBatch } }, "Ask the host country for a corresponding adjustment", "compliant-buy", false,
              { onSuccess: t({ action: "BUY_CREDITS", params: { batchId: coalTargetBatch } }, "Buy again, now properly adjusted", "compliant-buy", false) }),
          ] }),
      ],
    },
  ];
}

/** Next decision for an agent: queued follow-up first, then its next tactic, else wait. */
export function decide(agent: AgentState): { decision: AgentDecision; tactic?: Tactic } {
  const tactic = agent.pending ?? agent.tactics[0];
  agent.plan = [tactic, ...(agent.pending ? agent.tactics : agent.tactics.slice(1))].filter(Boolean).slice(0, 3).map((x) => x!.note);
  if (!tactic) {
    return { decision: { agentId: agent.id, plan: [], step: { action: "WAIT", params: {} }, reason: "No moves left that look profitable." } };
  }
  return { decision: { agentId: agent.id, plan: agent.plan, step: tactic.decision, reason: tactic.note }, tactic };
}

/** Update memory and plan after the engine reports the result. */
export function learn(agent: AgentState, tactic: Tactic, round: number, accepted: boolean, reason?: string) {
  if (agent.pending === tactic) agent.pending = undefined;
  else agent.tactics.shift();
  agent.memory.push({ round, action: tactic.decision.action, target: JSON.stringify(tactic.decision.params), accepted, reason });
  if (accepted && tactic.onSuccess) agent.pending = tactic.onSuccess;
  if (!accepted && tactic.onReject) agent.tactics.unshift(...tactic.onReject);
}
