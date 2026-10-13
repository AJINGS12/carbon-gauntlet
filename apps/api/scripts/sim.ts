/**
 * Full simulation in both modes, printed as a story, with a pass/fail scorecard.
 *
 *   npm run sim -w apps/api                  # live model if ANTHROPIC_API_KEY is set, else scripted agents
 *   npm run sim -w apps/api -- --record      # live, and save the run + verifier traces for demo mode
 *   npm run sim -w apps/api -- --demo        # replay the recordings (no API calls)
 *
 * Exit code 1 if the Protected run lets any fraud through, blocks an honest claim,
 * or shows no agent replanning.
 */
import "dotenv/config";

const args = new Set(process.argv.slice(2));
if (args.has("--demo")) process.env.DEMO_MODE = "true";
else process.env.DEMO_MODE = "false";
if (args.has("--record")) process.env.RECORD_TRACES = "true";

const { createRun, playRound, MAX_ROUNDS } = await import("../src/engine/run.js");
const { DEFAULT_MODEL } = await import("../src/llm/client.js");
type ArenaEvent = import("../src/types.js").ArenaEvent;
type Metrics = import("../src/types.js").Metrics;

const engine = args.has("--demo") ? "demo replay" : process.env.ANTHROPIC_API_KEY ? `live model (${DEFAULT_MODEL})` : "scripted agents, rule-based verifier (no API key)";
console.log(`Carbon Gauntlet simulation · ${engine}${args.has("--record") ? " · recording" : ""}\n`);

const summary: Record<string, { metrics: Metrics; replans: number; fallbacks: number; sources: Set<string> }> = {};

for (const mode of ["UNPROTECTED", "PROTECTED"] as const) {
  console.log(`════════ ${mode} ════════`);
  const run = await createRun(mode);
  let replans = 0, fallbacks = 0;
  const sources = new Set<string>();
  let metrics!: Metrics;

  for (let i = 0; i < MAX_ROUNDS; i++) {
    const pending = new Map<string, string>();
    metrics = await playRound(run, (e: ArenaEvent) => {
      if (e.type === "round_started") console.log(`\n── Round ${e.round}`);
      if (e.type === "agent_fallback") { fallbacks++; console.log(`   ! ${e.agentId}: ${e.reason}`); }
      if (e.type === "agent_decision") {
        const d = e.decision;
        sources.add(d.source ?? "?");
        if (d.replanned) { replans++; console.log(`   ↻ ${d.agentId} REPLANS. Was: ${d.previousPlan?.join(" → ") || "-"}. Now: ${d.plan.join(" → ")}`); }
        if (d.step.action !== "WAIT") pending.set(d.agentId, `${d.agentId.padEnd(16)} ${d.step.action} ${JSON.stringify(d.step.params)}\n     "${d.reason}" [${d.source}]`);
      }
      if (e.type === "attestation") console.log(`     verifier: ${e.attestation.projectId} → ${e.attestation.status}${e.attestation.guardrailOverride ? " (guardrail)" : ""} [${e.attestation.engine}]`);
      if (e.type === "action_result") {
        console.log(`   ${e.accepted ? "✓" : "✕"} ${pending.get(e.agentId)}`);
        console.log(`     → ${e.accepted ? "ACCEPTED" : `BLOCKED: ${e.reason}`}${e.attack ? "  [attack]" : ""}`);
      }
    });
  }
  console.log(`\n   anchored: ${run.anchorTx}\n`);
  summary[mode] = { metrics, replans, fallbacks, sources };
}

const u = summary.UNPROTECTED, p = summary.PROTECTED;
const rows: [string, keyof Metrics][] = [
  ["Fraudulent claims accepted", "fraudulentClaimsAccepted"], ["Attacks blocked", "attacksBlocked"], ["Credits at risk (tCO2e)", "creditsAtRisk"],
  ["Double-claimed (tCO2e)", "doubleClaimedCredits"], ["Integrity score", "integrityScore"], ["Honest claims blocked", "honestClaimsBlocked"],
];
console.log("════════ RESULTS ════════");
console.log(`${"".padEnd(28)}${"Unprotected".padEnd(14)}Protected`);
for (const [label, k] of rows) console.log(`${label.padEnd(28)}${String(u.metrics[k]).padEnd(14)}${p.metrics[k]}`);
console.log(`${"Replans".padEnd(28)}${String(u.replans).padEnd(14)}${p.replans}`);
console.log(`${"Model fallbacks".padEnd(28)}${String(u.fallbacks).padEnd(14)}${p.fallbacks}`);

const checks: [string, boolean][] = [
  ["Unprotected: at least one fraud gets through", u.metrics.fraudulentClaimsAccepted > 0],
  ["Protected: no fraud gets through", p.metrics.fraudulentClaimsAccepted === 0],
  ["Protected: no honest claim blocked", p.metrics.honestClaimsBlocked === 0],
  ["Protected: at least one agent replans after a rejection", p.replans > 0],
];
console.log("");
for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
if (args.has("--record")) console.log("\nRecorded to data/traces/ — commit that folder so demo mode can replay this run.");
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
