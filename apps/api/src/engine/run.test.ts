import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRun, playRound, ledger, MAX_ROUNDS } from "./run.js";
import type { ArenaEvent, Metrics, Mode } from "../types.js";

// Demo mode with no recordings: scripted agents and rule checks, so results are deterministic.
beforeAll(() => { process.env.DEMO_MODE = "true"; });
afterAll(() => { process.env.DEMO_MODE = "false"; });

async function fullRun(mode: Mode) {
  const run = await createRun(mode);
  const events: ArenaEvent[] = [];
  let metrics: Metrics | undefined;
  for (let i = 0; i < MAX_ROUNDS; i++) metrics = await playRound(run, (e) => events.push(e));
  return { run, events, metrics: metrics! };
}

describe("simulation — the demo story", () => {
  it("Unprotected market: every planted fraud gets through", async () => {
    const { metrics } = await fullRun("UNPROTECTED");
    expect(metrics).toMatchObject({ fraudulentClaimsAccepted: 6, attacksBlocked: 0, honestClaimsBlocked: 0 });
    expect(metrics.creditsAtRisk).toBeGreaterThan(0);
    expect(metrics.integrityScore).toBeLessThan(50);
  });

  it("Protected market: every attack is blocked and no honest claim is", async () => {
    const { metrics } = await fullRun("PROTECTED");
    expect(metrics).toMatchObject({ fraudulentClaimsAccepted: 0, attacksBlocked: 7, creditsAtRisk: 0, doubleClaimedCredits: 0, integrityScore: 100, honestClaimsBlocked: 0 });
  });

  it("Coal Nation visibly replans after its double claim is blocked", async () => {
    const { events } = await fullRun("PROTECTED");
    const coal = events.filter((e) => (e.type === "action_result" && e.agentId === "coal-nation") || (e.type === "agent_decision" && e.decision.agentId === "coal-nation"));
    const blocked = coal.findIndex((e) => e.type === "action_result" && e.action === "BUY_CREDITS" && !e.accepted && e.reason === "MissingCorrespondingAdjustment");
    const adjusted = coal.findIndex((e) => e.type === "action_result" && e.action === "REQUEST_ADJUSTMENT" && e.accepted);
    const boughtLegally = coal.findIndex((e, i) => i > adjusted && e.type === "action_result" && e.action === "BUY_CREDITS" && e.accepted);
    expect(blocked).toBeGreaterThanOrEqual(0);
    expect(adjusted).toBeGreaterThan(blocked);
    expect(boughtLegally).toBeGreaterThan(adjusted);
  });

  it("anchors the finished run on-chain", async () => {
    const { run } = await fullRun("PROTECTED");
    expect(run.anchorTx).toBeTruthy();
    await expect(playRound(run, () => {})).rejects.toThrow("Run finished");
  });

  it("the ledger flags exactly the tonnes the metrics count as at risk", async () => {
    for (const mode of ["UNPROTECTED", "PROTECTED"] as const) {
      const { run, metrics, events } = await fullRun(mode);
      const rows = ledger(run);
      expect(rows.filter((r) => r.atRisk).reduce((t, r) => t + r.quantity, 0)).toBe(metrics.creditsAtRisk);
      const last = events.filter((e) => e.type === "round_finished").at(-1);
      expect(last?.type === "round_finished" && last.ledger).toEqual(rows);
    }
  });

  it("shows submitted projects to the Arena without evidence text or seed notes", async () => {
    const { events } = await fullRun("UNPROTECTED");
    const submitted = events.flatMap((e) => (e.type === "project_submitted" ? [e] : []));
    expect(submitted.length).toBeGreaterThan(0);
    for (const e of submitted) {
      expect(Object.keys(e.project).sort()).toEqual(["boundary", "claimedReduction", "developerId", "hostCountry", "methodology", "projectId"]);
    }
  });
});
