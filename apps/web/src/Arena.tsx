import { useRef, useState } from "react";
import type { Mode } from "./api";
import { useArena } from "./useArena";
import { AgentStrip, History, MARKET, Scoreboard } from "./Market";
import { Stage } from "./Stage";
import { SiteMap } from "./SiteMap";
import { LedgerTable, Results } from "./Results";
import { ArenaTabs } from "./ArenaTabs";

const SPEEDS = [1, 2, 4];
/** Shown on the stage while the API is still loading the real roles. */
const CAST = ["honest-dev", "opportunist-dev", "broker", "coal-nation"].map((id) => ({ id, name: id, honest: id === "honest-dev", country: "", goal: "", portfolio: [] }));

export default function Arena({ go }: { go: (path: string) => void }) {
  const { info, markets, status, error, speed, setSpeed, turn, live, goLive, play, step, pause, reset } = useArena();
  const [liveOpen, setLiveOpen] = useState(false);
  const [code, setCode] = useState("");
  const [liveError, setLiveError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const liveInfo = info?.live;
  const startLive = async (e: React.FormEvent) => {
    e.preventDefault();
    setStarting(true);
    setLiveError(null);
    try {
      await goLive(code.trim());
      setLiveOpen(false);
      setCode("");
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : "Couldn't start a live run.");
    } finally {
      setStarting(false);
    }
  };
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState<Mode>("PROTECTED");
  const [explore, setExplore] = useState(false);
  const max = info?.maxRounds ?? 6;
  const round = markets.PROTECTED.round;
  const playing = status === "playing";
  const busy = status === "loading" || status === "error";
  const stageRef = useRef<HTMLDivElement>(null);
  const rec = info?.deployments.PROTECTED.recording;
  const liveTurn = playing || status === "paused" ? turn : null;

  // Bring the stage into view when playback starts, if it's below the fold.
  const toStage = () => {
    const el = stageRef.current;
    if (!el || el.getBoundingClientRect().top < window.innerHeight * 0.4) return;
    el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };

  return (
    <div className="page arena">
      <h1 className="sr-only">The Arena</h1>
      <ArenaTabs active="watch" go={go} badge={live ? <span className="live-badge">Live</span> : undefined} />
      <section className="controls" aria-label="Playback">
        <ol className="rounds" aria-label={`Round ${round} of ${max}`}>
          {Array.from({ length: max }, (_, i) => (
            <li key={i} className={i < round ? "done" : i === round && playing ? "now" : ""} />
          ))}
        </ol>
        <div className="buttons">
          {playing ? (
            <button type="button" className="primary" onClick={pause}>Pause</button>
          ) : status === "finished" ? (
            <button type="button" className="primary" onClick={() => void reset()}>Watch again</button>
          ) : (
            <button type="button" className="primary" onClick={() => { toStage(); void play(); }} disabled={busy}>
              {round === 0 ? "Run the gauntlet" : "Continue"}
            </button>
          )}
          <button type="button" onClick={() => { toStage(); void step(); }} disabled={playing || busy || status === "finished"}><span className="hide-phone">Next round</span><span className="phone-only">Next</span></button>
          <button type="button" onClick={() => void reset()} disabled={status === "loading"}>Restart</button>
          <div className="speed" role="radiogroup" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={speed === s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s}×</button>
            ))}
          </div>
        </div>
        {status === "error" && <p className="status error" role="alert">{error}</p>}
        {status === "loading" && <p className="status" role="status">Setting up both markets…</p>}
        {live && (status === "ready" || status === "playing" || status === "paused") && (
          <p className="status">Live run: Claude is deciding every move right now, so each turn takes a few seconds longer.</p>
        )}
        {!live && rec && status === "ready" && (
          <p className="status">
            A recorded live run: every agent move and verifier check was made by Claude. Replaying it makes no AI calls.
            {liveInfo?.available && !liveOpen && (
              <> <button type="button" className="link" onClick={() => setLiveOpen(true)}>Run it live instead</button></>
            )}
          </p>
        )}
        {liveOpen && !live && (
          <form className="live-form" onSubmit={(e) => void startLive(e)}>
            <label htmlFor="live-code">Access code for live runs</label>
            <div>
              <input id="live-code" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} required />
              <button type="submit" className="primary" disabled={starting || !code.trim()}>{starting ? "Starting…" : "Start live run"}</button>
              <button type="button" onClick={() => { setLiveOpen(false); setLiveError(null); }}>Cancel</button>
            </div>
            <p className="fine">Claude plays every move now: about 3 to 6 minutes for six rounds. {liveInfo?.remainingToday ?? 0} live {liveInfo?.remainingToday === 1 ? "run" : "runs"} left today.</p>
            {liveError && <p className="status error" role="alert">{liveError}</p>}
          </form>
        )}
      </section>

      {info && <AgentStrip roles={info.roles} markets={markets} turn={liveTurn} focus={focus} onFocus={setFocus} />}

      <div ref={stageRef} className="stage-anchor">
        <Stage turn={liveTurn} roles={info?.roles ?? CAST} status={status} round={round} max={max} speed={speed} />
      </div>

      <div className="boards">
        <Scoreboard mode="UNPROTECTED" market={markets.UNPROTECTED} />
        <Scoreboard mode="PROTECTED" market={markets.PROTECTED} />
      </div>

      {info && status === "finished" && <Results info={info} markets={markets} />}

      {info && round > 0 && (
        <section className="moves" aria-labelledby="h-moves">
          <div className="section-head">
            <h2 id="h-moves">Every move{focus ? ` by ${info.roles.find((r) => r.id === focus)?.name}` : ""}</h2>
            {focus && <button type="button" className="link" onClick={() => setFocus(null)}>Show all agents</button>}
          </div>
          <p className="hint">Open a move to see the agent's reasoning, the verifier's checks and the transaction.</p>
          <div className="histories">
            <History mode="UNPROTECTED" market={markets.UNPROTECTED} roles={info.roles} focus={focus} />
            <History mode="PROTECTED" market={markets.PROTECTED} roles={info.roles} focus={focus} />
          </div>
        </section>
      )}

      {info && (
        <section className="explore" aria-labelledby="h-explore">
          <div className="section-head">
            <h2 id="h-explore">The market up close</h2>
            <button type="button" onClick={() => setExplore((x) => !x)} aria-expanded={explore}>{explore ? "Hide map and ledger" : "Show map and ledger"}</button>
          </div>
          {explore && (
            <>
              <div className="seg-toggle" role="radiogroup" aria-label="Market to show">
                {(["UNPROTECTED", "PROTECTED"] as Mode[]).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={view === m} className={view === m ? "on" : ""} onClick={() => setView(m)}>{MARKET[m].title}</button>
                ))}
              </div>
              <div className="detail-body">
                <SiteMap info={info} market={markets[view]} />
                <LedgerTable ledger={markets[view].ledger} />
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
