import { useEffect, useState } from "react";
import { addressUrl, fetchArena, type ArenaInfo, type Mode } from "./api";
import { TonnageBar } from "./Market";
import { Toy } from "./Avatar";

const STEPS = [
  { title: "Claim", body: "A project submits its land, evidence and the tonnes of CO₂ it says it saved." },
  { title: "Investigate", body: "An AI verifier picks its checks and follows the evidence. Rule checks can only make it stricter." },
  { title: "Enforce", body: "The verdict goes on-chain, and the registry contract refuses anything that breaks the rules." },
];

const CATCHES = [
  "Land claimed twice",
  "Copied reports",
  "Look-alike projects",
  "Inflated baselines",
  "Minting beyond approval",
  "Reselling retired credits",
  "Double counting across borders",
  "Instructions hidden in evidence",
];

export default function Home({ go }: { go: (path: string) => void }) {
  const [info, setInfo] = useState<ArenaInfo | null>(null);
  useEffect(() => { fetchArena().then(setInfo).catch(() => setInfo(null)); }, []);
  const result = info?.result;
  const open = (e: React.MouseEvent) => { e.preventDefault(); go("/arena"); };
  const chain = info?.deployments;

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <h1>Only honest credits make it through.</h1>
          <p className="lede">AI agents try to cheat a carbon market. An AI verifier and an on-chain registry stop them. Watch it happen.</p>
          <div className="cta">
            <a className="button primary big" href="/arena" onClick={open}>Run the gauntlet</a>
            <a className="button big" href="/try" onClick={(e) => { e.preventDefault(); go("/try"); }}>Try to cheat it</a>
          </div>
        </div>

        <figure className="hero-result" aria-label="Result of the recorded run">
          {info && (
            <div className="hero-cast" aria-hidden="true">
              {info.roles.map((r) => <Toy key={r.id} id={r.id} size={34} />)}
              <span>Same agents, same goals</span>
            </div>
          )}
          {result ? (
            (["UNPROTECTED", "PROTECTED"] as Mode[]).map((mode, i) => (
              <div key={mode} className={`result-row ${mode.toLowerCase()}`} style={{ animationDelay: `${0.2 + i * 0.5}s` }}>
                <p className="result-label">{mode === "UNPROTECTED" ? "Without checks" : "With Carbon Gauntlet"}</p>
                <strong>{result[mode].metrics.integrityScore}<small>/100</small></strong>
                <TonnageBar ledger={result[mode].ledger} legend={false} />
              </div>
            ))
          ) : (
            <p className="result-empty">Integrity scores appear here once the API is running.</p>
          )}
          <figcaption>Integrity: the share of credits that are not fraudulent or counted twice.</figcaption>
        </figure>
      </section>

      <section id="how" className="how" aria-labelledby="h-how">
        <h2 id="h-how">How it works</h2>
        <ol className="steps">
          {STEPS.map((s) => (
            <li key={s.title}>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="catches" aria-labelledby="h-catches">
        <h2 id="h-catches">What it catches</h2>
        <ul className="tiles">{CATCHES.map((c) => <li key={c}>{c}</li>)}</ul>
      </section>

      <section className="proof-row" aria-label="Proof">
        <a href={chain?.PROTECTED.chain ? addressUrl(chain.PROTECTED.chain.registry) : "https://sepolia.basescan.org"} target="_blank" rel="noreferrer">
          <strong>Verified contracts</strong><span>Source published on BaseScan</span>
        </a>
        <a href="/arena" onClick={open}>
          <strong>Every move on-chain</strong><span>Even blocked attacks leave a failed transaction</span>
        </a>
      </section>

      <section className="closing">
        <h2>Six rounds. Four agents. See what gets through.</h2>
        <div className="cta">
          <a className="button primary big" href="/arena" onClick={open}>Run the gauntlet</a>
          <a className="button big" href="/try" onClick={(e) => { e.preventDefault(); go("/try"); }}>Try to cheat it</a>
        </div>
      </section>
    </div>
  );
}
