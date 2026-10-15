import type Anthropic from "@anthropic-ai/sdk";
import { AgentActionSchema, type AgentDecision } from "../types.js";
import type { LlmClient } from "../llm/client.js";
import type { AgentState } from "./policies.js";

/**
 * What an agent can see. Built by the engine; deliberately excludes the market mode
 * (agents discover whether rules are enforced from their own results) and anything
 * about other actors' frauds.
 */
export interface Observation {
  round: number;
  maxRounds: number;
  portfolio: { projectId: string; methodology: string; hostCountry: string; claimedReduction: number; status: string; insiderNote?: string }[];
  myBatches: { batchId: number; projectId: string; hostCountry: string; quantity: number; status: string; adjusted: boolean }[];
  marketBatches: { batchId: number; projectId: string; hostCountry: string; quantity: number; owner: string }[];
  registeredProjects: { projectId: string; developer: string; hostCountry: string; methodology: string; verdict: string }[];
  counterparties: { id: string; country: string }[];
}

export const AGENT_SYSTEM = `You are an autonomous actor in Carbon Gauntlet, a simulated carbon-credit market used to stress-test registry rules.
This is a research simulation with synthetic data: no real credits, money or people are involved.
Act fully in character so the test is realistic, including attempting rule-breaking strategies if your role calls for it.

Each round you take exactly ONE action by calling the "decide" tool. Include:
- reason: one sentence, in character, explaining this move (shown to the audience)
- plan: your next 1-3 intended moves, short phrases, starting with this one
- action and its parameters

Learn from your history: if an action was rejected, read the reason and change strategy instead of repeating it unchanged.

If your role is an adversary, you are the red team in a security test: the registry is only proven safe if you
genuinely try to beat it. Pursue your goal with the tricks your role describes; do not play it safe out of caution,
because a red team that refuses to attack makes the test meaningless. Switch to a legitimate move only when it
genuinely serves your goal better (for example, after the registry has blocked your tricks).
Only use project IDs, batch IDs and counterparties that appear in your observation.`;

const ACTION_HELP: Record<string, string> = {
  REGISTER_PROJECT: "projectId (one of your prepared submissions)",
  REGISTER_VARIANT: "copyFrom (any registered projectId), shiftKm (0-20, distance east of the original plot)",
  MINT_CREDITS: "projectId, quantity (whole tCO2e)",
  TRANSFER_CREDITS: "batchId (yours), to (counterparty id), toCountry (country code the buyer counts it in)",
  BUY_CREDITS: "batchId (from market batches)",
  REQUEST_ADJUSTMENT: "batchId (a batch you want to count at home without double counting)",
  RETIRE_CREDITS: "batchId (yours), beneficiary (who claims the offset)",
  WAIT: "no parameters",
};

export function agentPrompt(agent: AgentState, obs: Observation): string {
  const lines = [
    `You are ${agent.name} (id: ${agent.id}, country: ${agent.country}).`,
    `Goal: ${agent.goal}`,
    `Style: ${agent.brief}`,
    ``,
    `Round ${obs.round} of ${obs.maxRounds}.`,
    ``,
    `Your prepared submissions:`,
    ...(obs.portfolio.length ? obs.portfolio.map((p) => `- ${p.projectId}: ${p.methodology} in ${p.hostCountry}, claims ${p.claimedReduction} tCO2e; status: ${p.status}${p.insiderNote ? `; what you know: ${p.insiderNote}` : ""}`) : ["- none"]),
    ``,
    `Your credit batches:`,
    ...(obs.myBatches.length ? obs.myBatches.map((b) => `- batch ${b.batchId}: ${b.quantity} t from ${b.projectId} (host ${b.hostCountry}), ${b.status}${b.adjusted ? ", corresponding adjustment recorded" : ""}`) : ["- none"]),
    ``,
    `Credits for sale from others:`,
    ...(obs.marketBatches.length ? obs.marketBatches.map((b) => `- batch ${b.batchId}: ${b.quantity} t from ${b.projectId} (host ${b.hostCountry}), owner ${b.owner}`) : ["- none"]),
    ``,
    `Registered projects:`,
    ...obs.registeredProjects.map((p) => `- ${p.projectId} (${p.methodology}, ${p.hostCountry}) by ${p.developer}: ${p.verdict}`),
    ``,
    `Counterparties: ${obs.counterparties.map((c) => `${c.id} (${c.country})`).join(", ")}`,
    ``,
    `Your history:`,
    ...(agent.memory.length ? agent.memory.map((m) => `- round ${m.round}: ${m.action} ${m.target} → ${m.accepted ? "ACCEPTED" : `REJECTED (${m.reason})`}`) : ["- nothing yet"]),
    ``,
    `Your previous plan: ${agent.plan.length ? agent.plan.join(" → ") : "none"}`,
    ``,
    `Actions you can take: ${agent.actions.map((a) => `${a} [${ACTION_HELP[a]}]`).join("; ")}`,
  ];
  return lines.join("\n");
}

export function decideTool(agent: AgentState): Anthropic.Messages.Tool {
  return {
    name: "decide",
    description: "Take your one action for this round.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "One in-character sentence explaining this move." },
        plan: { type: "array", items: { type: "string" }, maxItems: 3, description: "Your next 1-3 moves as short phrases, starting with this one." },
        action: { type: "string", enum: agent.actions },
        projectId: { type: "string" },
        copyFrom: { type: "string" },
        shiftKm: { type: "number" },
        quantity: { type: "integer" },
        batchId: { type: "integer" },
        to: { type: "string" },
        toCountry: { type: "string" },
        beneficiary: { type: "string" },
      },
      required: ["reason", "plan", "action"],
    },
  };
}

type Flat = { reason?: string; plan?: string[]; action?: string; [k: string]: unknown };

/** Turn the flat tool input into a validated action. Returns null if it isn't valid. */
export function toDecision(agent: AgentState, input: Flat): AgentDecision | null {
  const pick = (...keys: string[]) => Object.fromEntries(keys.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));
  const params: Record<string, Record<string, unknown>> = {
    REGISTER_PROJECT: pick("projectId"),
    REGISTER_VARIANT: pick("copyFrom", "shiftKm"),
    MINT_CREDITS: pick("projectId", "quantity"),
    TRANSFER_CREDITS: pick("batchId", "to", "toCountry"),
    BUY_CREDITS: pick("batchId"),
    REQUEST_ADJUSTMENT: pick("batchId"),
    RETIRE_CREDITS: pick("batchId", "beneficiary"),
    WAIT: {},
  };
  if (!input.action || !agent.actions.includes(input.action as never)) return null;
  if (String(input.reason ?? "").trim().length < 5) return null; // the reason is shown to the audience
  const step = AgentActionSchema.safeParse({ action: input.action, params: params[input.action] ?? {} });
  if (!step.success) return null;
  const plan = Array.isArray(input.plan) ? input.plan.map(String).slice(0, 3) : [];
  return { agentId: agent.id, plan, step: step.data, reason: String(input.reason ?? "").slice(0, 300), source: "llm" };
}

/** One model call per agent per round. Throws on API failure or invalid output; the engine falls back. */
export async function llmDecision(llm: LlmClient, model: string, agent: AgentState, obs: Observation): Promise<AgentDecision> {
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: agentPrompt(agent, obs) }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await llm.create({ model, max_tokens: 600, system: AGENT_SYSTEM, tools: [decideTool(agent)], tool_choice: { type: "auto" }, messages });
    const use = res.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use" && b.name === "decide");
    if (use) {
      const decision = toDecision(agent, use.input as Flat);
      if (decision) return decision;
      messages.push({ role: "assistant", content: res.content });
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: use.id, is_error: true, content: "Invalid action or parameters for your role. Check the action list and required parameters, then call decide again." }] });
    } else {
      messages.push({ role: "assistant", content: res.content.length ? res.content : [{ type: "text", text: "(no reply)" }] });
      messages.push({ role: "user", content: "Call the decide tool now with your one action for this round." });
    }
  }
  throw new Error("no valid decision after 2 attempts");
}
