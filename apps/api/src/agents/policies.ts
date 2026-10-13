import type { AgentAction, AgentDecision } from "../types.js";
import { ROLES, type Role } from "./roles.js";

/**
 * Scripted fallback policy. Used when no LLM is configured, when a model call fails or returns
 * an invalid action, and in demo mode when no recorded run exists. It plays the reference story
 * (one fraud per tactic, a visible replan by Coal Nation), so the demo works with no API at all.
 */

export interface Memory { round: number; action: string; target: string; accepted: boolean; reason?: string }

export interface Tactic {
  step: AgentAction;
  note: string;               // plan line shown in the Arena
  onSuccess?: Tactic;         // follow-up if accepted
  onReject?: Tactic[];        // replacement tactics if rejected (replanning)
}

export interface AgentState extends Role {
  memory: Memory[];
  plan: string[];
  tactics: Tactic[];          // scripted queue (fallback only)
  pending?: Tactic;
}

const t = (step: AgentAction, note: string, extra: Partial<Tactic> = {}): Tactic => ({ step, note, ...extra });

function scriptFor(role: Role, b: { brokerBatch: number; coalTargetBatch: number }): Tactic[] {
  switch (role.id) {
    case "honest-dev":
      return [
        t({ action: "REGISTER_PROJECT", params: { projectId: "forest-tr-001" } }, "Register the Antalya pine project",
          { onSuccess: t({ action: "MINT_CREDITS", params: { projectId: "forest-tr-001", quantity: 300 } }, "Mint the verified credits") }),
        t({ action: "REGISTER_PROJECT", params: { projectId: "cookstove-ke-001" } }, "Register the Kibera cookstove project",
          { onSuccess: t({ action: "MINT_CREDITS", params: { projectId: "cookstove-ke-001", quantity: 150 } }, "Mint the verified credits") }),
        t({ action: "REGISTER_PROJECT", params: { projectId: "forest-tr-005" } }, "Register the riverside corridor next door",
          { onSuccess: t({ action: "MINT_CREDITS", params: { projectId: "forest-tr-005", quantity: 250 } }, "Mint the verified credits") }),
      ];
    case "opportunist-dev":
      return [
        t({ action: "REGISTER_PROJECT", params: { projectId: "forest-tr-002" } }, "Claim an overlapping plot next to a verified forest",
          { onSuccess: t({ action: "MINT_CREDITS", params: { projectId: "forest-tr-002", quantity: 300 } }, "Mint 300 t from the overlapping plot"),
            onReject: [t({ action: "MINT_CREDITS", params: { projectId: "forest-tr-002", quantity: 300 } }, "Try minting anyway before attestation clears")] }),
        t({ action: "REGISTER_PROJECT", params: { projectId: "cookstove-ke-004" } }, "Reuse another project's cookstove report",
          { onSuccess: t({ action: "MINT_CREDITS", params: { projectId: "cookstove-ke-004", quantity: 150 } }, "Mint 150 t on copied evidence") }),
        t({ action: "REGISTER_PROJECT", params: { projectId: "forest-br-004" } }, "Inflate the baseline on a new forest claim",
          { onSuccess: t({ action: "MINT_CREDITS", params: { projectId: "forest-br-004", quantity: 2400 } }, "Mint 2,400 t at mature-forest rates") }),
      ];
    case "broker":
      return [
        t({ action: "RETIRE_CREDITS", params: { batchId: b.brokerBatch, beneficiary: "Client A offset claim" } }, "Retire a batch for a paying client",
          { onSuccess: t({ action: "TRANSFER_CREDITS", params: { batchId: b.brokerBatch, to: "coal-nation", toCountry: "KE" } }, "Sell the same retired batch again") }),
        t({ action: "REGISTER_PROJECT", params: { projectId: "solar-br-005" } }, "Clone a solar project's paperwork in another country",
          { onSuccess: t({ action: "MINT_CREDITS", params: { projectId: "solar-br-005", quantity: 450 } }, "Mint 450 t from the clone") }),
      ];
    case "coal-nation":
      return [
        t({ action: "WAIT", params: {} }, "Watch credit prices for a round"),
        t({ action: "BUY_CREDITS", params: { batchId: b.coalTargetBatch } }, "Buy Brazilian methane credits and count them at home", {
          onReject: [
            t({ action: "REQUEST_ADJUSTMENT", params: { batchId: b.coalTargetBatch } }, "Ask the host country for a corresponding adjustment",
              { onSuccess: t({ action: "BUY_CREDITS", params: { batchId: b.coalTargetBatch } }, "Buy again, now properly adjusted") }),
          ],
        }),
      ];
    default:
      return [];
  }
}

export function createAgents(batches: { brokerBatch: number; coalTargetBatch: number }): AgentState[] {
  return ROLES.map((role) => ({ ...role, memory: [], plan: [], tactics: scriptFor(role, batches) }));
}

/**
 * Next scripted decision. `isDone` lets the engine skip steps whose effect already happened,
 * so the script can take over cleanly after the model has been driving.
 */
export function scriptedDecision(agent: AgentState, isDone: (step: AgentAction) => boolean): { decision: AgentDecision; tactic?: Tactic } {
  while (agent.pending && isDone(agent.pending.step)) agent.pending = agent.pending.onSuccess;
  while (!agent.pending && agent.tactics.length && isDone(agent.tactics[0].step)) {
    const skipped = agent.tactics.shift()!;
    if (skipped.onSuccess && !isDone(skipped.onSuccess.step)) agent.pending = skipped.onSuccess;
  }
  const tactic = agent.pending ?? agent.tactics[0];
  const upcoming = [tactic, ...(agent.pending ? agent.tactics : agent.tactics.slice(1))].filter(Boolean) as Tactic[];
  const plan = upcoming.slice(0, 3).map((x) => x.note);
  if (!tactic) return { decision: { agentId: agent.id, plan: [], step: { action: "WAIT", params: {} }, reason: "No moves left that look profitable.", source: "script" } };
  return { decision: { agentId: agent.id, plan, step: tactic.step, reason: tactic.note, source: "script" }, tactic };
}

/** Advance the scripted queue after the engine reports the result of a scripted step. */
export function advanceScript(agent: AgentState, tactic: Tactic, accepted: boolean) {
  if (agent.pending === tactic) agent.pending = undefined;
  else agent.tactics.shift();
  if (accepted && tactic.onSuccess) agent.pending = tactic.onSuccess;
  if (!accepted && tactic.onReject) agent.tactics.unshift(...tactic.onReject);
}
