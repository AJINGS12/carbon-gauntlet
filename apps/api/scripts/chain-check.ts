/**
 * Proves the deployed contract enforces exactly what the mock ledger does: plays the scripted
 * story (no API calls) on both and compares every verdict, then repeats on the same deployment
 * to prove runs are isolated.
 *
 *   CHAIN_MODE=testnet in apps/api/.env, then:  npm run chain:check -w apps/api
 *
 * About 60 transactions per pass on Base Sepolia: free test ETH only.
 */
import "dotenv/config";

const target = process.env.CHAIN_MODE;
if (target !== "testnet" && target !== "local") {
  console.error("Set CHAIN_MODE=testnet (or local) in apps/api/.env first.");
  process.exit(1);
}
process.env.DEMO_MODE = "true";        // scripted agents, no recordings, no API calls
process.env.TRACES_DIR = "./.chain-check-empty";
delete process.env.PROVE_REVERTS;

const { createRun, playRound, MAX_ROUNDS, setLlmForTesting } = await import("../src/engine/run.js");
setLlmForTesting(null);

async function story(mode: "UNPROTECTED" | "PROTECTED") {
  const run = await createRun(mode);
  const verdicts: string[] = [];
  let txs = 0;
  for (let i = 0; i < MAX_ROUNDS; i++)
    await playRound(run, (e) => {
      if (e.type === "action_result") { verdicts.push(`${e.agentId} ${e.action} → ${e.accepted ? "ACCEPTED" : `BLOCKED ${e.reason}`}`); if (e.txHash?.startsWith("0x")) txs++; }
    });
  return { verdicts, txs, anchor: run.anchorTx };
}

let ok = true;
for (const pass of [1, 2]) {
  for (const mode of ["UNPROTECTED", "PROTECTED"] as const) {
    process.env.CHAIN_MODE = "mock";
    const mock = await story(mode);
    process.env.CHAIN_MODE = target;
    const started = Date.now();
    const real = await story(mode);
    const same = JSON.stringify(mock.verdicts) === JSON.stringify(real.verdicts);
    ok &&= same;
    console.log(`pass ${pass} · ${mode.padEnd(11)} ${same ? "IDENTICAL" : "DIFFERENT"} · ${real.txs} txs in ${Math.round((Date.now() - started) / 1000)} s · anchor ${real.anchor}`);
    if (!same) real.verdicts.forEach((v, i) => v !== mock.verdicts[i] && console.log(`   chain: ${v}\n   mock:  ${mock.verdicts[i]}`));
  }
}
console.log(ok ? "\nPASS  The deployed contract enforces exactly the same rules as the mock, and runs are isolated." : "\nFAIL  See differences above.");
process.exit(ok ? 0 : 1);
