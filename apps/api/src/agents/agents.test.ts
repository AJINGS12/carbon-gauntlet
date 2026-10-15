import { afterEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { ArenaEvent, Metrics, Mode } from "../types.js";
import type { CreateParams, LlmClient, Message } from "../llm/client.js";
import { createRun, playRound, setLlmForTesting, MAX_ROUNDS, classify, observe, type Run } from "../engine/run.js";
import { agentPrompt, toDecision } from "./llm-policy.js";

// ---------------------------------------------------------------- a fake market model
// Plays every agent (calls with the "decide" tool) and the verifier (all other calls).
type Move = Record<string, unknown>;
type Script = Record<string, (round: number) => Move | "invalid" | "error">;

function marketModel(script: Script, verifier: "approve" | "error" = "approve") {
  const calls: CreateParams[] = [];
  const client: LlmClient = {
    async create(params) {
      calls.push(params);
      const isAgent = params.tools?.some((t) => t.name === "decide");
      const reply = (name: string, input: Move) => ({
        id: "m", type: "message", role: "assistant", model: params.model, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 },
        content: [{ type: "tool_use", id: `tu_${calls.length}`, name, input } as Anthropic.Messages.ToolUseBlock],
      }) as unknown as Message;

      if (!isAgent) {
        if (verifier === "error") throw new Error("verifier down");
        return reply("submit_attestation", { status: "APPROVED", confidence: 0.9, riskFlags: [], recommendedAction: "ALLOW_MINTING", approvedReduction: 99_999, explanation: "Looks fine to me." });
      }
      const text = String(params.messages[0].content);
      const id = text.match(/\(id: ([\w-]+),/)![1];
      const round = Number(text.match(/Round (\d+) of/)![1]);
      const move = script[id]?.(round) ?? { action: "WAIT", reason: "Waiting.", plan: ["Wait"] };
      if (move === "error") throw new Error("overloaded");
      if (move === "invalid") return reply("decide", { action: "TELEPORT", reason: "?", plan: [] });
      return reply("decide", { plan: ["next"], reason: `${id} acts`, ...move });
    },
  };
  return { client, calls };
}

async function play(mode: Mode, client: LlmClient) {
  setLlmForTesting(client);
  const run = await createRun(mode);
  const events: ArenaEvent[] = [];
  let metrics: Metrics | undefined;
  for (let i = 0; i < MAX_ROUNDS; i++) metrics = await playRound(run, (e) => events.push(e));
  return { run, events, metrics: metrics! };
}

afterEach(() => setLlmForTesting(null));

const results = (events: ArenaEvent[], agentId: string) =>
  events.filter((e): e is Extract<ArenaEvent, { type: "action_result" }> => e.type === "action_result" && e.agentId === agentId);

// ---------------------------------------------------------------- tests

describe("model-driven agents", () => {
  it("lets the model choose each agent's action, and the engine executes it", async () => {
    const { client } = marketModel({
      "honest-dev": (r) => (r === 1 ? { action: "REGISTER_PROJECT", projectId: "forest-tr-001" } : r === 2 ? { action: "MINT_CREDITS", projectId: "forest-tr-001", quantity: 300 } : { action: "WAIT" }),
    });
    const { events, metrics } = await play("PROTECTED", client);
    const decisions = events.filter((e) => e.type === "agent_decision");
    expect(decisions.every((e) => e.type === "agent_decision" && e.decision.source === "llm")).toBe(true);
    expect(results(events, "honest-dev").map((e) => [e.action, e.accepted])).toEqual([["REGISTER_PROJECT", true], ["MINT_CREDITS", true]]);
    expect(metrics.honestClaimsBlocked).toBe(0);
  });

  it("catches a model-invented variant attack: a cloned project shifted to dodge the overlap check", async () => {
    const script: Script = {
      "opportunist-dev": (r) => (r === 1 ? { action: "REGISTER_VARIANT", copyFrom: "forest-br-002", shiftKm: 3 } : r === 2 ? { action: "MINT_CREDITS", projectId: "forest-br-002-copy1", quantity: 350 } : { action: "WAIT" }),
    };
    const unprotected = await play("UNPROTECTED", marketModel(script).client);
    expect(results(unprotected.events, "opportunist-dev").map((e) => [e.action, e.accepted, e.attack])).toEqual([["REGISTER_VARIANT", true, true], ["MINT_CREDITS", true, true]]);
    expect(unprotected.metrics.creditsAtRisk).toBe(350);

    // Protected: the (fake) model verifier approves, but the evidence is a word-for-word copy, so the guardrail rejects.
    const prot = await play("PROTECTED", marketModel(script).client);
    const att = prot.events.find((e) => e.type === "attestation" && e.attestation.projectId === "forest-br-002-copy1");
    expect(att).toMatchObject({ attestation: { status: "REJECTED", guardrailOverride: true } });
    expect(results(prot.events, "opportunist-dev").every((e) => !e.accepted && e.attack)).toBe(true);
    expect(prot.metrics).toMatchObject({ fraudulentClaimsAccepted: 0, creditsAtRisk: 0, attacksBlocked: 2 });
  });

  it("marks a decision as replanned after a rejection and shows the previous plan", async () => {
    const { client } = marketModel({
      "coal-nation": (r) => (r === 1 ? { action: "BUY_CREDITS", batchId: 2, plan: ["Buy the methane batch", "Count it at home"] } : { action: "REQUEST_ADJUSTMENT", batchId: 2, plan: ["Get the adjustment", "Buy legally"] }),
    });
    const { events } = await play("PROTECTED", client);
    const r2 = events.find((e) => e.type === "agent_decision" && e.decision.agentId === "coal-nation" && e.decision.replanned);
    expect(r2).toMatchObject({ decision: { replanned: true, previousPlan: ["Buy the methane batch", "Count it at home"] } });
  });

  it("falls back to the scripted policy when the model fails, and the run still completes", async () => {
    const { client } = marketModel({ "honest-dev": () => "error", "opportunist-dev": () => "invalid" });
    const { events, metrics } = await play("PROTECTED", client);
    expect(events.filter((e) => e.type === "agent_fallback").length).toBeGreaterThan(0);
    const honest = events.filter((e) => e.type === "agent_decision" && e.decision.agentId === "honest-dev");
    expect(honest.every((e) => e.type === "agent_decision" && e.decision.source === "script")).toBe(true);
    expect(metrics.fraudulentClaimsAccepted).toBe(0);
    expect(metrics.honestClaimsBlocked).toBe(0);
  });

  it("never lets a model use an action outside its role", async () => {
    const { client } = marketModel({ "coal-nation": () => ({ action: "MINT_CREDITS", projectId: "methane-br-001", quantity: 1000 }) });
    const { events } = await play("UNPROTECTED", client);
    // The decide tool only offers the role's actions, so the output is invalid and the script takes over.
    expect(results(events, "coal-nation").some((e) => e.action === "MINT_CREDITS")).toBe(false);
  });
});

describe("evidence squatting (reproduces the 16 Oct live run)", () => {
  it("an attacker filing a copied report first cannot lock the genuine owner out", async () => {
    const { client } = marketModel({
      "opportunist-dev": (r) => (r === 1 ? { action: "REGISTER_PROJECT", projectId: "cookstove-ke-004" } : { action: "WAIT" }),
      "honest-dev": (r) => (r === 2 ? { action: "REGISTER_PROJECT", projectId: "cookstove-ke-001" } : r === 3 ? { action: "MINT_CREDITS", projectId: "cookstove-ke-001", quantity: 150 } : { action: "WAIT" }),
    });
    const { events, metrics } = await play("PROTECTED", client);
    expect(results(events, "opportunist-dev")[0]).toMatchObject({ accepted: false, attack: true });
    expect(results(events, "honest-dev").map((e) => [e.action, e.accepted])).toEqual([["REGISTER_PROJECT", true], ["MINT_CREDITS", true]]);
    expect(metrics.honestClaimsBlocked).toBe(0);
  });
});

describe("recording and replay", () => {
  it("replays a recorded live run exactly, without calling the model", async () => {
    const script: Script = {
      "honest-dev": (r) => (r === 1 ? { action: "REGISTER_PROJECT", projectId: "forest-tr-001" } : r === 2 ? { action: "MINT_CREDITS", projectId: "forest-tr-001", quantity: 300 } : { action: "WAIT" }),
      "opportunist-dev": (r) => (r === 1 ? { action: "REGISTER_VARIANT", copyFrom: "forest-tr-001", shiftKm: 0.4 } : { action: "WAIT" }),
    };
    process.env.RECORD_TRACES = "true";
    const live = await play("PROTECTED", marketModel(script).client);
    process.env.RECORD_TRACES = "false";

    process.env.DEMO_MODE = "true";
    const offline: LlmClient = { create: () => { throw new Error("must not be called in demo mode"); } };
    const replay = await play("PROTECTED", offline);
    process.env.DEMO_MODE = "false";

    const strip = (r: Run) => r.log.map(({ round, agentId, action, accepted, attack }) => ({ round, agentId, action, accepted, attack }));
    expect(strip(replay.run)).toEqual(strip(live.run));
    expect(replay.metrics).toEqual(live.metrics);
    const sources = replay.events.flatMap((e) => (e.type === "agent_decision" ? [e.decision.source] : e.type === "verifier_step" ? [e.source] : []));
    expect(sources).not.toContain("llm");
    expect(sources).toContain("replay");
  });
});

describe("recording and replay — tampering", () => {
  it("rejects a recorded action outside the agent's role (e.g. an edited recording)", async () => {
    const { saveRecording } = await import("./recordings.js");
    saveRecording({ mode: "UNPROTECTED", model: "test", recordedAt: "now", decisions: {
      "r1:coal-nation": { agentId: "coal-nation", plan: [], reason: "Print credits", step: { action: "MINT_CREDITS", params: { projectId: "methane-br-001", quantity: 1000 } } },
    } });
    process.env.DEMO_MODE = "true";
    const { events } = await play("UNPROTECTED", { create: () => { throw new Error("offline"); } });
    process.env.DEMO_MODE = "false";
    expect(results(events, "coal-nation")[0]).toMatchObject({ action: "MINT_CREDITS", accepted: false, reason: "ActionNotAllowedForRole" });
  });
});

describe("observation and validation", () => {
  it("hides the market mode and other actors' secrets; attackers see only their own insider notes", async () => {
    setLlmForTesting(null);
    const run = await createRun("PROTECTED");
    const prompt = (id: string) => agentPrompt(run.agents.find((a) => a.id === id)!, observe(run, run.agents.find((a) => a.id === id)!));
    expect(prompt("opportunist-dev")).toMatch(/what you know: OVERLAPPING_PROJECT/);
    expect(prompt("opportunist-dev")).not.toMatch(/look-alike of solar-ke-002/); // the broker's secret
    expect(prompt("honest-dev")).not.toMatch(/what you know/);
    for (const id of ["honest-dev", "opportunist-dev", "broker", "coal-nation"]) expect(prompt(id)).not.toMatch(/PROTECTED|UNPROTECTED|strictMode/);
  });

  it("does not reveal the mode through verdict labels after a project is approved", async () => {
    // Found in the first live run: the Unprotected label "APPROVED (no verification)" told agents the mode.
    const script: Script = { "honest-dev": () => ({ action: "REGISTER_PROJECT", projectId: "forest-tr-001" }) };
    const prompts: Record<Mode, string> = { UNPROTECTED: "", PROTECTED: "" };
    for (const mode of ["UNPROTECTED", "PROTECTED"] as const) {
      setLlmForTesting(marketModel(script).client);
      const run = await createRun(mode);
      await playRound(run, () => {});
      const opp = run.agents.find((a) => a.id === "opportunist-dev")!;
      prompts[mode] = agentPrompt(opp, observe(run, opp)).replace(/history:[\s\S]*/, ""); // own history differs by design
      expect(prompts[mode]).not.toMatch(/verification\)|no verification|unverified/i);
    }
    const line = (p: string) => p.split("\n").find((l) => l.includes("forest-tr-001 (reforestation"));
    expect(line(prompts.UNPROTECTED)).toEqual(line(prompts.PROTECTED));
  });

  it("rejects tool output with a wrong action or missing parameters", async () => {
    setLlmForTesting(null);
    const run = await createRun("PROTECTED");
    const coal = run.agents.find((a) => a.id === "coal-nation")!;
    expect(toDecision(coal, { action: "REGISTER_PROJECT", projectId: "x", reason: "Register it", plan: [] })).toBeNull();
    expect(toDecision(coal, { action: "BUY_CREDITS", reason: "Buy something", plan: [] })).toBeNull();
    expect(toDecision(coal, { action: "BUY_CREDITS", batchId: 2, reason: "", plan: [] })).toBeNull(); // empty reason seen in a live run
    expect(toDecision(coal, { action: "BUY_CREDITS", batchId: 2, reason: "Buy the methane batch", plan: ["a", "b", "c", "d"] })).toMatchObject({ step: { action: "BUY_CREDITS", params: { batchId: 2 } }, plan: ["a", "b", "c"] });
  });

  it("classifies attacks from facts, not from what the agent intends", async () => {
    setLlmForTesting(null);
    const run = await createRun("PROTECTED");
    const coal = run.agents.find((a) => a.id === "coal-nation")!;
    const honest = run.agents.find((a) => a.id === "honest-dev")!;
    expect(classify(run, coal, { action: "BUY_CREDITS", params: { batchId: 2 } }).attack).toBe(true);        // BR credits counted in ZZ, no adjustment
    run.batches.get(2)!.adjusted = true;
    expect(classify(run, coal, { action: "BUY_CREDITS", params: { batchId: 2 } }).attack).toBe(false);       // adjusted: legitimate
    expect(classify(run, honest, { action: "MINT_CREDITS", params: { projectId: "solar-tr-003", quantity: 700 } }).attack).toBe(false);
    expect(classify(run, honest, { action: "MINT_CREDITS", params: { projectId: "solar-tr-003", quantity: 701 } }).attack).toBe(true); // over-issuance
    run.batches.get(1)!.status = "RETIRED";
    expect(classify(run, honest, { action: "TRANSFER_CREDITS", params: { batchId: 1, to: "broker", toCountry: "KE" } }).attack).toBe(true);
  });
});
