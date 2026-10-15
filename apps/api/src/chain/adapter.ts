import type { Mode } from "../types.js";

/**
 * One interface, three backends: mock (in-memory, mirrors the contract rules), local Hardhat node,
 * or Base Sepolia. Frontend and agent work never wait on a deployment (section 12).
 * Every call resolves to accepted/rejected with a reason instead of throwing, so the engine can
 * log rejected attacks as data.
 */
export interface TxResult { accepted: boolean; reason?: string; txHash?: string; batchId?: number }

export interface ChainAdapter {
  registerProject(p: { projectId: string; developer: string; hostCountry: string; boundaryHash: string; periodStart: number; periodEnd: number }): Promise<TxResult>;
  submitAttestation(projectId: string, status: "APPROVED" | "REVIEW_REQUIRED" | "REJECTED", attestedReduction: number, evidenceHash: string): Promise<TxResult>;
  mintCredits(projectId: string, actor: string, quantity: number): Promise<TxResult>;
  recordCorrespondingAdjustment(batchId: number, buyerCountry: string): Promise<TxResult>;
  transferCredits(batchId: number, actor: string, to: string, toCountry: string): Promise<TxResult>;
  freezeCredits(batchId: number, reason: string): Promise<TxResult>;
  retireCredits(batchId: number, actor: string, beneficiary: string): Promise<TxResult>;
  anchorRun(runId: string, runHash: string): Promise<TxResult>;
}

type BatchStatus = "ACTIVE" | "FROZEN" | "RETIRED";

/** In-memory ledger with the same rules as contracts/CreditRegistry.sol. */
export class MockLedger implements ChainAdapter {
  private projects = new Map<string, { developer: string; hostCountry: string; boundaryKey: string; status?: string; attested: number; minted: number }>();
  private boundaryOwner = new Map<string, string>();   // reserved only by APPROVED projects (as in the contract)
  private evidenceOwner = new Map<string, string>();
  private batches = new Map<number, { projectId: string; owner: string; status: BatchStatus; adjusted: boolean }>();
  private nextBatchId = 1;
  private tx = 0;

  constructor(private readonly strict: boolean) {}

  private ok(extra: Partial<TxResult> = {}): TxResult {
    return { accepted: true, txHash: `mock-${this.strict ? "p" : "u"}-${++this.tx}`, ...extra };
  }
  private no(reason: string): TxResult { return { accepted: false, reason }; }

  async registerProject(p: Parameters<ChainAdapter["registerProject"]>[0]) {
    if (this.projects.has(p.projectId)) return this.no("ProjectExists");
    const boundaryKey = `${p.boundaryHash}:${p.periodStart}:${p.periodEnd}`;
    if (this.strict && this.boundaryOwner.has(boundaryKey)) return this.no("DuplicateBoundaryAndPeriod");
    this.projects.set(p.projectId, { developer: p.developer, hostCountry: p.hostCountry, boundaryKey, attested: 0, minted: 0 });
    return this.ok();
  }

  async submitAttestation(projectId: string, status: string, attested: number, evidenceHash: string) {
    const p = this.projects.get(projectId);
    if (!p) return this.no("ProjectUnknown");
    const original = this.evidenceOwner.get(evidenceHash);
    if (this.strict && original && original !== projectId) return this.no(`EvidenceReused(${original})`);
    if (status === "APPROVED") {
      const landOwner = this.boundaryOwner.get(p.boundaryKey);
      if (this.strict && landOwner && landOwner !== projectId) return this.no("DuplicateBoundaryAndPeriod");
      if (!original) this.evidenceOwner.set(evidenceHash, projectId);
      if (!landOwner) this.boundaryOwner.set(p.boundaryKey, projectId);
    }
    Object.assign(p, { status, attested });
    return this.ok();
  }

  async mintCredits(projectId: string, actor: string, quantity: number) {
    const p = this.projects.get(projectId);
    if (!p) return this.no("ProjectUnknown");
    if (actor !== p.developer) return this.no("NotOwner");
    if (this.strict && p.status !== "APPROVED") return this.no("NotApproved");
    if (this.strict && p.minted + quantity > p.attested) return this.no("ExceedsAttestedReduction");
    p.minted += quantity;
    const batchId = this.nextBatchId++;
    this.batches.set(batchId, { projectId, owner: actor, status: "ACTIVE", adjusted: false });
    return this.ok({ batchId });
  }

  async recordCorrespondingAdjustment(batchId: number) {
    const b = this.batches.get(batchId);
    if (!b) return this.no("BatchUnknown");
    b.adjusted = true;
    return this.ok();
  }

  async transferCredits(batchId: number, actor: string, to: string, toCountry: string) {
    const b = this.batches.get(batchId);
    if (!b) return this.no("BatchUnknown");
    if (actor !== b.owner) return this.no("NotOwner");
    if (this.strict) {
      if (b.status === "FROZEN") return this.no("BatchFrozen");
      if (b.status === "RETIRED") return this.no("BatchRetired");
      if (toCountry !== this.projects.get(b.projectId)!.hostCountry && !b.adjusted) return this.no("MissingCorrespondingAdjustment");
    }
    b.owner = to;
    return this.ok();
  }

  async freezeCredits(batchId: number) {
    const b = this.batches.get(batchId);
    if (!b) return this.no("BatchUnknown");
    if (b.status === "RETIRED") return this.no("BatchRetired");
    b.status = "FROZEN";
    return this.ok();
  }

  async retireCredits(batchId: number, actor: string) {
    const b = this.batches.get(batchId);
    if (!b) return this.no("BatchUnknown");
    if (actor !== b.owner) return this.no("NotOwner");
    if (this.strict && b.status !== "ACTIVE") return this.no(b.status === "FROZEN" ? "BatchFrozen" : "BatchRetired");
    b.status = "RETIRED";
    return this.ok();
  }

  async anchorRun() { return this.ok(); }
}

/** CHAIN_MODE: "mock" (default, in-memory), "local" (Hardhat node) or "testnet" (Base Sepolia). */
export async function createChain(mode: Mode): Promise<ChainAdapter> {
  const chainMode = process.env.CHAIN_MODE ?? "mock";
  if (chainMode === "testnet" || chainMode === "local") {
    const { createViemAdapter } = await import("./viem-adapter.js");
    return createViemAdapter(mode === "PROTECTED");
  }
  return new MockLedger(mode === "PROTECTED");
}
