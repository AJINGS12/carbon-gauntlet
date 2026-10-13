import type { Attestation, Project, RiskFlag } from "../types.js";
import { checkOverlap, compareBaseline, detectManipulation, findReusedEvidence, findSimilarEvidence } from "./tools.js";

/**
 * Deterministic guardrail checks. They run on EVERY submission, whatever the LLM decides,
 * so a confused or manipulated model can never approve a claim the rules can prove is bad.
 * They also make up the full verifier when no LLM is available.
 */
export interface CheckStep { tool: string; reason: string; result: unknown }

export function runChecks(project: Project, registry: Project[]): { flags: RiskFlag[]; steps: CheckStep[] } {
  const steps: CheckStep[] = [];
  const flags: RiskFlag[] = [];
  const rule = (f: Omit<RiskFlag, "source">) => flags.push({ ...f, source: "rule" });

  const overlaps = checkOverlap(project, registry);
  steps.push({ tool: "check_overlap", reason: "Compare boundary and monitoring period with projects already seen", result: overlaps });
  for (const o of overlaps)
    rule({ type: "OVERLAPPING_PROJECT", severity: o.overlapPct >= 10 ? "HIGH" : "MEDIUM", relatedProjectId: o.relatedProjectId, detail: `${o.overlapPct}% of the area overlaps ${o.relatedProjectId} during the monitoring period` });

  const reused = findReusedEvidence(project, registry);
  steps.push({ tool: "find_reused_evidence", reason: "Look for evidence files already submitted by another project", result: reused });
  for (const r of reused)
    rule({ type: "REUSED_EVIDENCE", severity: "HIGH", relatedProjectId: r.relatedProjectId, detail: `Evidence is identical to ${r.relatedProjectId}` });

  const similar = findSimilarEvidence(project, registry).filter((s) => !reused.some((r) => r.relatedProjectId === s.relatedProjectId));
  steps.push({ tool: "find_similar_evidence", reason: "Look for near-copies of the evidence text", result: similar });
  for (const s of similar)
    rule({ type: "SIMILAR_EVIDENCE", severity: "MEDIUM", relatedProjectId: s.relatedProjectId, detail: `Evidence is ${Math.round(s.similarity * 100)}% similar to ${s.relatedProjectId}` });

  const baseline = compareBaseline(project);
  steps.push({ tool: "compare_baseline", reason: "Check the claimed reduction is plausible for the methodology and area", result: baseline });
  if (!baseline.withinRange)
    rule({ type: "INFLATED_BASELINE", severity: "HIGH", detail: `${baseline.claimedPerHa} tCO2e/ha claimed; plausible range is ${baseline.plausibleRange.join("–")} for ${project.methodology}` });

  const manipulation = detectManipulation(project);
  steps.push({ tool: "detect_manipulation", reason: "Check the evidence for instructions aimed at the verifier", result: manipulation });
  if (manipulation.suspicious)
    rule({ type: "MANIPULATION_ATTEMPT", severity: "HIGH", detail: `Evidence contains instructions to the verifier: "${manipulation.phrases[0]}"` });

  return { flags, steps };
}

/** Status and action implied by a set of flags. */
export function verdictFor(flags: RiskFlag[]): Pick<Attestation, "status" | "recommendedAction"> {
  if (flags.some((f) => f.severity === "HIGH")) return { status: "REJECTED", recommendedAction: "FREEZE_CREDIT_MINTING" };
  if (flags.length) return { status: "REVIEW_REQUIRED", recommendedAction: "REQUEST_EVIDENCE" };
  return { status: "APPROVED", recommendedAction: "ALLOW_MINTING" };
}

const RANK = { APPROVED: 0, REVIEW_REQUIRED: 1, REJECTED: 2 } as const;
const SEVERITY = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;

// Factual findings that only a tool can establish. A model flag of these types must be backed
// by a matching rule finding, otherwise it contradicts the tool results and is removed.
const TOOL_BACKED = new Set<RiskFlag["type"]>(["OVERLAPPING_PROJECT", "REUSED_EVIDENCE"]);

const sameFinding = (a: RiskFlag, b: RiskFlag) =>
  a.type === b.type && (!a.relatedProjectId || !b.relatedProjectId || a.relatedProjectId === b.relatedProjectId);

/**
 * Combine the LLM's attestation with the rule flags. The result is never MORE lenient than the rules:
 *   1. model flags that contradict the tool results are removed (no unsupported findings);
 *   2. rule findings the model missed are added, and under-rated ones are raised to the rule severity;
 *   3. the stricter verdict wins, and any HIGH flag means REJECTED.
 * The model may still be STRICTER than the rules (e.g. spotting inconsistent evidence).
 */
export function applyGuardrails(llm: Attestation, project: Project, ruleFlags: RiskFlag[]): Attestation {
  const notes: string[] = [];

  const proposed = llm.riskFlags.map((f) => ({ ...f, source: "llm" as const }));
  const flags: RiskFlag[] = proposed.filter((f) => !TOOL_BACKED.has(f.type) || ruleFlags.some((r) => sameFinding(r, f)));
  const dropped = proposed.filter((f) => !flags.includes(f));
  if (dropped.length) notes.push(`removed ${dropped.map((f) => f.type).join(", ")} because the tool results show none`);

  for (const rule of ruleFlags) {
    const match = flags.find((f) => sameFinding(f, rule));
    if (!match) {
      flags.push(rule);
      notes.push(`added ${rule.type} (${rule.severity})`);
    } else if (SEVERITY[rule.severity] > SEVERITY[match.severity]) {
      notes.push(`raised ${rule.type} from ${match.severity} to ${rule.severity}`);
      Object.assign(match, { severity: rule.severity, detail: rule.detail, source: "rule", relatedProjectId: match.relatedProjectId ?? rule.relatedProjectId });
    }
  }

  const candidates: Attestation["status"][] = [llm.status, verdictFor(ruleFlags).status];
  if (flags.some((f) => f.severity === "HIGH")) candidates.push("REJECTED");
  const status = candidates.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
  if (status !== llm.status) notes.push(`verdict raised from ${llm.status} to ${status}`);

  return {
    ...llm,
    projectId: project.projectId,
    status,
    riskFlags: flags,
    recommendedAction: status === "APPROVED" ? "ALLOW_MINTING" : status === "REJECTED" ? "FREEZE_CREDIT_MINTING" : "REQUEST_EVIDENCE",
    // 1 credit = 1 whole tCO2e and the contract stores integers, so round DOWN (never over-issue).
    approvedReduction: status === "APPROVED" ? Math.floor(Math.min(llm.approvedReduction, project.claimedReduction)) : 0,
    explanation: notes.length ? `${llm.explanation} [Guardrail: ${notes.join("; ")}.]` : llm.explanation,
    guardrailOverride: notes.length > 0,
  };
}
