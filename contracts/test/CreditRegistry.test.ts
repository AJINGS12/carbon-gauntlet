import { expect } from "chai";
import { ethers } from "hardhat";

const id = (s: string) => ethers.encodeBytes32String(s);
const TR = "0x5452"; // "TR"
const DE = "0x4445"; // "DE"
const APPROVED = 1;

async function deploy(strict: boolean) {
  const [admin, dev, buyer] = await ethers.getSigners();
  const reg = await (await ethers.getContractFactory("CreditRegistry")).deploy(strict);
  return { reg, admin, dev, buyer };
}

async function approvedBatch(strict: boolean) {
  const ctx = await deploy(strict);
  const { reg, dev } = ctx;
  await reg.registerProject(id("forest-tr-001"), dev.address, TR, id("boundary-1"), 1, 2);
  await reg.submitAttestation(id("forest-tr-001"), APPROVED, 420, id("evidence-1"));
  await reg.mintCredits(id("forest-tr-001"), dev.address, 400);
  return ctx; // batch 1 owned by dev
}

describe("CreditRegistry — Protected (strictMode = true)", () => {
  it("rejects a second project with the same boundary and period", async () => {
    const { reg, dev } = await deploy(true);
    await reg.registerProject(id("p1"), dev.address, TR, id("b"), 1, 2);
    await expect(reg.registerProject(id("p2"), dev.address, TR, id("b"), 1, 2))
      .to.be.revertedWithCustomError(reg, "DuplicateBoundaryAndPeriod");
  });

  it("rejects evidence already used by another project", async () => {
    const { reg, dev } = await deploy(true);
    await reg.registerProject(id("p1"), dev.address, TR, id("b1"), 1, 2);
    await reg.registerProject(id("p2"), dev.address, TR, id("b2"), 1, 2);
    await reg.submitAttestation(id("p1"), APPROVED, 100, id("ev"));
    await expect(reg.submitAttestation(id("p2"), APPROVED, 100, id("ev")))
      .to.be.revertedWithCustomError(reg, "EvidenceReused");
  });

  it("blocks minting before approval and above the attested amount", async () => {
    const { reg, dev } = await deploy(true);
    await reg.registerProject(id("p1"), dev.address, TR, id("b"), 1, 2);
    await expect(reg.mintCredits(id("p1"), dev.address, 10)).to.be.revertedWithCustomError(reg, "NotApproved");
    await reg.submitAttestation(id("p1"), APPROVED, 100, id("ev"));
    await expect(reg.mintCredits(id("p1"), dev.address, 101)).to.be.revertedWithCustomError(reg, "ExceedsAttestedReduction");
  });

  it("blocks cross-border transfer without a corresponding adjustment", async () => {
    const { reg, dev, buyer } = await approvedBatch(true);
    await expect(reg.transferCredits(1, dev.address, buyer.address, DE))
      .to.be.revertedWithCustomError(reg, "MissingCorrespondingAdjustment");
    await reg.recordCorrespondingAdjustment(1, DE);
    await expect(reg.transferCredits(1, dev.address, buyer.address, DE)).to.emit(reg, "CreditsTransferred");
  });

  it("never lets a retired batch move or retire again", async () => {
    const { reg, dev, buyer } = await approvedBatch(true);
    await reg.retireCredits(1, dev.address, "Acme Corp 2026");
    await expect(reg.transferCredits(1, dev.address, buyer.address, TR)).to.be.revertedWithCustomError(reg, "BatchRetired");
    await expect(reg.retireCredits(1, dev.address, "again")).to.be.revertedWithCustomError(reg, "BatchRetired");
  });

  it("blocks transfers of a frozen batch", async () => {
    const { reg, dev, buyer } = await approvedBatch(true);
    await reg.freezeCredits(1, "Overlapping claim under review");
    await expect(reg.transferCredits(1, dev.address, buyer.address, TR)).to.be.revertedWithCustomError(reg, "BatchFrozen");
  });
});

describe("CreditRegistry — Unprotected (strictMode = false)", () => {
  it("lets the same attacks through, so the demo can compare", async () => {
    const { reg, dev, buyer } = await deploy(false);
    await reg.registerProject(id("p1"), dev.address, TR, id("b"), 1, 2);
    await reg.registerProject(id("p2"), dev.address, TR, id("b"), 1, 2); // duplicate accepted
    await reg.mintCredits(id("p2"), dev.address, 500);                    // no attestation needed
    await reg.retireCredits(1, dev.address, "first claim");
    await expect(reg.transferCredits(1, dev.address, buyer.address, DE))   // retired + cross-border resale
      .to.emit(reg, "CreditsTransferred");
  });
});
