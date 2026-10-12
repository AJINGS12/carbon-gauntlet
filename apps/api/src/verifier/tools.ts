import { createHash } from "node:crypto";
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

export const verifierTools = { checkOverlap, findReusedEvidence, findSimilarEvidence, compareBaseline };
