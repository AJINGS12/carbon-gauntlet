import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRun, fetchArena, playRound, API, MODES,
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

const emptyMarket = (): Market => ({ round: 0, rows: [], ledger: [], investigations: {}, submissions: {} });

/** Applies one streamed event to a market's state. Pure, so playback can apply events at its own pace. */
function apply(m: Market, e: ArenaEvent): Market {
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

  /** Plays the next round in both markets and reveals it turn by turn. Returns false when the run is over. */
  const playNext = useCallback(async (): Promise<boolean> => {
    const current = marketsRef.current;
    const max = info?.maxRounds ?? 6;
    if (!current.UNPROTECTED.runId || !current.PROTECTED.runId || current.PROTECTED.round >= max) return false;
    const [ue, pe] = await Promise.all([playRound(current.UNPROTECTED.runId), playRound(current.PROTECTED.runId)]);
    const failed = [...ue, ...pe].find((e) => e.type === "error");
    if (failed && failed.type === "error") throw new Error(failed.message);
    const u = turns(ue), p = turns(pe);
    // Only this loop changes the markets while a round plays, so it keeps its own copy and publishes it.
    let mu = u.prelude.reduce(apply, current.UNPROTECTED), mp = p.prelude.reduce(apply, current.PROTECTED);
    setMarkets({ UNPROTECTED: mu, PROTECTED: mp });
    const pace = (ms: number) => sleep(ms / speedRef.current);
    for (let i = 0; i < Math.max(u.turns.length, p.turns.length); i++) {
      const agentId = agentOf(p.turns[i]) ?? agentOf(u.turns[i]) ?? "";
      const roundNo = mp.round;
      const waiting = [u.turns[i], p.turns[i]].every((t) => !t || t.some((e) => e.type === "agent_decision" && e.decision.step.action === "WAIT"));
      setTurn({ round: roundNo, agentId, phase: "thinking", rows: {} });
      await pace(waiting ? 350 : 800);
      mu = (u.turns[i] ?? []).reduce(apply, mu);
      mp = (p.turns[i] ?? []).reduce(apply, mp);
      setMarkets({ UNPROTECTED: mu, PROTECTED: mp });
      const rowU = mu.rows.at(-1)?.agentId === agentId && mu.rows.at(-1)?.round === roundNo ? mu.rows.at(-1) : undefined;
      const rowP = mp.rows.at(-1)?.agentId === agentId && mp.rows.at(-1)?.round === roundNo ? mp.rows.at(-1) : undefined;
      const investigation = rowP?.projectId ? mp.investigations[rowP.projectId] : undefined;
      setTurn({ round: roundNo, agentId, phase: "revealed", rows: { UNPROTECTED: rowU, PROTECTED: rowP }, investigation });
      // Hold long enough to read it: longer when the verifier's checks are being ticked off.
      await pace(waiting ? 700 : 2200 + (investigation?.steps.length ?? 0) * 220);
    }
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

  return {
    info, markets, status, error, speed, setSpeed, turn,
    play: () => run(false),
    step: () => run(true),
    pause: () => { pauseRef.current = true; },
    reset,
  };
}
