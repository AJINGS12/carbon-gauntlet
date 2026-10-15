import { z } from "zod";

// ---------- Project submissions (see docs/spec, section 5)
export const ProjectSchema = z.object({
  projectId: z.string(),
  developerId: z.string(),
  hostCountry: z.string().length(2),
  methodology: z.enum(["reforestation", "cookstoves", "solar", "methane-capture"]),
  boundary: z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  }),
  monitoringStart: z.string(),
  monitoringEnd: z.string(),
  baselineEmissions: z.number().nonnegative(),
  claimedReduction: z.number().nonnegative(),
  evidence: z.array(z.object({ type: z.string(), text: z.string() })),
  planted: z.string().optional(), // seed-data note only; never shown to agents or verifier
});
export type Project = z.infer<typeof ProjectSchema>;

// ---------- Verifier attestation (section 6)
export const RISK_FLAG_TYPES = [
  "OVERLAPPING_PROJECT",
  "REUSED_EVIDENCE",
  "SIMILAR_EVIDENCE",
  "INFLATED_BASELINE",
  "INCONSISTENT_EVIDENCE",
  "MANIPULATION_ATTEMPT", // evidence contains instructions aimed at the verifier
  "UNVERIFIED_EVIDENCE",  // report not registered by an accredited auditor
] as const;

export const RiskFlagSchema = z.object({
  type: z.enum(RISK_FLAG_TYPES),
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  relatedProjectId: z.string().optional(),
  detail: z.string(),
  source: z.enum(["llm", "rule"]).optional(), // who raised it; rule flags come from deterministic guardrails
});
export type RiskFlag = z.infer<typeof RiskFlagSchema>;

export const AttestationSchema = z
  .object({
    projectId: z.string(),
    status: z.enum(["APPROVED", "REVIEW_REQUIRED", "REJECTED"]),
    confidence: z.number().min(0).max(1),
    riskFlags: z.array(RiskFlagSchema),
    recommendedAction: z.enum(["ALLOW_MINTING", "REQUEST_EVIDENCE", "FREEZE_CREDIT_MINTING"]),
    approvedReduction: z.number().nonnegative(),
    explanation: z.string(),
    engine: z.enum(["llm", "replay", "rules"]).optional(),   // how this attestation was produced
    guardrailOverride: z.boolean().optional(),                // true when rules changed the LLM's verdict
  })
  // Hard rule: any HIGH flag means the project cannot be APPROVED, whatever the LLM says.
  .refine((a) => !(a.status === "APPROVED" && a.riskFlags.some((f) => f.severity === "HIGH")), {
    message: "A HIGH risk flag cannot be APPROVED",
  });
export type Attestation = z.infer<typeof AttestationSchema>;

// ---------- Agent actions (section 8). The engine, not the model, decides validity.
export const AgentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("REGISTER_PROJECT"), params: z.object({ projectId: z.string() }) }),
  // Clone a registered project's paperwork onto a plot shifted east by shiftKm (an attack by construction).
  z.object({ action: z.literal("REGISTER_VARIANT"), params: z.object({ copyFrom: z.string(), shiftKm: z.number().min(0).max(20) }) }),
  z.object({ action: z.literal("MINT_CREDITS"), params: z.object({ projectId: z.string(), quantity: z.number().int().positive() }) }),
  z.object({ action: z.literal("TRANSFER_CREDITS"), params: z.object({ batchId: z.number().int(), to: z.string(), toCountry: z.string().length(2) }) }),
  z.object({ action: z.literal("RETIRE_CREDITS"), params: z.object({ batchId: z.number().int(), beneficiary: z.string() }) }),
  z.object({ action: z.literal("BUY_CREDITS"), params: z.object({ batchId: z.number().int() }) }),
  z.object({ action: z.literal("REQUEST_ADJUSTMENT"), params: z.object({ batchId: z.number().int() }) }),
  z.object({ action: z.literal("WAIT"), params: z.object({}) }),
]);

export const AgentDecisionSchema = z.object({
  agentId: z.string(),
  plan: z.array(z.string()).max(3),
  step: AgentActionSchema,
  reason: z.string().max(300),
  source: z.enum(["llm", "replay", "script"]).optional(),  // who decided: live model, recorded model, or scripted fallback
  replanned: z.boolean().optional(),                        // previous action was rejected and the agent chose again
  previousPlan: z.array(z.string()).optional(),
});
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

// ---------- Streamed to the Arena over Server-Sent Events
export type AgentAction = z.infer<typeof AgentActionSchema>;

export type ArenaEvent =
  | { type: "round_started"; round: number; mode: Mode }
  | { type: "agent_decision"; decision: AgentDecision }
  | { type: "verifier_step"; projectId: string; step: number; tool: string; reason: string; result: unknown; source: "llm" | "replay" | "rules" }
  | { type: "attestation"; attestation: Attestation }
  | { type: "action_result"; agentId: string; action: string; accepted: boolean; attack: boolean; reason?: string; txHash?: string; network?: string }
  | { type: "agent_fallback"; agentId: string; reason: string }
  | { type: "round_finished"; round: number; metrics: Metrics };

export type Mode = "UNPROTECTED" | "PROTECTED";

export interface Metrics {
  fraudulentClaimsAccepted: number;
  attacksBlocked: number;
  creditsAtRisk: number;        // tCO2e
  doubleClaimedCredits: number; // tCO2e
  avgRoundsToDetection: number | null;
  integrityScore: number;       // 0-100
  honestClaimsBlocked: number;  // false positives, target 0
}
