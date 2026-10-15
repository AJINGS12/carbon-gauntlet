# Assumptions and simplifications

Carbon Gauntlet is an **experimental prototype for the IEEE ClimateChain Global Hackathon 2026**. Everything below is simplified on purpose, and results are not forecasts or real carbon-market claims.

## Data
- All 12 projects in `data/seed/projects.json` are **synthetic**: places, developers, figures and reports are fictional.
- 4 projects carry planted frauds (field `planted`), which the agents and verifier never see.
- `forest-tr-005` is a deliberate **near-miss**: it borders `forest-tr-001` without overlapping, to test for false positives.

## Verifier
- Overlap = polygon intersection (Turf.js) plus overlapping monitoring dates. ≥10% shared area is HIGH severity.
- Similar evidence uses word-shingle Jaccard similarity (threshold 0.6) so it runs offline. Embeddings can replace it later.
- Plausible reduction ranges (tCO2e per hectare per 6 months) are rough illustrative values, not methodology figures:

| Methodology | Range |
| --- | --- |
| Reforestation | 0.5 – 6 |
| Cookstoves | 0.2 – 3 |
| Solar | 1 – 15 |
| Methane capture | 2 – 25 |

## Contract
- One `CreditRegistry` contract, deployed twice: `strictMode = false` (Unprotected) and `true` (Protected).
- Agents don't hold wallets; the backend relays their actions as an operator and passes the agent address as `actor`. Rules are still enforced on-chain.
- The corresponding-adjustment logic is **a simplified ledger inspired by Paris Agreement Article 6**, not a legal implementation of it.
- The verifier is a single trusted key in the MVP. Multiple independent verifiers are on the roadmap.

## Metrics
- Each tonne is counted once, per batch. A fraudulent batch that is later resold or double-claimed is still one batch of tonnes at risk.
- Credits at risk = tonnes in batches that were minted fraudulently or moved in a double claim or retired-credit resale.
- Integrity score = 100 × (1 − credits at risk ÷ all credits issued in the run), i.e. the share of the market that is clean.
