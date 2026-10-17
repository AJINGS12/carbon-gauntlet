import { useEffect, useState, type CSSProperties } from "react";
import type { Action, Mode, Role } from "./api";
import type { Row, Turn, Status } from "./useArena";
import { Logo, Toy } from "./Avatar";
import { describe, explain, nameOf, toolText } from "./text";
import { outcomeOf, MARKET } from "./Market";

/** True on phone-sized screens; the stage folds its details away there. */
function useIsPhone() {
  const query = "(max-width: 760px)";
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Seconds, at 1× speed: walk to the gate, the gate's check, then walk on or get pushed back. */
const WALK = 0.7, STEP = 0.22, RESULT = 0.6;
const scanFor = (mode: Mode, steps: number) => (mode === "PROTECTED" ? Math.max(0.5, steps * STEP) : 0.25);

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

/** What floats up from the registry when a move goes through. */
function gain(step: Action): string {
  switch (step.action) {
    case "MINT_CREDITS": return `+${step.params.quantity.toLocaleString("en-US")} t`;
    case "REGISTER_PROJECT":
    case "REGISTER_VARIANT": return "Registered";
    case "BUY_CREDITS": return "Bought";
    case "TRANSFER_CREDITS": return "Sold";
    case "RETIRE_CREDITS": return "Retired";
    case "REQUEST_ADJUSTMENT": return "Adjusted";
    default: return "";
  }
}

/** The little scene: the agent walks its move to the gate; the open gate waves it through, the guarded one checks it. */
function Lane({ mode, row, turn, scan }: { mode: Mode; row?: Row; turn: Turn; scan: number }) {
  const thinking = turn.phase === "thinking" || !row;
  const waits = row?.decision.step.action === "WAIT";
  const o = row ? outcomeOf(row) : null;
  const state = thinking ? "thinking" : waits ? "waits" : row?.result?.accepted ? "pass" : "bounce";
  const fraud = o?.tone === "fraud";
  return (
    <div className={`lane ${mode.toLowerCase()} ${state} ${fraud ? "fraud" : ""}`} style={{ "--scan": `${scan}s` } as CSSProperties} aria-hidden="true">
      <span className="lane-path" />
      <span className={`gate ${mode === "PROTECTED" ? "guarded" : "open"}`}>
        {mode === "PROTECTED" ? (
          <>
            <span className="beam" />
            <span className="guard"><Logo size={46} /></span>
            <span className="bar" />
          </>
        ) : (
          <>
            <span className="arch" />
            <span className="gate-note">No checks</span>
          </>
        )}
      </span>
      <span className="vault"><span className="vault-lid" /><span className="vault-label">Registry</span></span>
      <span className="walker">
        <span className="parcel" />
        <Toy id={turn.agentId} size={44} thinking={thinking} mood={waits ? "sleep" : "idle"} />
      </span>
      {state === "pass" && row && <span className={`float ${fraud ? "bad" : ""}`}>{gain(row.decision.step)}</span>}
      {state === "bounce" && <span className="burst">✕</span>}
    </div>
  );
}

function Pane({ mode, row, turn, speed }: { mode: Mode; row?: Row; turn: Turn; speed: number }) {
  const thinking = turn.phase === "thinking" || !row;
  const o = row ? outcomeOf(row) : null;
  const steps = mode === "PROTECTED" ? turn.investigation?.steps ?? [] : [];
  const waits = row?.decision.step.action === "WAIT";
  const scan = scanFor(mode, steps.length);
  const phone = useIsPhone();
  return (
    <div className={`pane ${mode.toLowerCase()}`}>
      <p className="pane-label">{MARKET[mode].title}</p>
      <Lane mode={mode} row={row} turn={turn} scan={scan} />
      {thinking ? (
        <p className="deciding">Deciding<span className="dots" aria-hidden="true"><i /><i /><i /></span></p>
      ) : (
        <>
          <p className="move">{waits ? "Waits this round" : describe(row!.decision.step)}</p>
          {(row!.decision.reason || steps.length > 0) && (
            <details className="why-more" open={!phone || undefined}>
              <summary>Why?{steps.length > 0 ? ` See the verifier's ${steps.length} checks` : ""}</summary>
              {row!.decision.reason && <p className="thought">“<Typed text={row!.decision.reason} />”</p>}
              {steps.length > 0 && (
                <ol className="checks" aria-label="Verifier checks">
                  {steps.map((s, i) => (
                    <li key={i} style={{ animationDelay: `${(phone ? 0 : (WALK + i * STEP) / speed)}s` }}>{toolText(s.tool)}</li>
                  ))}
                </ol>
              )}
            </details>
          )}
          {!waits && o && (
            <div className={`verdict-stamp ${o.tone}`} style={{ animationDelay: `${(WALK + scan + RESULT) / speed}s` }}>
              <strong>{o.label}</strong>
              {row!.result && !row!.result.accepted && <span>{explain(row!.result.reason)}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Stage({ turn, roles, status, round, max, speed }: { turn: Turn | null; roles: Role[]; status: Status; round: number; max: number; speed: number }) {
  const role = roles.find((r) => r.id === turn?.agentId);
  const style = { "--speed": speed } as CSSProperties;

  if (!turn || !role) {
    const loading = status === "loading";
    return (
      <section className="stage idle" style={style} aria-label="Current turn">
        <div className="stage-cast">
          {roles.map((r, i) => (
            <span key={r.id} className="cast-member" style={{ animationDelay: `${i * 0.12}s` }}>
              <Toy id={r.id} size={64} walking={loading || status !== "finished"} />
              <span>{nameOf(r.id)}</span>
            </span>
          ))}
        </div>
        <p className="stage-title">
          {loading ? "Setting up both markets" : status === "finished" ? "All six rounds played." : "Four agents. Two markets. Six rounds."}
        </p>
        <p className="stage-sub">
          {loading ? "Getting the agents ready…"
            : status === "finished" ? "Scroll down for the results."
            : "Each turn, an agent walks its move to the registry in both markets. One gate is open. The other is guarded."}
        </p>
      </section>
    );
  }

  return (
    <section className="stage" style={style} aria-label="Current turn" aria-live="polite">
      <header className="stage-head">
        <div>
          <p className="stage-round">Round {turn.round || round} of {max}</p>
          <h2>{nameOf(role.id)}</h2>
        </div>
        <span className={`side-tag ${role.honest ? "honest" : "attacker"}`}>{role.honest ? "Plays fair" : "Cheats when it can"}</span>
      </header>
      <div className="panes" key={`${turn.round}-${turn.agentId}-${turn.phase}`}>
        <Pane mode="UNPROTECTED" row={turn.rows.UNPROTECTED} turn={turn} speed={speed} />
        <Pane mode="PROTECTED" row={turn.rows.PROTECTED} turn={turn} speed={speed} />
      </div>
    </section>
  );
}
