import { ethers } from "hardhat";

// Deploys two registries: Unprotected (strictMode = false) and Protected (strictMode = true).
// Copy the printed addresses into the API's .env.
async function main() {
  const Registry = await ethers.getContractFactory("CreditRegistry");

  const unprotected = await Registry.deploy(false);
  await unprotected.waitForDeployment();

  const protectedReg = await Registry.deploy(true);
  await protectedReg.waitForDeployment();

  console.log("REGISTRY_UNPROTECTED_ADDRESS=" + (await unprotected.getAddress()));
  console.log("REGISTRY_PROTECTED_ADDRESS=" + (await protectedReg.getAddress()));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
