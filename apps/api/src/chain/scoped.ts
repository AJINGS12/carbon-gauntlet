import { createHash } from "node:crypto";
import type { ChainAdapter, TxResult } from "./adapter.js";

/**
 * Gives every simulation run its own isolated market on a shared deployed registry.
 *
 * Without this, run #2 on the same contract collides with run #1: its projects already exist,
 * its evidence fingerprints are already owned, and batch numbers keep counting up.
 *  - project IDs are prefixed with a short run tag (still readable on the block explorer)
 *  - evidence and boundary fingerprints are salted with the tag
 *  - batch IDs are mapped from the run's own sequence (1, 2, 3, …) to the contract's global IDs,
 *    so recorded agent decisions ("buy batch 7") mean the same batch on any chain
 * The engine and the agents only ever see run-local IDs.
 */
export class RunScopedChain implements ChainAdapter {
  private readonly toChain = new Map<number, number>();
  private nextLocal = 1;

  constructor(private readonly tag: string, private readonly inner: ChainAdapter) {}

  private pid = (projectId: string) => `${this.tag}:${projectId}`;
  private salt = (hash: string) => "0x" + createHash("sha256").update(`${this.tag}|${hash}`).digest("hex");
  private chainBatch = (local: number) => this.toChain.get(local) ?? 0; // 0 never exists on-chain → BatchUnknown
  private clean = (r: TxResult): TxResult => (r.reason ? { ...r, reason: r.reason.split(`${this.tag}:`).join("") } : r);

  async registerProject(p: Parameters<ChainAdapter["registerProject"]>[0]) {
    return this.clean(await this.inner.registerProject({ ...p, projectId: this.pid(p.projectId), boundaryHash: this.salt(p.boundaryHash) }));
  }
  async submitAttestation(projectId: string, status: "APPROVED" | "REVIEW_REQUIRED" | "REJECTED", attested: number, evidenceHash: string) {
    return this.clean(await this.inner.submitAttestation(this.pid(projectId), status, attested, this.salt(evidenceHash)));
  }
  async mintCredits(projectId: string, actor: string, quantity: number) {
    const r = this.clean(await this.inner.mintCredits(this.pid(projectId), actor, quantity));
    if (!r.accepted || r.batchId === undefined) return r;
    const local = this.nextLocal++;
    this.toChain.set(local, r.batchId);
    return { ...r, batchId: local };
  }
  async recordCorrespondingAdjustment(batchId: number, buyerCountry: string) {
    return this.clean(await this.inner.recordCorrespondingAdjustment(this.chainBatch(batchId), buyerCountry));
  }
  async transferCredits(batchId: number, actor: string, to: string, toCountry: string) {
    return this.clean(await this.inner.transferCredits(this.chainBatch(batchId), actor, to, toCountry));
  }
  async freezeCredits(batchId: number, reason: string) {
    return this.clean(await this.inner.freezeCredits(this.chainBatch(batchId), reason));
  }
  async retireCredits(batchId: number, actor: string, beneficiary: string) {
    return this.clean(await this.inner.retireCredits(this.chainBatch(batchId), actor, beneficiary));
  }
  anchorRun(runId: string, runHash: string) {
    return this.inner.anchorRun(runId, runHash);
  }
}
