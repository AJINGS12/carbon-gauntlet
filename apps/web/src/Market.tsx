import { useEffect, useRef, useState } from "react";
import type { LedgerRow, Mode, Role } from "./api";
import { txUrl } from "./api";
import type { Investigation, Market, Row, Turn } from "./useArena";
import { Avatar } from "./Avatar";
import { describe, explain, flagText, nameOf, STATUS_TEXT, tonnes, toolText } from "./text";

export const MARKET = {
  UNPROTECTED: { title: "Open market", line: "Every claim is taken on trust." },
  PROTECTED: { title: "Protected market", line: "AI verifier plus on-chain rules." },
} as const;

const linkable = (network?: string) => network === "testnet" || network === "baseSepolia";

// ------------------------------------------------------------------ outcome

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

// ------------------------------------------------------------------ count-up number

function useCountUp(target: number, ms = 700) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setValue(target); from.current = target; return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      setValue(Math.round(a + (target - a) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

// ------------------------------------------------------------------ tonnage bar

export function TonnageBar({ ledger, legend = true }: { ledger: LedgerRow[]; legend?: boolean }) {
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
            title={`Batch ${b.batchId}: ${b.projectId}, ${tonnes(b.quantity)}${b.atRisk ? ", at risk" : ""}`}
          />
        ))}
      </div>
      {legend && (
        <figcaption>
          <span><i className="key clean" />Clean {tonnes(total - risky)}</span>
          <span><i className="key risk" />At risk {tonnes(risky)}</span>
        </figcaption>
      )}
    </figure>
  );
}

// ------------------------------------------------------------------ scoreboard

export function Scoreboard({ mode, market }: { mode: Mode; market: Market }) {
  const m = market.metrics;
  const score = useCountUp(m?.integrityScore ?? 100);
  return (
    <section className={`board ${mode.toLowerCase()}`} aria-label={`${MARKET[mode].title} score`}>
      <div className="board-head">
        <h2>{MARKET[mode].title}</h2>
        <p>{MARKET[mode].line}</p>
      </div>
      <div className="board-score">
        <strong aria-label={`Integrity ${m?.integrityScore ?? 100} out of 100`}>{score}</strong>
        <span>integrity<br />out of 100</span>
      </div>
      <TonnageBar ledger={market.ledger} />
      <dl className="board-stats">
        <div><dt>Fraud accepted</dt><dd className={m?.fraudulentClaimsAccepted ? "bad" : ""}>{m?.fraudulentClaimsAccepted ?? 0}</dd></div>
        <div><dt>Attacks blocked</dt><dd>{m?.attacksBlocked ?? 0}</dd></div>
        <div><dt>Honest blocked</dt><dd className={m?.honestClaimsBlocked ? "bad" : ""}>{m?.honestClaimsBlocked ?? 0}</dd></div>
      </dl>
    </section>
  );
}

// ------------------------------------------------------------------ agents

export function AgentStrip({ roles, markets, turn, focus, onFocus }: {
  roles: Role[]; markets: Record<Mode, Market>; turn: Turn | null; focus: string | null; onFocus: (id: string | null) => void;
}) {
  return (
    <section className="agents" aria-label="The agents">
      {roles.map((r) => {
        const last = (mode: Mode) => markets[mode].rows.filter((x) => x.agentId === r.id && x.decision.step.action !== "WAIT").at(-1);
        const replans = markets.PROTECTED.rows.filter((x) => x.agentId === r.id && x.decision.replanned).length;
        const onStage = turn?.agentId === r.id;
        const selected = focus === r.id;
        return (
          <button
            type="button"
            key={r.id}
            className={`agent ${r.honest ? "honest" : "attacker"} ${onStage ? "on-stage" : ""} ${selected ? "selected" : ""}`}
            aria-pressed={selected}
            title={selected ? "Show every agent's moves" : "Show only this agent's moves"}
            onClick={() => onFocus(selected ? null : r.id)}
          >
            <Avatar id={r.id} honest={r.honest} size={44} active={onStage && turn?.phase === "thinking"} />
            <span className="agent-text">
              <span className="agent-name">{nameOf(r.id)}</span>
              <span className="agent-side">{onStage ? (turn?.phase === "thinking" ? "Deciding…" : "Moving") : r.honest ? "Plays fair" : "Cheats when it can"}</span>
            </span>
            <span className="agent-marks" aria-label="Latest outcome in each market">
              {(["UNPROTECTED", "PROTECTED"] as Mode[]).map((mode) => {
                const row = last(mode);
                const o = row ? outcomeOf(row) : null;
                return <i key={mode} className={`mark ${o?.tone ?? "none"}`} title={`${MARKET[mode].title}: ${o?.label ?? "no move yet"}`} />;
              })}
            </span>
            {replans > 0 && <span className="replans" title={`Changed plan ${replans} times after being blocked`}>↻ {replans}</span>}
          </button>
        );
      })}
    </section>
  );
}

// ------------------------------------------------------------------ history

function Trace({ inv }: { inv: Investigation }) {
  const a = inv.attestation;
  return (
    <div className="trace">
      <p className="trace-title">How the verifier decided</p>
      <ol>{inv.steps.map((s) => <li key={`${s.step}-${s.tool}`}><strong>{toolText(s.tool)}.</strong> {s.reason}</li>)}</ol>
      {a && (
        <p className={`trace-verdict ${a.status.toLowerCase()}`}>
          <strong>{STATUS_TEXT[a.status]}</strong>
          {a.status === "APPROVED" ? `: ${tonnes(a.approvedReduction)}` : a.riskFlags.length ? `: ${a.riskFlags.map((f) => flagText(f.type)).join("; ")}` : ""}
          {a.guardrailOverride ? ". The rule checks made this stricter than the model's verdict." : ""}
        </p>
      )}
    </div>
  );
}

function HistoryRow({ row, market, roles }: { row: Row; market: Market; roles: Role[] }) {
  const o = outcomeOf(row);
  const role = roles.find((r) => r.id === row.agentId);
  const inv = row.projectId ? market.investigations[row.projectId] : undefined;
  const url = linkable(row.result?.network) ? txUrl(row.result?.txHash) : undefined;
  if (row.decision.step.action === "WAIT" && !row.fallback) return null;
  return (
    <li className={`hrow tone-${o.tone}`}>
      <details>
        <summary>
          <Avatar id={row.agentId} honest={role?.honest} size={26} />
          <span className="hrow-what">{describe(row.decision.step)}</span>
          <span className={`stamp ${o.tone}`}>{o.label}</span>
        </summary>
        <div className="hrow-body">
          {row.decision.replanned && <p className="replan">Changed plan after being blocked.</p>}
          {row.decision.reason && <p className="why">“{row.decision.reason}”</p>}
          {row.fallback && <p className="note">{row.fallback}</p>}
          {row.result && !row.result.accepted && <p className="reason">{explain(row.result.reason)}</p>}
          {inv && <Trace inv={inv} />}
          {url && <a className="tx" href={url} target="_blank" rel="noreferrer">View transaction ↗</a>}
        </div>
      </details>
    </li>
  );
}

export function History({ mode, market, roles, focus }: { mode: Mode; market: Market; roles: Role[]; focus: string | null }) {
  const rows = (focus ? market.rows.filter((r) => r.agentId === focus) : market.rows).filter((r) => r.decision.step.action !== "WAIT" || r.fallback);
  const rounds = [...new Set(rows.map((r) => r.round))].sort((a, b) => b - a);
  return (
    <section className={`history ${mode.toLowerCase()}`} aria-label={`${MARKET[mode].title} moves`}>
      <h3>{MARKET[mode].title}</h3>
      {rows.length === 0 && <p className="empty">No moves yet.</p>}
      {rounds.map((round) => (
        <div key={round} className="hround">
          <p className="hround-label">Round {round}</p>
          <ul>{rows.filter((r) => r.round === round).map((r) => <HistoryRow key={r.id} row={r} market={market} roles={roles} />)}</ul>
        </div>
      ))}
    </section>
  );
}
