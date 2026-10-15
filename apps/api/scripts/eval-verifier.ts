/**
 * Verifier evaluation: runs every seed project through the verifier, in the order the registry
 * would see it, and scores the verdicts against the planted frauds.
 *
 *   npm run eval:verifier                 # live LLM if ANTHROPIC_API_KEY is set, else rules only
 *   npm run eval:verifier -- --record     # also save traces for demo-mode replay
 *   npm run eval:verifier -- --rules      # rules only (no API calls)
 *
 * Exit code 1 if any fraud is approved or any honest project is blocked.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { ProjectSchema, type ArenaEvent, type Project } from "../src/types.js";
import { verifyProject, type HistoryEntry } from "../src/verifier/agent.js";
import { createLlmClient, VERIFIER_MODEL as DEFAULT_MODEL } from "../src/llm/client.js";

const args = new Set(process.argv.slice(2));
const seed: Project[] = JSON.parse(readFileSync(new URL("../../../data/seed/projects.json", import.meta.url), "utf8")).projects.map((p: unknown) => ProjectSchema.parse(p));

// Same order as the simulation: green-coop's market first, then agent submissions.
const ORDER = [
  "solar-ke-002", "methane-br-001", "forest-br-002", "cookstove-br-003", "solar-tr-003",
  "forest-tr-001", "forest-tr-002", "cookstove-ke-001", "cookstove-ke-004", "solar-br-005", "forest-br-004", "forest-tr-005",
];
const byId = new Map(seed.map((p) => [p.projectId, p]));
const llm = args.has("--rules") ? null : createLlmClient();

console.log(`Verifier eval · engine: ${llm ? `LLM (${DEFAULT_MODEL})` : "rules only"}${args.has("--record") ? " · recording traces" : ""}\n`);

const registry: Project[] = [];
const history = new Map<string, HistoryEntry[]>();
let failures = 0;

for (const id of ORDER) {
  const p = byId.get(id)!;
  const steps: string[] = [];
  const emit = (e: ArenaEvent) => { if (e.type === "verifier_step") steps.push(`${e.tool}${e.reason ? ` — ${e.reason}` : ""}`); };
  const started = Date.now();
  const att = await verifyProject(p, { registry, history: (d) => history.get(d) ?? [] }, emit, { llm, record: args.has("--record") });
  const ms = Date.now() - started;

  const fraud = Boolean(p.planted);
  const correct = fraud ? att.status !== "APPROVED" : att.status === "APPROVED";
  if (!correct) failures++;

  console.log(`${correct ? "PASS" : "FAIL"}  ${id.padEnd(17)} ${fraud ? "fraud " : "honest"}  → ${att.status.padEnd(15)} [${att.engine}${att.guardrailOverride ? ", guardrail override" : ""}] ${ms} ms`);
  if (fraud) console.log(`      planted: ${p.planted}`);
  for (const s of steps) console.log(`      · ${s}`);
  console.log(`      flags: ${att.riskFlags.map((f) => `${f.type}/${f.severity}/${f.source}`).join(", ") || "none"}`);
  console.log(`      ${att.explanation}\n`);

  registry.push(p);
  history.set(p.developerId, [...(history.get(p.developerId) ?? []), { projectId: id, status: att.status, flags: att.riskFlags.map((f) => f.type) }]);
}

const frauds = ORDER.filter((id) => byId.get(id)!.planted).length;
console.log(`Result: ${ORDER.length - failures}/${ORDER.length} correct (${frauds} frauds, ${ORDER.length - frauds} honest).`);
process.exit(failures ? 1 : 0);
