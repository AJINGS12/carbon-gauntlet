import { useEffect, useState } from "react";
import type { Mode, Role } from "./api";
import type { Row, Turn, Status } from "./useArena";
import { Avatar } from "./Avatar";
import { describe, explain, nameOf, toolText } from "./text";
import { outcomeOf, MARKET } from "./Market";

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Types text out, so the agent's reasoning reads as if it were being written now. */
function Typed({ text, cps = 70 }: { text: string; cps?: number }) {
  const [n, setN] = useState(reduceMotion() ? text.length : 0);
  useEffect(() => {
    if (reduceMotion()) { setN(text.length); return; }
    setN(0);
    const id = setInterval(() => setN((k) => (k >= text.length ? (clearInterval(id), k) : k + 2)), 2000 / cps);
    return () => clearInterval(id);
  }, [text, cps]);
  return <>{text.slice(0, n)}{n < text.length && <span className="caret" aria-hidden="true" />}</>;
}

function Pane({ mode, row, turn }: { mode: Mode; row?: Row; turn: Turn }) {
  const thinking = turn.phase === "thinking";
  const o = row ? outcomeOf(row) : null;
  const steps = mode === "PROTECTED" ? turn.investigation?.steps ?? [] : [];
  const waits = row?.decision.step.action === "WAIT";
  return (
    <div className={`pane ${mode.toLowerCase()}`}>
      <p className="pane-label">{MARKET[mode].title}</p>
      {thinking || !row ? (
        <p className="deciding">Deciding<span className="dots" aria-hidden="true"><i /><i /><i /></span></p>
      ) : (
        <>
          <p className="move">{describe(row.decision.step)}</p>
          {row.decision.reason && <p className="thought">“<Typed text={row.decision.reason} />”</p>}
          {steps.length > 0 && (
            <ol className="checks" aria-label="Verifier checks">
              {steps.map((s, i) => (
                <li key={i} style={{ animationDelay: `${0.5 + i * 0.22}s` }}>{toolText(s.tool)}</li>
              ))}
            </ol>
          )}
          {!waits && o && (
            <div className={`verdict-stamp ${o.tone}`} style={{ animationDelay: `${0.7 + steps.length * 0.22}s` }}>
              <strong>{o.label}</strong>
              {row.result && !row.result.accepted && <span>{explain(row.result.reason)}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Stage({ turn, roles, status, round, max }: { turn: Turn | null; roles: Role[]; status: Status; round: number; max: number }) {
  const role = roles.find((r) => r.id === turn?.agentId);

  if (!turn || !role) {
    return (
      <section className="stage idle" aria-label="Current turn">
        <div className="stage-cast">
          {roles.map((r) => <Avatar key={r.id} id={r.id} honest={r.honest} size={56} />)}
        </div>
        <p className="stage-title">
          {status === "finished" ? "All six rounds played." : "Four agents. Two markets. Six rounds."}
        </p>
        <p className="stage-sub">
          {status === "finished"
            ? "Scroll down for the results."
            : "Each turn, an agent makes its move in both markets. Watch the open market let fraud through while the protected one stops it."}
        </p>
      </section>
    );
  }

  return (
    <section className="stage" aria-label="Current turn" aria-live="polite">
      <header className="stage-head">
        <Avatar id={role.id} honest={role.honest} size={56} active={turn.phase === "thinking"} />
        <div>
          <p className="stage-round">Round {turn.round || round} of {max}</p>
          <h2>{nameOf(role.id)}</h2>
        </div>
        <span className={`side-tag ${role.honest ? "honest" : "attacker"}`}>{role.honest ? "Plays fair" : "Cheats when it can"}</span>
      </header>
      <div className="panes" key={`${turn.round}-${turn.agentId}-${turn.phase}`}>
        <Pane mode="UNPROTECTED" row={turn.rows.UNPROTECTED} turn={turn} />
        <Pane mode="PROTECTED" row={turn.rows.PROTECTED} turn={turn} />
      </div>
    </section>
  );
}
