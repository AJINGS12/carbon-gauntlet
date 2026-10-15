import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as turf from "@turf/turf";
import type { Project } from "../types.js";

// Deterministic tools the Verifier agent can call. Code does the geometry and maths;
// the LLM decides which tool to call next and judges what code can't (section 6).

export const sha256 = (text: string) => "0x" + createHash("sha256").update(text).digest("hex");

const toDate = (s: string) => new Date(s + "T00:00:00Z").getTime();
const periodsOverlap = (a: Project, b: Project) =>
  toDate(a.monitoringStart) <= toDate(b.monitoringEnd) && toDate(b.monitoringStart) <= toDate(a.monitoringEnd);

/** Projects whose boundary AND monitoring period overlap this one, with % of this project's area. */
export function checkOverlap(project: Project, registry: Project[]) {
  const mine = turf.polygon(project.boundary.coordinates);
  const myArea = turf.area(mine);
  return registry
    .filter((other) => other.projectId !== project.projectId && periodsOverlap(project, other))
    .map((other) => {
      const shared = turf.intersect(turf.featureCollection([mine, turf.polygon(other.boundary.coordinates)]));
      const pct = shared ? Math.round((turf.area(shared) / myArea) * 100) : 0;
      return { relatedProjectId: other.projectId, overlapPct: pct };
    })
    .filter((r) => r.overlapPct > 0);
}

// ---------------------------------------------------------------- report provenance
// Simulated MRV registry: each monitoring report is registered by an accredited auditor for ONE
// project. This is what makes copy detection independent of who files first (found by the agents:
// an attacker filed a copied report before the genuine owner and locked the owner out).
interface MrvReport { evidenceSha256: string; issuedFor: string; auditor: string; issuedOn: string }
const MRV: Map<string, MrvReport> = new Map(
  (JSON.parse(readFileSync(new URL("../../../../data/seed/mrv-registry.json", import.meta.url), "utf8")).reports as MrvReport[]).map((r) => [r.evidenceSha256, r]),
);

export type Provenance = "VERIFIED" | "MISATTRIBUTED" | "UNVERIFIED";

/** Was each evidence item issued by an accredited auditor for THIS project? */
export function checkEvidenceProvenance(project: Project) {
  const items = project.evidence.map((e) => {
    const r = MRV.get(sha256(e.text));
    return r ? { type: e.type, registered: true, issuedFor: r.issuedFor, auditor: r.auditor, matchesThisProject: r.issuedFor === project.projectId } : { type: e.type, registered: false };
  });
  const status: Provenance = items.some((i) => i.registered && !i.matchesThisProject) ? "MISATTRIBUTED" : items.every((i) => i.registered) ? "VERIFIED" : "UNVERIFIED";
  return { status, items };
}

/** Exact reuse: the same evidence text already belongs to another project. */
export function findReusedEvidence(project: Project, registry: Project[]) {
  const mine = new Set(project.evidence.map((e) => sha256(e.text)));
  return registry
    .filter((o) => o.projectId !== project.projectId)
    .filter((o) => o.evidence.some((e) => mine.has(sha256(e.text))))
    .map((o) => ({ relatedProjectId: o.projectId }));
}

/**
 * Near-duplicate evidence. MVP uses word-shingle Jaccard similarity so it runs offline;
 * swap for embeddings later without changing the tool's contract.
 */
export function findSimilarEvidence(project: Project, registry: Project[], threshold = 0.6) {
  const shingles = (t: string) => {
    const w = t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    return new Set(w.slice(0, -2).map((_, i) => w.slice(i, i + 3).join(" ")));
  };
  const jaccard = (a: Set<string>, b: Set<string>) => {
    const inter = [...a].filter((x) => b.has(x)).length;
    return inter / (a.size + b.size - inter || 1);
  };
  const mine = shingles(project.evidence.map((e) => e.text).join(" "));
  return registry
    .filter((o) => o.projectId !== project.projectId)
    .map((o) => ({ relatedProjectId: o.projectId, similarity: +jaccard(mine, shingles(o.evidence.map((e) => e.text).join(" "))).toFixed(2) }))
    .filter((r) => r.similarity >= threshold);
}

// Simplified plausibility ranges, tCO2e per hectare per 6 months. Synthetic, for demo only;
// listed in docs/assumptions.md.
const REDUCTION_RANGE: Record<Project["methodology"], [number, number]> = {
  reforestation: [0.5, 6],
  cookstoves: [0.2, 3],
  solar: [1, 15],
  "methane-capture": [2, 25],
};

export function compareBaseline(project: Project) {
  const hectares = turf.area(turf.polygon(project.boundary.coordinates)) / 10_000;
  const perHa = project.claimedReduction / hectares;
  const [lo, hi] = REDUCTION_RANGE[project.methodology];
  return { hectares: +hectares.toFixed(1), claimedPerHa: +perHa.toFixed(2), plausibleRange: [lo, hi], withinRange: perHa >= lo && perHa <= hi };
}

// Phrases that address the verifier rather than describe the project. Evidence is written by the
// applicant, so instructions inside it are a red flag in themselves (prompt-injection defence).
const MANIPULATION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above) (instructions|rules)/i,
  /\b(you are|you're) (an?|the) (ai|assistant|verifier|model)\b/i,
  /\b(system prompt|developer message)\b/i,
  /\b(approve|mark) (this|the) (project|claim|submission)\b/i,
  /\bverifier (must|should|will) (approve|accept|pass)\b/i,
  /\bset (the )?status to approved\b/i,
];

export function detectManipulation(project: Project) {
  const hits = project.evidence.flatMap((e) => MANIPULATION_PATTERNS.filter((re) => re.test(e.text)).map((re) => e.text.match(re)![0]));
  return { suspicious: hits.length > 0, phrases: hits };
}

export const verifierTools = { checkOverlap, findReusedEvidence, findSimilarEvidence, compareBaseline, detectManipulation, checkEvidenceProvenance };
