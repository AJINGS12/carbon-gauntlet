# The Verifier Agent

The verifier decides whether a carbon-credit claim may be minted. It is an **AI agent with tools, wrapped in deterministic guardrails**.

## How a verdict is made

1. **Investigation (Claude, tool use).** The model reads the submission and chooses which tools to call, up to 7, explaining each call in one sentence. Those sentences are the investigation trace shown in the Arena.

   | Tool | What it checks |
   | --- | --- |
   | `check_evidence_provenance` | Each report registered by an accredited auditor for THIS project? (simulated MRV registry) |
   | `check_overlap` | Boundary polygon and monitoring period vs. projects already registered (Turf.js) |
   | `find_reused_evidence` | Identical evidence text (SHA-256) |
   | `find_similar_evidence` | Near-copies (word-shingle Jaccard similarity ≥ 0.6) |
   | `compare_baseline` | Claimed tCO2e per hectare vs. a plausible range for the methodology |
   | `lookup_developer_history` | Past verifier decisions for any developer |
   | `submit_attestation` | Final verdict, schema-validated (Zod) |

2. **Guardrails (code).** The same checks also run deterministically on every submission, plus a scan for instructions aimed at the verifier (prompt injection). Then:
   - report ownership comes from provenance, not filing order: a copy is caught whoever files first, and a genuine project is never flagged because a copier filed first;
   - model findings that the tools contradict (an overlap or reused evidence the tools didn't find) are removed, so every factual flag is backed by evidence;
   - rule findings the model missed are added, and findings it under-rated are raised to the rule severity;
   - the **stricter** verdict wins, so the model can be stricter than the rules but never more lenient;
   - any HIGH flag means REJECTED, and the approved amount can never exceed the claim.

   When the guardrails change anything, the attestation is marked `guardrailOverride: true` and its explanation lists each change.

3. **On-chain.** The backend submits the attestation and evidence hash to the `CreditRegistry` contract, which enforces minting rules.

## Failure handling

| Situation | Behaviour |
| --- | --- |
| No API key | Rule checks only (`engine: "rules"`) |
| API error or timeout | Logged as a `fallback` step, then rule checks |
| Invalid model output | Same as API error |
| Model loops on tools | Verdict forced after 7 tool calls |
| Demo mode | Replays a recorded investigation for the exact same submission; rule checks if none matches. Never calls the API |

## Prompt-injection defence

Evidence is written by the applicant, so it is treated as untrusted data: it is wrapped in `<evidence>` tags, the system prompt forbids following instructions inside it, and a rule check flags instruction-like phrases as `MANIPULATION_ATTEMPT` (HIGH). A unit test confirms that even a model fooled into approving is overridden.

## Verify it yourself

```bash
npm test -w apps/api                              # verifier, agents and simulation tests (scripted fake model)
npm run eval:verifier -w apps/api -- --rules      # all 12 seed projects, rules only
npm run eval:verifier -w apps/api                 # same with the live model (needs ANTHROPIC_API_KEY)
npm run eval:verifier -w apps/api -- --record     # live, and save traces for demo mode
```

The eval exits with an error if any fraud is approved or any honest project is blocked.

## First live evaluation (13 Oct 2026, claude-sonnet-5-5)

11/12 on the first run. The one miss was a **data error the model caught**: a synthetic "honest" solar project claimed 800 tCO2e for 610 MWh of displaced diesel, which typical diesel emission factors (about 0.7–0.8 tCO2/MWh) can't support. The model asked for the emission-factor calculation. The seed data was corrected, not the verifier.

The same run showed the model under-rating a 40% overlap, adding an overlap flag its own tool contradicted, and duplicating a rule finding. Each now has a guardrail and a regression test.

**Second run: 12/12.** The model checked the arithmetic itself ("610 MWh × 0.74 = 451 t against 450 claimed"), followed leads to the owner of copied evidence, and on `forest-tr-002` the guardrail visibly raised its REVIEW to REJECTED. It approved 695.6 t on one project; approvals are now rounded down to whole tonnes, because 1 credit = 1 tCO2e and the contract stores integers.
