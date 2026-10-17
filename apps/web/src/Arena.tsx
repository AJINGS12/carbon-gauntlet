import { useRef, useState } from "react";
import type { Mode } from "./api";
import { useArena } from "./useArena";
import { AgentStrip, MARKET, MarketColumn } from "./Market";
import { SiteMap } from "./SiteMap";
import { LedgerTable, Results } from "./Results";

const SPEEDS = [1, 2, 4];

export default function Arena() {
  const { info, markets, status, error, speed, setSpeed, play, step, pause, reset } = useArena();
  const [focusAgent, setFocusAgent] = useState<string | null>(null);
  const [view, setView] = useState<Mode>("PROTECTED");
  const max = info?.maxRounds ?? 6;
  const round = markets.PROTECTED.round;
  const playing = status === "playing";
  const rec = info?.deployments.PROTECTED.recording;
  const marketsRef = useRef<HTMLDivElement>(null);
  // The action happens in the market feeds: bring them into view when playback starts, if they're below the fold.
  const showMarkets = () => {
    const el = marketsRef.current;
    if (!el || el.getBoundingClientRect().top < window.innerHeight * 0.45) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    <div className="page">
      <header className="arena-head">
        <h1>The Arena</h1>
        <p className="lede">
          Four AI agents trade carbon credits in two markets at once. Three of them cheat. The open market takes every claim on trust;
          the protected market runs Carbon Gauntlet. Same agents, same moves: watch what gets through.
        </p>
      </header>

      <section className="controls" aria-label="Playback">
        <ol className="rounds" aria-label={`Round ${round} of ${max}`}>
          {Array.from({ length: max }, (_, i) => (
            <li key={i} className={i < round ? "done" : i === round && playing ? "now" : ""}>{i + 1}</li>
          ))}
        </ol>
        <div className="buttons">
          {playing ? (
            <button type="button" className="primary" onClick={pause}>Pause after this round</button>
          ) : (
            <button type="button" className="primary" onClick={() => { showMarkets(); void play(); }} disabled={status === "loading" || status === "error" || status === "finished"}>
              {round === 0 ? "Run the gauntlet" : "Continue"}
            </button>
          )}
          <button type="button" onClick={() => { showMarkets(); void step(); }} disabled={playing || status === "loading" || status === "error" || status === "finished"}>Play one round</button>
          <button type="button" onClick={() => void reset()} disabled={status === "loading"}>Start over</button>
          <div className="speed" role="radiogroup" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={speed === s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s}×</button>
            ))}
          </div>
        </div>
        <p className="status" role="status">
          {status === "loading" && "Setting up both markets…"}
          {status === "error" && <span className="error">{error}</span>}
          {(status === "ready" || status === "paused") && (rec
            ? `Replaying a live run recorded on ${new Date(rec.recordedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: the agents' moves and the verifier's checks came from Claude. No AI calls are made now.`
            : info?.demoMode ? "Demo mode: scripted agents and rule checks." : "Live mode: agents and verifier call Claude each round.")}
          {playing && `Playing round ${Math.min(round + 1, max)} of ${max}.`}
          {status === "finished" && "All six rounds played. Results are below."}
        </p>
      </section>

      {info && <AgentStrip roles={info.roles} markets={markets} focus={focusAgent} onFocus={setFocusAgent} />}

      <div className="markets" ref={marketsRef}>
        <MarketColumn mode="UNPROTECTED" market={markets.UNPROTECTED} focusAgent={focusAgent} />
        <MarketColumn mode="PROTECTED" market={markets.PROTECTED} focusAgent={focusAgent} />
      </div>

      {info && status === "finished" && <Results info={info} markets={markets} />}

      {info && (
        <section className="detail" aria-labelledby="h-detail">
          <div className="detail-head">
            <h2 id="h-detail">Where the projects are, and who holds the credits</h2>
            <div className="seg-toggle" role="radiogroup" aria-label="Market to show">
              {(["UNPROTECTED", "PROTECTED"] as Mode[]).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={view === m} className={view === m ? "on" : ""} onClick={() => setView(m)}>{MARKET[m].title}</button>
              ))}
            </div>
          </div>
          <div className="detail-body">
            <SiteMap info={info} market={markets[view]} />
            <LedgerTable ledger={markets[view].ledger} />
          </div>
        </section>
      )}
    </div>
  );
}
