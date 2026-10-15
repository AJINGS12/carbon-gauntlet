import { describe, expect, it } from "vitest";
import { MockLedger } from "./adapter.js";
import { RunScopedChain } from "./scoped.js";

const DEV = "0x00000000000000000000000000000000000000a1";
const BUYER = "0x00000000000000000000000000000000000000d4";
const project = { projectId: "forest-tr-001", developer: DEV, hostCountry: "TR", boundaryHash: "0xb0", periodStart: 1, periodEnd: 2 };

/** Two runs sharing ONE ledger, the way every Arena run shares the deployed contract. */
async function twoRunsOnOneLedger() {
  const shared = new MockLedger(true);
  return [new RunScopedChain("run111", shared), new RunScopedChain("run222", shared)] as const;
}

describe("run-scoped chain (one deployed contract, many isolated runs)", () => {
  it("lets a second run register the same project with the same evidence", async () => {
    const [a, b] = await twoRunsOnOneLedger();
    for (const run of [a, b]) {
      expect(await run.registerProject(project)).toMatchObject({ accepted: true });
      expect(await run.submitAttestation("forest-tr-001", "APPROVED", 300, "0xev")).toMatchObject({ accepted: true });
      expect(await run.mintCredits("forest-tr-001", DEV, 300)).toMatchObject({ accepted: true, batchId: 1 }); // run-local id
    }
  });

  it("still enforces the rules inside a run", async () => {
    const [a] = await twoRunsOnOneLedger();
    await a.registerProject(project);
    await a.submitAttestation("forest-tr-001", "APPROVED", 300, "0xev");
    await a.registerProject({ ...project, projectId: "copy", boundaryHash: "0xb9" });
    expect(await a.submitAttestation("copy", "APPROVED", 300, "0xev")).toMatchObject({ accepted: false, reason: "EvidenceReused(forest-tr-001)" }); // tag stripped
  });

  it("maps run-local batch numbers, so one run can't touch another run's batches", async () => {
    const [a, b] = await twoRunsOnOneLedger();
    for (const run of [a, b]) {
      await run.registerProject(project);
      await run.submitAttestation("forest-tr-001", "APPROVED", 300, "0xev");
      await run.mintCredits("forest-tr-001", DEV, 300);
    }
    expect(await b.retireCredits(1, DEV, "client")).toMatchObject({ accepted: true });      // b's batch 1
    expect(await a.transferCredits(1, DEV, BUYER, "TR")).toMatchObject({ accepted: true }); // a's batch 1 is untouched
    expect(await a.transferCredits(7, DEV, BUYER, "TR")).toMatchObject({ accepted: false, reason: "BatchUnknown" });
  });
});
