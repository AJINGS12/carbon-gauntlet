# On-chain: CreditRegistry on Base Sepolia

The same `CreditRegistry` contract is deployed twice on the Base Sepolia testnet: **Unprotected** (`strictMode = false`) and **Protected** (`strictMode = true`). Every agent action becomes a real transaction, and in Protected mode the contract itself rejects double counting, minting before approval, retired-credit resale, and cross-border transfers without a corresponding adjustment.

## How the app talks to the chain

| `CHAIN_MODE` | What it uses |
| --- | --- |
| `mock` (default) | In-memory ledger with the same rules. No wallet needed |
| `local` | A Hardhat node on your machine |
| `testnet` | The two deployed registries on Base Sepolia |

- **Same rules, proven.** `npm run chain:check -w apps/api` plays the scripted story on the deployed contract and on the mock, and compares every verdict. It passes only if they are identical, twice in a row on the same deployment.
- **Isolated runs.** All runs share one deployed contract. Each run gets its own namespace: project IDs are prefixed with a short run tag, evidence and boundary fingerprints are salted, and batch numbers are mapped from the run's own sequence. So run #2 never collides with run #1, and recorded agent decisions ("buy batch 7") mean the same batch on any chain.
- **Rejections are data.** Each write is simulated first; a revert comes back as `{ accepted: false, reason: "MissingCorrespondingAdjustment" }`, exactly like the mock.
- **Proof of rejection (optional).** With `PROVE_REVERTS=true`, blocked attempts are still sent, so the explorer shows them as **failed transactions**: on-chain proof that the contract refused them.
- **Run anchoring.** At the end of each run, the hash of the full action log is stored on-chain with `anchorRun`, so a published result can be checked against what actually happened.

## Set up (about 15 minutes, free)

1. **Test wallet.** Create a new MetaMask account used only for this project. Never put real funds in it.
2. **Test ETH.** Claim Base Sepolia ETH from the [Optimism Superchain faucet](https://console.optimism.io/faucet) (free, no mainnet balance needed; 0.01 ETH is plenty) or another faucet on [Base's faucet list](https://docs.base.org/base-chain/network-information/network-faucets).
3. **Keys.** Put the wallet's private key in `contracts/.env` and `apps/api/.env` as `OPERATOR_PRIVATE_KEY` (both files are git-ignored), plus `RPC_URL=https://sepolia.base.org` in `contracts/.env`.
4. **Deploy:**
   ```bash
   npm run contracts:test        # 8 tests must pass first
   npm run contracts:deploy      # prints the two registry addresses
   ```
   Paste the two printed lines into `apps/api/.env` and set `CHAIN_MODE=testnet`.
5. **Prove it:**
   ```bash
   npm run chain:check -w apps/api
   ```
6. **Put real transactions behind the recorded demo** (no API calls; replays the recorded run on-chain and saves the hashes):
   ```bash
   PROVE_REVERTS=true npm run sim -w apps/api -- --demo --save-txs
   ```
   On Windows PowerShell: `$env:PROVE_REVERTS="true"; npm run sim -w apps/api -- --demo --save-txs`.
   Commit `data/traces/`. The hosted demo then links every action to its transaction, without the server holding any wallet key.

Optional: `npx hardhat verify --network baseSepolia <address> true` (and `false` for the other) with `ETHERSCAN_API_KEY` in `contracts/.env` publishes the source on BaseScan.

## Honest limits

- Agents don't hold wallets; the backend relays their actions as the operator and passes the agent's address as `actor`. The rules are still enforced by the contract.
- The verifier is a single trusted key in this prototype. Multiple independent verifiers are on the roadmap.
- This is a testnet: no real credits or value.
