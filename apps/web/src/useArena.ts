import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRun, fetchArena, playRoundStream, startLive, API, MODES,
  type ArenaEvent, type ArenaInfo, type Attestation, type Decision, type LedgerRow, type Metrics, type Mode, type PublicProject,
} from "./api";

export interface ActionResult { accepted: boolean; attack: boolean; reason?: string; txHash?: string; network?: string }
export interface Row { id: string; round: number; agentId: string; decision: Decision; result?: ActionResult; projectId?: string; fallback?: string }
export interface VerifierStep { step: number; tool: string; reason: string; source: "llm" | "replay" | "rules" }
export interface Investigation { projectId: string; steps: VerifierStep[]; attestation?: Attestation }
export interface Submission { project: PublicProject; variantOf?: string; round: number; agentId: string; accepted?: boolean; attack?: boolean }

export interface Market {
  runId?: string;
  round: number;
  rows: Row[];
  metrics?: Metrics;
  ledger: LedgerRow[];
  investigations: Record<string, Investigation>;
  submissions: Record<string, Submission>;
  anchorTx?: string;
}

export const emptyMarket = (): Market => ({ round: 0, rows: [], ledger: [], investigations: {}, submissions: {} });

/** Applies one streamed event to a market's state. Pure, so playback can apply events at its own pace. */
export function apply(m: Market, e: ArenaEvent): Market {
  switch (e.type) {
    case "round_started":
      return { ...m, round: e.round };
    case "agent_fallback":
      return { ...m, rows: [...m.rows, { id: `${m.round}:${e.agentId}`, round: m.round, agentId: e.agentId, fallback: e.reason, decision: { agentId: e.agentId, plan: [], step: { action: "WAIT", params: {} }, reason: "" } }] };
    case "agent_decision": {
      const id = `${m.round}:${e.decision.agentId}`;
      const rows = m.rows.filter((r) => r.id !== id || !r.fallback);
      const fallback = m.rows.find((r) => r.id === id)?.fallback;
      return { ...m, rows: [...rows, { id, round: m.round, agentId: e.decision.agentId, decision: e.decision, fallback }] };
    }
    case "project_submitted": {
      const last = m.rows.at(-1);
      return {
        ...m,
        rows: last ? [...m.rows.slice(0, -1), { ...last, projectId: e.project.projectId }] : m.rows,
        submissions: { ...m.submissions, [e.project.projectId]: { project: e.project, variantOf: e.variantOf, round: m.round, agentId: last?.agentId ?? e.project.developerId } },
      };
    }
    case "verifier_step": {
      const inv = m.investigations[e.projectId] ?? { projectId: e.projectId, steps: [] };
      return { ...m, investigations: { ...m.investigations, [e.projectId]: { ...inv, steps: [...inv.steps, { step: e.step, tool: e.tool, reason: e.reason, source: e.source }] } } };
    }
    case "attestation": {
      const id = e.attestation.projectId;
      const inv = m.investigations[id] ?? { projectId: id, steps: [] };
      return { ...m, investigations: { ...m.investigations, [id]: { ...inv, attestation: e.attestation } } };
    }
    case "action_result": {
      const last = m.rows.at(-1);
      if (!last) return m;
      const result: ActionResult = { accepted: e.accepted, attack: e.attack, reason: e.reason, txHash: e.txHash, network: e.network };
      const sub = last.projectId ? m.submissions[last.projectId] : undefined;
      return {
        ...m,
        rows: [...m.rows.slice(0, -1), { ...last, result }],
        submissions: sub && last.projectId ? { ...m.submissions, [last.projectId]: { ...sub, accepted: e.accepted, attack: e.attack } } : m.submissions,
      };
    }
    case "round_finished":
      return { ...m, round: e.round, metrics: e.metrics, ledger: e.ledger };
    default:
      return m;
  }
}

/** Splits a round's events into agent turns, so both markets can be revealed turn by turn, side by side. */
function turns(events: ArenaEvent[]): { prelude: ArenaEvent[]; turns: ArenaEvent[][]; end: ArenaEvent[] } {
  const prelude: ArenaEvent[] = [], out: ArenaEvent[][] = [], end: ArenaEvent[] = [];
  let prev: ArenaEvent | undefined;
  for (const e of events) {
    if (e.type === "round_started") prelude.push(e);
    else if (e.type === "round_finished" || e.type === "error") end.push(e);
    else if (e.type === "agent_fallback" || (e.type === "agent_decision" && prev?.type !== "agent_fallback")) out.push([e]);
    else (out.at(-1) ?? prelude).push(e);
    prev = e;
  }
  return { prelude, turns: out, end };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The turn on stage: one agent, its move in each market, revealed in two phases. */
export interface Turn {
  round: number;
  agentId: string;
  phase: "thinking" | "revealed";
  rows: Partial<Record<Mode, Row>>;
  investigation?: Investigation;   // the protected market's verifier investigation for this move, if any
}

const agentOf = (events?: ArenaEvent[]): string | undefined => {
  for (const e of events ?? []) {
    if (e.type === "agent_decision") return e.decision.agentId;
    if (e.type === "agent_fallback") return e.agentId;
  }
  return undefined;
};

export type Status = "loading" | "ready" | "playing" | "paused" | "finished" | "error";

export function useArena() {
  const [info, setInfo] = useState<ArenaInfo | null>(null);
  const [markets, setMarkets] = useState<Record<Mode, Market>>({ UNPROTECTED: emptyMarket(), PROTECTED: emptyMarket() });
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [live, setLive] = useState(false);
  const speedRef = useRef(1);
  const pauseRef = useRef(false);
  const busyRef = useRef(false);
  const marketsRef = useRef(markets);
  marketsRef.current = markets;
  speedRef.current = speed;

  const fail = (err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
    setStatus("error");
    busyRef.current = false;
  };

  const reset = useCallback(async () => {
    pauseRef.current = true;
    while (busyRef.current) await sleep(50);
    pauseRef.current = false;
    setError(null);
    setStatus("loading");
    try {
      const arena = info ?? (await fetchArena());
      setInfo(arena);
      const [u, p] = await Promise.all(MODES.map((mode) => createRun(mode)));
      setTurn(null);
      setLive(false);
      setMarkets({
        UNPROTECTED: { ...emptyMarket(), runId: u.runId, metrics: u.metrics, ledger: u.ledger },
        PROTECTED: { ...emptyMarket(), runId: p.runId, metrics: p.metrics, ledger: p.ledger },
      });
      setStatus("ready");
    } catch (err) {
      fail(new Error(`Couldn't reach the Arena API at ${API}. ${err instanceof Error ? err.message : ""} Start it with "npm run dev:api", then reload.`));
    }
  }, [info]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // React's dev mode runs effects twice; set up the markets once
    started.current = true;
    void reset();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Plays the next round in both markets and reveals it turn by turn, side by side.
   * Events stream in as they happen: a replay arrives at once, a live run arrives as Claude decides.
   * Returns false when the run is over.
   */
  const playNext = useCallback(async (): Promise<boolean> => {
    const current = marketsRef.current;
    const max = info?.maxRounds ?? 6;
    if (!current.UNPROTECTED.runId || !current.PROTECTED.runId || current.PROTECTED.round >= max) return false;

    const buf: Record<Mode, ArenaEvent[]> = { UNPROTECTED: [], PROTECTED: [] };
    const done: Record<Mode, boolean> = { UNPROTECTED: false, PROTECTED: false };
    let failure: Error | null = null;
    let wake = () => {};
    for (const mode of MODES)
      playRoundStream(current[mode].runId!, (e) => { buf[mode].push(e); wake(); })
        .catch((err) => { failure = err instanceof Error ? err : new Error(String(err)); })
        .finally(() => { done[mode] = true; wake(); });
    const failed = () => failure ?? (() => { const e = [...buf.UNPROTECTED, ...buf.PROTECTED].find((x) => x.type === "error"); return e?.type === "error" ? new Error(e.message) : null; })();
    const waitFor = (ready: () => boolean) => new Promise<void>((resolve) => {
      const check = () => { if (ready() || failed()) resolve(); else wake = check; };
      check();
    });
    // A turn is complete once the next one has started, the round has ended, or the stream has closed.
    const complete = (mode: Mode, i: number) => { const t = turns(buf[mode]); return done[mode] || t.turns.length > i + 1 || t.end.length > 0; };

    let mu = current.UNPROTECTED, mp = current.PROTECTED;
    const pace = (ms: number) => sleep(ms / speedRef.current);
    for (let i = 0; ; i++) {
      // Agents move in a fixed order, so we know who is thinking before their decision arrives.
      const next = info?.roles[i]?.id;
      if (next) setTurn({ round: mp.round + (i === 0 ? 1 : 0), agentId: next, phase: "thinking", rows: {} });
      const started = Date.now();
      await waitFor(() => complete("UNPROTECTED", i) && complete("PROTECTED", i));
      const err = failed();
      if (err) throw err;
      const u = turns(buf.UNPROTECTED), p = turns(buf.PROTECTED);
      if (i === 0) { mu = u.prelude.reduce(apply, mu); mp = p.prelude.reduce(apply, mp); }
      if (!u.turns[i] && !p.turns[i]) break;
      const agentId = agentOf(p.turns[i]) ?? agentOf(u.turns[i]) ?? "";
      const roundNo = mp.round;
      const waiting = [u.turns[i], p.turns[i]].every((t) => !t || t.some((e) => e.type === "agent_decision" && e.decision.step.action === "WAIT"));
      setTurn({ round: roundNo, agentId, phase: "thinking", rows: {} });
      await pace(Math.max(0, (waiting ? 350 : 800) - (Date.now() - started) * speedRef.current));
      mu = (u.turns[i] ?? []).reduce(apply, mu);
      mp = (p.turns[i] ?? []).reduce(apply, mp);
      setMarkets({ UNPROTECTED: mu, PROTECTED: mp });
      const rowU = mu.rows.at(-1)?.agentId === agentId && mu.rows.at(-1)?.round === roundNo ? mu.rows.at(-1) : undefined;
      const rowP = mp.rows.at(-1)?.agentId === agentId && mp.rows.at(-1)?.round === roundNo ? mp.rows.at(-1) : undefined;
      const investigation = rowP?.projectId ? mp.investigations[rowP.projectId] : undefined;
      setTurn({ round: roundNo, agentId, phase: "revealed", rows: { UNPROTECTED: rowU, PROTECTED: rowP }, investigation });
      // Hold long enough to read it: longer when the verifier's checks are being ticked off.
      await pace(waiting ? 900 : 2700 + (investigation?.steps.length ?? 0) * 220);
    }
    await waitFor(() => done.UNPROTECTED && done.PROTECTED);
    const err = failed();
    if (err) throw err;
    const u = turns(buf.UNPROTECTED), p = turns(buf.PROTECTED);
    mu = u.end.reduce(apply, mu);
    mp = p.end.reduce(apply, mp);
    setMarkets({ UNPROTECTED: mu, PROTECTED: mp });
    const round = p.end.find((e) => e.type === "round_finished");
    if (round?.type === "round_finished" && round.round >= max) {
      // The anchor transaction is only known once the run finishes.
      const anchors = await Promise.all(MODES.map((mode) => fetch(`${API}/runs/${current[mode].runId}`).then((r) => r.json()).then((d) => d.anchorTx as string | undefined).catch(() => undefined)));
      setMarkets((m) => ({ UNPROTECTED: { ...m.UNPROTECTED, anchorTx: anchors[0] }, PROTECTED: { ...m.PROTECTED, anchorTx: anchors[1] } }));
      return false;
    }
    return true;
  }, [info]);

  const run = useCallback(async (oneRound: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    pauseRef.current = false;
    setStatus("playing");
    try {
      let more = true;
      do {
        more = await playNext();
      } while (more && !oneRound && !pauseRef.current);
      busyRef.current = false;
      setStatus(more ? "paused" : "finished");
    } catch (err) {
      fail(err);
    }
  }, [playNext]);

  /** Swaps the replay for a live run: Claude decides every move. Needs the judges' access code. */
  const goLive = useCallback(async (code: string) => {
    if (busyRef.current) return;
    setError(null);
    const started = await startLive(code); // throws with the server's message (wrong code, used up, ...)
    setTurn(null);
    setLive(true);
    setInfo((i) => (i ? { ...i, live: { available: true, remainingToday: started.remainingToday } } : i));
    setMarkets({
      UNPROTECTED: { ...emptyMarket(), runId: started.UNPROTECTED.runId, metrics: started.UNPROTECTED.metrics, ledger: started.UNPROTECTED.ledger },
      PROTECTED: { ...emptyMarket(), runId: started.PROTECTED.runId, metrics: started.PROTECTED.metrics, ledger: started.PROTECTED.ledger },
    });
    setStatus("ready");
  }, []);

  return {
    info, markets, status, error, speed, setSpeed, turn, live, goLive,
    play: () => run(false),
    step: () => run(true),
    pause: () => { pauseRef.current = true; },
    reset,
  };
}
