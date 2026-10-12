import type { Attestation, ArenaEvent, Project } from "../types.js";
import { AttestationSchema } from "../types.js";
import { checkOverlap, compareBaseline, findReusedEvidence, findSimilarEvidence } from "./tools.js";

const MAX_STEPS = 6;

/**
 * Verifier agent entry point.
 *
 * TODO (Phase 3): replace `investigateWithLLM` with a Claude tool-use loop:
 *   - expose checkOverlap / findSimilarEvidence / lookupChainHistory / compareBaseline /
 *     requestMoreEvidence / submitAttestation as tools
 *   - let the model choose the next tool, up to MAX_STEPS calls
 *   - emit a `verifier_step` event per call so the Arena shows the investigation trace
 *   - validate the final attestation with AttestationSchema
 * Until then, and whenever the LLM fails or times out, the deterministic fallback below runs.
 */
export async function verifyProject(
  project: Project,
  registry: Project[],
  emit: (e: ArenaEvent) => void,
): Promise<Attestation> {
  try {
    if (process.env.DEMO_MODE !== "true" && process.env.ANTHROPIC_API_KEY) {
      const result = await investigateWithLLM(project, registry, emit);
      return AttestationSchema.parse(result);
    }
  } catch (err) {
    emit({ type: "verifier_step", projectId: project.projectId, tool: "fallback", reason: `LLM failed: ${(err as Error).message}`, result: null });
  }
  return ruleBasedFallback(project, registry, emit);
}

async function investigateWithLLM(_p: Project, _r: Project[], _emit: (e: ArenaEvent) => void): Promise<unknown> {
  throw new Error(`not implemented yet (max ${MAX_STEPS} tool calls)`);
}

/** Runs every check in a fixed order. Deterministic, so demo runs are reproducible. */
export function ruleBasedFallback(project: Project, registry: Project[], emit: (e: ArenaEvent) => void): Attestation {
  const step = (tool: string, reason: string, result: unknown) => {
    emit({ type: "verifier_step", projectId: project.projectId, tool, reason, result });
    return result;
  };
  const flags: Attestation["riskFlags"] = [];

  const overlaps = step("checkOverlap", "Check boundary and monitoring period against attested projects", checkOverlap(project, registry)) as ReturnType<typeof checkOverlap>;
  for (const o of overlaps) flags.push({ type: "OVERLAPPING_PROJECT", severity: o.overlapPct >= 10 ? "HIGH" : "MEDIUM", relatedProjectId: o.relatedProjectId, detail: `${o.overlapPct}% of area overlaps during the monitoring period` });

  const reused = step("findReusedEvidence", "Check for evidence files already used elsewhere", findReusedEvidence(project, registry)) as ReturnType<typeof findReusedEvidence>;
  for (const r of reused) flags.push({ type: "REUSED_EVIDENCE", severity: "HIGH", relatedProjectId: r.relatedProjectId, detail: "Identical evidence text" });

  const similar = step("findSimilarEvidence", "Look for near-copies of the evidence", findSimilarEvidence(project, registry)) as ReturnType<typeof findSimilarEvidence>;
  for (const s of similar) if (!reused.some((r) => r.relatedProjectId === s.relatedProjectId)) flags.push({ type: "SIMILAR_EVIDENCE", severity: "MEDIUM", relatedProjectId: s.relatedProjectId, detail: `Evidence ${Math.round(s.similarity * 100)}% similar` });

  const baseline = step("compareBaseline", "Check the claimed reduction is plausible for the methodology and area", compareBaseline(project)) as ReturnType<typeof compareBaseline>;
  if (!baseline.withinRange) flags.push({ type: "INFLATED_BASELINE", severity: "HIGH", detail: `${baseline.claimedPerHa} tCO2e/ha outside plausible ${baseline.plausibleRange.join("–")}` });

  const high = flags.some((f) => f.severity === "HIGH");
  const status: Attestation["status"] = high ? "REJECTED" : flags.length ? "REVIEW_REQUIRED" : "APPROVED";
  return {
    projectId: project.projectId,
    status,
    confidence: high ? 0.9 : flags.length ? 0.6 : 0.85,
    riskFlags: flags,
    recommendedAction: high ? "FREEZE_CREDIT_MINTING" : flags.length ? "REQUEST_EVIDENCE" : "ALLOW_MINTING",
    approvedReduction: status === "APPROVED" ? project.claimedReduction : 0,
    explanation: flags.length ? flags.map((f) => f.detail).join("; ") : "No integrity issues found.",
  };
}
