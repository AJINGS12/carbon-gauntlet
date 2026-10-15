// Copies the compiled CreditRegistry ABI into the API so it can call the deployed contract.
const fs = require("fs");
const path = require("path");
const artifact = require("../artifacts/contracts/CreditRegistry.sol/CreditRegistry.json");
const out = path.join(__dirname, "../../apps/api/src/chain/registry-abi.ts");
fs.writeFileSync(out, "// Generated from contracts/CreditRegistry.sol by `npm run abi -w contracts`. Do not edit by hand.\nexport const REGISTRY_ABI = " + JSON.stringify(artifact.abi, null, 2) + " as const;\n");
console.log("Wrote " + out);
