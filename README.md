# Carbon Gauntlet

**Only honest credits make it through.**

Carbon Gauntlet is an AI-powered carbon-credit integrity protocol, stress-tested by adversarial AI agents.
An AI verifier investigates project evidence and issues attestations. A smart-contract registry enforces the credit lifecycle and blocks double counting. Autonomous attacker agents then try to cheat the market, so you can watch weak rules fail and the protocol hold.

**Live:** [carbon-gauntlet.vercel.app](https://carbon-gauntlet.vercel.app) · [How it works](https://carbon-gauntlet.vercel.app/how) · [The Arena](https://carbon-gauntlet.vercel.app/arena) · [Try to cheat it](https://carbon-gauntlet.vercel.app/try)

> Experimental prototype for the **IEEE ClimateChain Global Hackathon 2026** (track: Carbon Markets & Emissions Transparency). All data is synthetic. Not a real carbon registry. See [docs/assumptions.md](docs/assumptions.md).

## How it works

```
AI agents ──actions──▶ Simulation engine ──claims──▶ AI Verifier
                            │                          │ signed attestation
                       validated tx                    ▼
                            └──────────▶ CreditRegistry contract ──events──▶ Arena UI
```

- **AI and evidence produce attestations; the blockchain enforces what happens after.** The chain never claims to prove a forest exists.
- The same attacks run against two registry instances: **Unprotected** (checks off) and **Protected** (checks on).

## Who it's for

A carbon credit should stand for one tonne of CO₂ really kept out of the air. Carbon Gauntlet checks each claim **before** credits are created and keeps a public record that can't be quietly changed.

| User | What they'd use it for |
| --- | --- |
| **Registries and auditors** | Screen every new project before a person reviews it: approve clear cases fast, send suspicious ones to an auditor with the reasons attached |
| **Governments trading credits** (Paris Agreement, Article 6) | The contract won't move a credit across a border until the seller's country records its adjustment, so one tonne is never counted twice |
| **Market designers and policymakers** | Let AI attackers try to break a market's rules before launch, the way banks stress-test |

**Why they'd use it**

- **Cost and speed.** Human checks take months and cost thousands per project: validating one small UK woodland project costs £1,800–2,500 [3], and developers in Africa report 4.5–5 months on average for validation and verification [4]. An automated first check takes seconds and, in our runs, costs well under a dollar.
- **Trust pays.** Buyers already pay more for higher-rated credits, e.g. about $5 more per rating band for reforestation [5]. A tamper-evident public record is how a seller proves quality.
- **The rules point this way.** Core Carbon Principles labels now appear on major registries [6], and Article 6 requires corresponding adjustments to stop double counting [7].
- **Nothing to replace.** It runs alongside existing registries.

**What it would take to run for real:** real data (registry documents, satellite forest maps, the accredited-auditor list), people signing off on rejections, the contract run by registries rather than one company, and a pilot on past projects from a public registry. Today the projects are synthetic.

**The problem, in one number:** a 2023 study in *Science* found that only about 6% of credits from 18 forest-protection projects matched real emission cuts [1]; some developers dispute its methods [2].

<details><summary>Sources</summary>

1. [West et al., Science (2023), via University of Bonn](https://www.uni-bonn.de/en/news/148-2023)
2. [Ecosystem Marketplace: scientists' rebuttal to West et al.](https://www.ecosystemmarketplace.com/articles/press-release-top-scientist-sissue-rebuttal-to-west-et-al-paper/)
3. [UK Woodland Carbon Code: validation costs (2025)](https://www.woodlandcarboncode.org.uk/3-validation)
4. [VCMI: Strengthening VVB Capacities (Feb 2026)](https://vcmintegrity.org/wp-content/uploads/2026/02/Strengthening-VVB-Capacities-Report_February-2026-v4.pdf)
5. [Sylvera: how quality affects carbon credit prices (2025)](https://www.sylvera.com/blog/increase-carbon-project-quality-price)
6. [Verra: first ICVCM CCP labels on the registry](https://verra.org/first-icvcm-ccp-labels-now-active-on-the-verra-registry/)
7. [Corresponding adjustments under Article 6](https://offset8capital.com/articles/corresponding-adjustment-guide/)

</details>

## Results

Recorded live run (16 Oct 2026; Sonnet attackers, Haiku verifier), replayed on Base Sepolia so every action links to a real transaction. Replay it free with `npm run sim -w apps/api -- --demo`.

| | Unprotected | Protected |
| --- | --- | --- |
| Fraudulent claims accepted | 9 | 0 |
| Attacks blocked | 0 | 12 |
| Credits at risk (tCO2e) | 5,950 | 0 |
| Integrity score | 16 | 100 |
| Honest claims blocked | 0 | 0 |
| Agent replans after rejection | 0 | 10 |

### Scripted reference run (no API key)

| | Unprotected | Protected |
| --- | --- | --- |
| Fraudulent claims accepted | 6 | 0 |
| Attacks blocked | 0 | 7 |
| Credits at risk (tCO2e) | 5,250 | 0 |
| Integrity score | 26 | 100 |
| Honest claims blocked | 0 | 0 |

## Ways in

| Page | What it does | Cost |
| --- | --- | --- |
| `/arena` | Replays the recorded live run: Claude's agents and verifier, every move linked to its Base Sepolia transaction | Free, no model calls |
| `/arena`, live | Judges with the access code run it live: Claude decides every move now (Haiku, capped per day). Every live run is saved with its own link, and its fingerprint is anchored on Base Sepolia | Model credit + one testnet tx |
| `/arena?run=…` | Watch a saved live run again, and check in your browser that it matches its on-chain fingerprint | Free |
| `/how` | How it works, who it's for, and what it would take to run for real, with sources | Free |
| `/try` | Try to cheat it yourself: pick one of six tricks and send it through both markets | Free, rule checks only |

## Repo layout

```
apps/web/        React (Vite): home page (/) and the Arena (/arena). Deploys to Vercel
apps/api/        Express + TypeScript API, streams rounds over SSE — deploys to Render
  src/verifier/  verifier tools (overlap, evidence reuse/similarity, baseline) + agent loop
  src/agents/    roles, Claude agent policy, scripted fallback, run recordings
  src/engine/    rounds, validation, metrics, run anchoring
  src/chain/     registry adapters: mock ledger, Base Sepolia (viem), per-run isolation
contracts/       CreditRegistry.sol + Hardhat tests
data/seed/       12 synthetic projects (4 planted frauds, 1 near-miss)
docs/            assumptions
```

## Run locally (under 10 minutes)

Requires Node 20+.

```bash
npm install
cp .env.example apps/api/.env      # defaults run in demo mode with a mock chain
npm run dev:api                    # http://localhost:4000/health
npm run dev:web                    # http://localhost:5173 (home), /arena to run it
```

Contracts:

```bash
npm run contracts:test             # 8 tests: Protected and Unprotected rules
npm run contracts:deploy           # Base Sepolia; needs OPERATOR_PRIVATE_KEY + testnet ETH in contracts/.env
```

## Deploy (all free tiers)

| Part | Where | Notes |
| --- | --- | --- |
| Frontend | Vercel | Root directory `apps/web`; set `VITE_API_URL` to the Render URL |
| API | Render | Uses `render.yaml`; set `CORS_ORIGIN` to the Vercel URL. Ping `/health` every 10 min (cron-job.org) so it doesn't sleep |
| Database | Supabase | Saved live runs: run [docs/records.sql](docs/records.sql) once, then set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` on Render. For on-chain fingerprints also set `ANCHOR_RUNS=true` and `OPERATOR_PRIVATE_KEY` (test wallet) |
| Contract | Base Sepolia | `npm run contracts:deploy`, then `npm run chain:check -w apps/api` ([docs/blockchain.md](docs/blockchain.md)) |

## Status

| Done | Next |
| --- | --- |
| CreditRegistry contract + 8 tests (incl. evidence squatting), **live on Base Sepolia**; contract matches the mock verdict-for-verdict; every demo action is a real transaction ([docs/blockchain.md](docs/blockchain.md)) | |
| Verifier agent: Claude tool-use loop, guardrails, prompt-injection defence, recorded traces, 12/12 on live eval, 21 tests ([docs/verifier.md](docs/verifier.md)) | |
| AI agents: Claude decides each move, invents clone attacks, replans after rejection; objective attack classification; recorded runs; 10 tests ([docs/agents.md](docs/agents.md)) | |
| Engine, metrics, run anchoring, SSE API; live runs saved (Supabase) with a permanent link, fingerprint anchored on-chain and checkable in the browser; a refreshed page picks a live run back up | |
| Arena: both markets played side by side, agent cards with live plans, tonnage bars, the verifier's investigation for every claim, site map with clones, batch ledger, results with on-chain proof, past live runs; deployed on Vercel + Render | Demo video, submission pack |

## Tests

```bash
npm run contracts:test                            # contract rules, both modes
npm test -w apps/api                              # verifier, agents, simulation, chain isolation, saved runs (61 tests)
npm run eval:verifier -w apps/api                 # 12 seed projects scored: frauds caught, honest passed
npm run sim -w apps/api                           # full simulation, both modes, pass/fail scorecard
npm run chain:check -w apps/api                   # deployed contract gives identical verdicts to the mock
```
