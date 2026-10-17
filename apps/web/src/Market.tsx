import type { LedgerRow, Mode, Role } from "./api";
import { txUrl } from "./api";
import type { Investigation, Market, Row } from "./useArena";
import { describe, explain, flagText, nameOf, STATUS_TEXT, tonnes, toolText } from "./text";

export const MARKET = {
  UNPROTECTED: { title: "Open market", line: "Claims are approved as submitted and the registry's checks are off." },
  PROTECTED: { title: "Protected market", line: "An AI verifier investigates every claim and the registry enforces the rules on-chain." },
} as const;

const linkable = (network?: string) => network === "testnet" || network === "baseSepolia";

// ------------------------------------------------------------------ outcome stamp

type Outcome = { label: string; tone: "fraud" | "held" | "ok" | "warn" | "idle" };
export function outcomeOf(row: Row): Outcome {
  if (row.decision.step.action === "WAIT") return { label: "Waits", tone: "idle" };
  if (!row.result) return { label: "Pending", tone: "idle" };
  const { accepted, attack } = row.result;
  if (accepted && attack) return { label: "Fraud accepted", tone: "fraud" };
  if (accepted) return { label: "Accepted", tone: "ok" };
  if (attack) return { label: "Blocked", tone: "held" };
  return { label: "Honest claim blocked", tone: "warn" };
}

// ------------------------------------------------------------------ tonnage bar (the signature element)

export function TonnageBar({ ledger }: { ledger: LedgerRow[] }) {
  const total = ledger.reduce((t, b) => t + b.quantity, 0);
  const risky = ledger.filter((b) => b.atRisk).reduce((t, b) => t + b.quantity, 0);
  return (
    <figure className="tonnage">
      <div className="tonnage-bar" role="img" aria-label={`${tonnes(total)} issued, ${tonnes(risky)} at risk`}>
        {ledger.map((b) => (
          <span
            key={b.batchId}
            className={`seg ${b.atRisk ? "risk" : "clean"} ${b.status === "RETIRED" ? "retired" : ""}`}
            style={{ flexGrow: b.quantity }}
            title={`Batch ${b.batchId}: ${b.projectId}, ${tonnes(b.quantity)}, ${b.atRisk ? "at risk" : "clean"}${b.status === "RETIRED" ? ", retired" : ""}`}
          />
        ))}
      </div>
      <figcaption>
        <span><i className="key clean" />Clean {tonnes(total - risky)}</span>
        <span><i className="key risk" />At risk {tonnes(risky)}</span>
        <span><i className="key retired" />Retired</span>
      </figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ investigation trace

function InvestigationTrace({ inv }: { inv: Investigation }) {
  const a = inv.attestation;
  const n = inv.steps.length;
  const rules = inv.steps[0]?.source === "rules";
  const by = rules ? `${n} rule ${n === 1 ? "check" : "checks"}` : `${n} ${n === 1 ? "step" : "steps"} by Claude${inv.steps[0]?.source === "replay" ? ", recorded" : ""}`;
  return (
    <details className="trace">
      <summary>How the verifier decided ({by})</summary>
      <ol>
        {inv.steps.map((s) => (
          <li key={`${s.step}-${s.tool}`}>
            <strong>{toolText(s.tool)}.</strong> {s.reason}
          </li>
        ))}
      </ol>
      {a && (
        <div className={`verdict ${a.status.toLowerCase()}`}>
          <p><strong>{STATUS_TEXT[a.status]}</strong>{a.status === "APPROVED" ? `: ${tonnes(a.approvedReduction)}` : ""}{a.guardrailOverride ? ". Rule checks made this verdict stricter than the model's." : ""}</p>
          {a.riskFlags.length > 0 && (
            <ul>
              {a.riskFlags.map((f, i) => (
                <li key={i}><span className={`sev ${f.severity.toLowerCase()}`}>{f.severity.toLowerCase()}</span> {flagText(f.type)}{f.relatedProjectId ? ` (${f.relatedProjectId})` : ""}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}

// ------------------------------------------------------------------ feed row

function FeedRow({ row, market }: { row: Row; market: Market }) {
  const outcome = outcomeOf(row);
  const inv = row.projectId ? market.investigations[row.projectId] : undefined;
  const url = linkable(row.result?.network) ? txUrl(row.result?.txHash) : undefined;
  const d = row.decision;
  if (d.step.action === "WAIT" && !row.fallback)
    return (
      <li className="row wait">
        <p><span className="who">{nameOf(row.agentId)}</span> waits.{d.reason ? <span className="why"> “{d.reason}”</span> : null}</p>
      </li>
    );
  return (
    <li className={`row tone-${outcome.tone}`}>
      <div className="row-head">
        <span className="who">{nameOf(row.agentId)}</span>
        <span className={`stamp ${outcome.tone}`}>{outcome.label}</span>
      </div>
      {d.replanned && (
        <p className="replan" title={d.previousPlan?.length ? `Old plan: ${d.previousPlan.join("; ")}` : undefined}>
          Changed plan after being blocked
        </p>
      )}
      <p className="what">{describe(d.step)}</p>
      {d.reason && <p className="why">“{d.reason}”</p>}
      {row.fallback && <p className="note">{row.fallback}</p>}
      {row.result && !row.result.accepted && <p className="reason">{explain(row.result.reason)}</p>}
      {(inv || url) && (
        <div className="row-foot">
          {inv && <InvestigationTrace inv={inv} />}
          {url && <a className="tx" href={url} target="_blank" rel="noreferrer">Transaction ↗</a>}
        </div>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ market column

export function MarketColumn({ mode, market, focusAgent }: { mode: Mode; market: Market; focusAgent: string | null }) {
  const m = market.metrics;
  const rounds = [...new Set(market.rows.map((r) => r.round))].sort((a, b) => b - a);
  const rows = focusAgent ? market.rows.filter((r) => r.agentId === focusAgent) : market.rows;
  return (
    <section className={`market ${mode.toLowerCase()}`} aria-labelledby={`h-${mode}`}>
      <header className="market-head">
        <h2 id={`h-${mode}`}>{MARKET[mode].title}</h2>
        <p>{MARKET[mode].line}</p>
      </header>

      <div className="score">
        <div className="integrity">
          <strong>{m ? m.integrityScore : "–"}</strong>
          <span>integrity score<br />out of 100</span>
        </div>
        <dl>
          <div><dt>Fraud accepted</dt><dd className={m?.fraudulentClaimsAccepted ? "bad" : ""}>{m?.fraudulentClaimsAccepted ?? 0}</dd></div>
          <div><dt>Attacks blocked</dt><dd>{m?.attacksBlocked ?? 0}</dd></div>
          <div><dt>Credits at risk</dt><dd className={m?.creditsAtRisk ? "bad" : ""}>{tonnes(m?.creditsAtRisk ?? 0)}</dd></div>
          <div><dt>Honest claims blocked</dt><dd className={m?.honestClaimsBlocked ? "bad" : ""}>{m?.honestClaimsBlocked ?? 0}</dd></div>
        </dl>
      </div>

      <TonnageBar ledger={market.ledger} />

      <div className="feed" aria-live="polite">
        {rows.length === 0 && <p className="empty">{market.round === 0 ? "Nothing has happened yet. Press Run the gauntlet to start round 1." : "No moves by this agent yet."}</p>}
        {rounds.map((round) => {
          const these = rows.filter((r) => r.round === round);
          return these.length ? (
            <section key={round} className="round-group">
              <h3>Round {round}</h3>
              <ul>{these.map((r) => <FeedRow key={r.id} row={r} market={market} />)}</ul>
            </section>
          ) : null;
        })}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ agents

export function AgentStrip({ roles, markets, focus, onFocus }: { roles: Role[]; markets: Record<Mode, Market>; focus: string | null; onFocus: (id: string | null) => void }) {
  const actors = roles;
  return (
    <section className="agents" aria-label="The agents">
      {actors.map((r) => {
        const last = (mode: Mode) => markets[mode].rows.filter((x) => x.agentId === r.id && x.decision.step.action !== "WAIT").at(-1);
        const protectedRows = markets.PROTECTED.rows.filter((x) => x.agentId === r.id);
        const plan = protectedRows.at(-1)?.decision.plan ?? [];
        const replans = protectedRows.filter((x) => x.decision.replanned).length;
        const selected = focus === r.id;
        return (
          <article key={r.id} className={`agent ${r.honest ? "honest" : "attacker"} ${selected ? "selected" : ""}`}>
            <header>
              <h3>{r.name}</h3>
              <p className="side">{r.honest ? "Plays fair" : "Cheats when it can"}</p>
            </header>
            <p className="goal">{r.goal}</p>
            {plan.length > 0 && (
              <div className="plan">
                <p className="plan-label">Plan in the protected market{replans ? `, rewritten ${replans} ${replans === 1 ? "time" : "times"}` : ""}</p>
                <ol>{plan.map((p, i) => <li key={i}>{p}</li>)}</ol>
              </div>
            )}
            <dl className="lasts">
              {(["UNPROTECTED", "PROTECTED"] as Mode[]).map((mode) => {
                const row = last(mode);
                const o = row ? outcomeOf(row) : null;
                return (
                  <div key={mode}>
                    <dt>{MARKET[mode].title}</dt>
                    <dd>{o ? <span className={`stamp small ${o.tone}`}>{o.label}</span> : <span className="quiet">No move yet</span>}</dd>
                  </div>
                );
              })}
            </dl>
            <button type="button" className="link" aria-pressed={selected} onClick={() => onFocus(selected ? null : r.id)}>
              {selected ? "Show every agent's moves" : "Show only this agent's moves"}
            </button>
          </article>
        );
      })}
    </section>
  );
}
