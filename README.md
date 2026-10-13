# Carbon Gauntlet

**Only honest credits make it through.**

Carbon Gauntlet is an AI-powered carbon-credit integrity protocol, stress-tested by adversarial AI agents.
An AI verifier investigates project evidence and issues attestations. A smart-contract registry enforces the credit lifecycle and blocks double counting. Autonomous attacker agents then try to cheat the market, so you can watch weak rules fail and the protocol hold.

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

## Current results (demo mode, seed 42)

| | Unprotected | Protected |
| --- | --- | --- |
| Fraudulent claims accepted | 6 | 0 |
| Attacks blocked | 0 | 7 |
| Credits at risk (tCO2e) | 5,600 | 0 |
| Integrity score | 41 | 100 |
| Honest claims blocked | 0 | 0 |

## Repo layout

```
apps/web/        React (Vite) Arena — deploys to Vercel
apps/api/        Express + TypeScript API, streams rounds over SSE — deploys to Render
  src/verifier/  verifier tools (overlap, evidence reuse/similarity, baseline) + agent loop
  src/agents/    attacker and honest agent policies (plan, act, replan)
  src/engine/    rounds, validation, metrics, run anchoring
  src/chain/     registry adapter (mock now, Base Sepolia next)
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
npm run dev:web                    # http://localhost:5173
```

Contracts:

```bash
npm run contracts:test             # 7 tests: Protected and Unprotected rules
npm run contracts:deploy           # Base Sepolia; needs OPERATOR_PRIVATE_KEY + testnet ETH in contracts/.env
```

## Deploy (all free tiers)

| Part | Where | Notes |
| --- | --- | --- |
| Frontend | Vercel | Root directory `apps/web`; set `VITE_API_URL` to the Render URL |
| API | Render | Uses `render.yaml`; set `CORS_ORIGIN` to the Vercel URL. Ping `/health` every 10 min (cron-job.org) so it doesn't sleep |
| Database | Neon Postgres | Not wired yet; runs are in memory for now |
| Contract | Base Sepolia | Deploy script prints both registry addresses |

## Status

| Done | Next |
| --- | --- |
| CreditRegistry contract + 7 tests | Viem adapter for Base Sepolia |
| Verifier agent: Claude tool-use loop, guardrails, prompt-injection defence, recorded traces, 12/12 on live eval, 21 tests ([docs/verifier.md](docs/verifier.md)) | |
| Agent plans + replanning (deterministic) | LLM agent policies with fallback |
| Engine, metrics, run anchoring, SSE API | Postgres persistence, ledger + results screens, map |
| Minimal Arena | Agent cards, investigation trace view |

## Tests

```bash
npm run contracts:test                            # contract rules, both modes
npm test -w apps/api                              # verifier agent + simulation story (25 tests)
npm run eval:verifier -w apps/api                 # 12 seed projects scored: frauds caught, honest passed
```
