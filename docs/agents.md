# The Agents

Four AI actors trade in the simulated market. Their **goals and capabilities are fixed**; their **strategy is not**. Each round, Claude decides each agent's next move from what that agent can see.

| Agent | Goal | Can do |
| --- | --- | --- |
| Honest Developer | Earn revenue from real, verified projects | Register its projects, mint what was approved, retire |
| Opportunist Developer | Get as many credits minted as possible | Register its prepared (flawed) submissions, clone other projects' paperwork onto shifted plots, mint |
| Credit Broker | Maximise resale profit | Retire, transfer, register a look-alike project, clone, mint |
| Coal Nation | Meet its national target cheaply | Buy foreign credits, request a corresponding adjustment, retire |

## How a decision is made

1. **Observation.** The engine builds what the agent can see: its prepared submissions (attackers also see what they know is wrong with their own), its credit batches, credits for sale, registered projects and their verdicts, and its own history of accepted and rejected actions with the reasons. It does **not** reveal whether the market is protected; agents find out from their results.
2. **Decision.** Claude calls a single `decide` tool with a one-sentence in-character reason, a plan of up to 3 moves, and one action. Only the role's actions are offered.
3. **Validation.** The action is schema-checked (Zod) and checked against the role. The engine, not the agent, decides what happens: the registry contract accepts or rejects it.
4. **Memory.** The result, including the rejection reason, goes into the agent's history for the next round. When an agent's action is rejected and it chooses a new plan, the Arena shows the old and new plan side by side.

## Attacks are classified by the engine, not the agent

Whether an action counts as an attack is decided from facts, so the metrics can't be gamed by how an agent describes itself:

| Action | Counts as an attack when |
| --- | --- |
| Register a project | It is a planted fraud or a cloned variant |
| Clone a project (`REGISTER_VARIANT`) | Always: the paperwork is copied |
| Mint | The project is fraudulent, or the quantity exceeds what was approved |
| Transfer / buy | The batch is retired or frozen, or it crosses borders with no corresponding adjustment |
| Retire | The batch is already retired or frozen |

## Emergent attacks

`REGISTER_VARIANT` lets an attacker invent its own fraud: clone any registered project's paperwork onto a plot shifted a chosen distance east. A small shift is caught by the overlap check. A large shift avoids the overlap, but the evidence is a word-for-word copy, so the reused-evidence check rejects it.

**Limitation, stated plainly:** a fully fabricated project with original fake evidence and no overlap would need independent data (satellite or IoT) to catch. That is out of scope for this prototype and is on the roadmap.

## Reliability

| Situation | Behaviour |
| --- | --- |
| No API key | Scripted policy that plays the reference story |
| Model error, timeout, or two invalid answers | `agent_fallback` event, then the scripted policy for that turn; the script skips steps already done |
| Demo mode | Replays a recorded live run (agents and verifier); scripted policy for anything not recorded. Never calls the API |
| Edited or invalid recording | Rejected by schema and role checks (`ActionNotAllowedForRole`) |

## Run it

```bash
npm run sim -w apps/api                  # both modes, printed as a story, with a pass/fail scorecard
npm run sim -w apps/api -- --record      # live, and record the run for demo mode (commit data/traces/)
npm run sim -w apps/api -- --demo        # replay the recording with no API calls
npm test -w apps/api                     # includes 10 agent tests driven by a scripted fake model
```

The scorecard fails if the Protected run lets any fraud through, blocks an honest claim, or shows no agent replanning.

## First live run (15 Oct 2026, claude-sonnet-5-5)

| | Unprotected | Protected |
| --- | --- | --- |
| Fraudulent claims accepted | 8 | 0 |
| Attacks blocked | 0 | 12 |
| Credits at risk (tCO2e) | 6,400 | 0 |
| Honest claims blocked | 0 | 0 |
| Replans | 0 | 10 |
| Model fallbacks | 0 | 0 |

What the agents did on their own:
- The Opportunist led with its biggest fraud, then after each rejection read the reason and switched tactics. It invented four clone attacks, shifting copied paperwork 15–20 km to dodge the overlap check; the evidence fingerprint caught every one.
- The Broker retired a batch for one client, then tried to sell it again. Blocked, it moved to a look-alike project, then clones of two different projects.
- Coal Nation tried to count foreign credits with no corresponding adjustment. Blocked, it requested the adjustment and bought legally, and stayed compliant for the rest of the run.

**Flaw found and fixed:** in the Unprotected run an agent said *"the registry approved my project without verification"*. The market view had labelled approvals `APPROVED (no verification)`, which revealed the mode. Approvals now read identically in both modes, with a regression test.
