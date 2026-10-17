import type { Action, Role } from "./api";

/** Plain-language labels for everything the engine, contract and verifier report. */

export const NAMES: Record<string, string> = {
  "honest-dev": "Honest Developer",
  "opportunist-dev": "Opportunist",
  broker: "Credit Broker",
  "coal-nation": "Coal Nation",
  "green-coop": "Green Co-op",
};
export const nameOf = (id: string) => NAMES[id] ?? id;

export const COUNTRIES: Record<string, string> = { KE: "Kenya", BR: "Brazil", TR: "Türkiye", ZZ: "Coal Nation" };
export const countryOf = (code: string) => COUNTRIES[code] ?? code;

export const METHODS: Record<string, string> = {
  reforestation: "Reforestation",
  cookstoves: "Clean cookstoves",
  solar: "Solar power",
  "methane-capture": "Methane capture",
};

export const tonnes = (n: number) => `${n.toLocaleString("en-US")} t`;

/** What the agent is trying to do, as a sentence fragment. */
export function describe(step: Action): string {
  switch (step.action) {
    case "REGISTER_PROJECT": return `Submits ${step.params.projectId} for credits`;
    case "REGISTER_VARIANT": return `Clones ${step.params.copyFrom}'s paperwork onto a plot ${step.params.shiftKm} km away`;
    case "MINT_CREDITS": return `Mints ${tonnes(step.params.quantity)} from ${step.params.projectId}`;
    case "TRANSFER_CREDITS": return `Sells batch ${step.params.batchId} to ${nameOf(step.params.to)} in ${countryOf(step.params.toCountry)}`;
    case "RETIRE_CREDITS": return `Retires batch ${step.params.batchId} for ${nameOf(step.params.beneficiary)}`;
    case "BUY_CREDITS": return `Buys batch ${step.params.batchId}`;
    case "REQUEST_ADJUSTMENT": return `Requests a corresponding adjustment for batch ${step.params.batchId}`;
    case "WAIT": return "Waits this round";
  }
}

const FLAGS: Record<string, string> = {
  OVERLAPPING_PROJECT: "overlaps a registered project",
  REUSED_EVIDENCE: "reuses another project's evidence",
  SIMILAR_EVIDENCE: "near-copy of another project's evidence",
  INFLATED_BASELINE: "inflated baseline",
  INCONSISTENT_EVIDENCE: "evidence doesn't add up",
  MANIPULATION_ATTEMPT: "evidence tries to instruct the verifier",
  UNVERIFIED_EVIDENCE: "report not registered by an accredited auditor",
};
export const flagText = (type: string) => FLAGS[type] ?? type.toLowerCase().replace(/_/g, " ");

const REASONS: Record<string, string> = {
  MissingCorrespondingAdjustment: "No corresponding adjustment from the host country, so the tonnes would count twice",
  BatchRetired: "Those credits were already retired for someone else",
  BatchFrozen: "The batch is frozen",
  NotApproved: "The project was never approved",
  ExceedsAttestedReduction: "More than the verifier approved",
  DuplicateBoundaryAndPeriod: "Same land and period as an approved project",
  ProjectExists: "That project is already registered",
  NotOwner: "Not the owner of those credits",
  BatchUnknown: "No such batch",
  AlreadyOwned: "Already owns that batch",
  NotInYourPortfolio: "Not one of this agent's projects",
  UnknownSourceProject: "Can't copy a project that isn't registered",
  ActionNotAllowedForRole: "This role can't do that",
  InvalidAction: "Not a valid move",
};

/** Turns an engine or contract rejection reason into a sentence. */
export function explain(reason?: string): string {
  if (!reason) return "";
  const verifier = reason.match(/^Verifier (REJECTED|REVIEW_REQUIRED): (.*)$/);
  if (verifier) {
    const flags = verifier[2].split(", ").map((f) => (FLAGS[f] ? flagText(f) : f));
    return `${verifier[1] === "REJECTED" ? "Verifier rejected it" : "Verifier held it for review"}: ${flags.join("; ")}`;
  }
  const reused = reason.match(/^EvidenceReused\((.*)\)$/);
  if (reused) return `Its evidence already belongs to ${reused[1]}`;
  return REASONS[reason] ?? reason;
}

export const TOOLS: Record<string, string> = {
  check_evidence_provenance: "Checked the auditor registry",
  check_overlap: "Checked the land boundary for overlaps",
  find_reused_evidence: "Searched for identical evidence",
  find_similar_evidence: "Searched for near-copies of the evidence",
  compare_baseline: "Compared the claim with what the method can deliver",
  lookup_developer_history: "Looked up the developer's history",
  submit_attestation: "Submitted the verdict",
  detect_manipulation: "Scanned the evidence for instructions aimed at the verifier",
  fallback: "Model unavailable, rule checks took over",
};
export const toolText = (tool: string) => TOOLS[tool] ?? tool.replace(/_/g, " ");

export const STATUS_TEXT = { APPROVED: "Approved", REVIEW_REQUIRED: "Held for review", REJECTED: "Rejected" } as const;

export const roleLine = (r: Role) => (r.honest ? "Plays fair" : "Will cheat if the market lets it");

/** "agents claude-sonnet-5-5, verifier claude-haiku-5-5" -> "agents: Claude Sonnet 5.5, verifier: Claude Haiku 5.5" */
export const modelText = (model: string) =>
  model
    .replace(/claude-([a-z]+)-(\d+)-(\d+)/g, (_, tier: string, a: string, b: string) => `Claude ${tier[0].toUpperCase()}${tier.slice(1)} ${a}.${b}`)
    .replace(/\b(agents|verifier) /g, "$1: ");
