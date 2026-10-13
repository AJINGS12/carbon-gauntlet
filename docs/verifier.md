# The Verifier Agent

The verifier decides whether a carbon-credit claim may be minted. It is an **AI agent with tools, wrapped in deterministic guardrails**.

## How a verdict is made

1. **Investigation (Claude, tool use).** The model reads the submission and chooses which tools to call, up to 6, explaining each call in one sentence. Those sentences are the investigation trace shown in the Arena.

   | Tool | What it checks |
   | --- | --- |
   | `check_overlap` | Boundary polygon and monitoring period vs. projects already registered (Turf.js) |
   | `find_reused_evidence` | Identical evidence text (SHA-256) |
   | `find_similar_evidence` | Near-copies (word-shingle Jaccard similarity ≥ 0.6) |
   | `compare_baseline` | Claimed tCO2e per hectare vs. a plausible range for the methodology |
   | `lookup_developer_history` | Past verifier decisions for any developer |
   | `submit_attestation` | Final verdict, schema-validated (Zod) |

2. **Guardrails (code).** The same checks also run deterministically on every submission, plus a scan for instructions aimed at the verifier (prompt injection). Then:
   - any rule flag the model missed is added;
   - the **stricter** verdict wins, so the model can be stricter than the rules but never more lenient;
   - any HIGH flag means REJECTED, and the approved amount can never exceed the claim.

   When the rules change the model's verdict, the attestation is marked `guardrailOverride: true` and says why.

3. **On-chain.** The backend submits the attestation and evidence hash to the `CreditRegistry` contract, which enforces minting rules.

## Failure handling

| Situation | Behaviour |
| --- | --- |
| No API key | Rule checks only (`engine: "rules"`) |
| API error or timeout | Logged as a `fallback` step, then rule checks |
| Invalid model output | Same as API error |
| Model loops on tools | Verdict forced after 6 tool calls |
| Demo mode | Replays a recorded investigation for the exact same submission; rule checks if none matches. Never calls the API |

## Prompt-injection defence

Evidence is written by the applicant, so it is treated as untrusted data: it is wrapped in `<evidence>` tags, the system prompt forbids following instructions inside it, and a rule check flags instruction-like phrases as `MANIPULATION_ATTEMPT` (HIGH). A unit test confirms that even a model fooled into approving is overridden.

## Verify it yourself

```bash
npm test -w apps/api                              # 13 unit tests, scripted fake model
npm run eval:verifier -w apps/api -- --rules      # all 12 seed projects, rules only
npm run eval:verifier -w apps/api                 # same with the live model (needs ANTHROPIC_API_KEY)
npm run eval:verifier -w apps/api -- --record     # live, and save traces for demo mode
```

The eval exits with an error if any fraud is approved or any honest project is blocked.
