import { useEffect, useState } from "react";
import { addressUrl, fetchArena, REPO_URL, type ArenaInfo, type Mode } from "./api";
import { TonnageBar } from "./Market";

const STEPS = [
  {
    title: "Claim",
    body: "A developer submits a project: its land boundary, monitoring period, evidence, and the tonnes of CO₂ it says it avoided.",
  },
  {
    title: "Investigate",
    body: "An AI verifier decides which checks to run: the auditor registry, overlapping land, copied or near-copied reports, a baseline the method can't support. Rule checks run on every claim too, and can only make the verdict stricter.",
  },
  {
    title: "Enforce",
    body: "The verdict goes on-chain. The registry contract refuses to mint without approval, to reuse land or evidence, to resell retired credits, or to move credits across borders without a corresponding adjustment.",
  },
];

const CATCHES: [string, string][] = [
  ["The same land claimed twice", "Boundary overlap check; approved land is reserved on-chain"],
  ["A copied monitoring report", "Auditor registry and evidence fingerprint"],
  ["A look-alike project in another country", "Near-copy detection on the evidence"],
  ["An inflated baseline", "Plausibility check for the method and area"],
  ["Minting more than was verified", "The contract caps minting at the attested amount"],
  ["Selling credits that were already retired", "The contract blocks any move of a retired batch"],
  ["Counting foreign credits without an adjustment", "Corresponding-adjustment check, modelled on Paris Agreement Article 6"],
  ["Instructions hidden in the evidence", "Prompt-injection guardrail; evidence is treated as data"],
];

const AUDIENCE: [string, string][] = [
  ["Registries", "Test new integrity rules against attackers before they meet real money."],
  ["Auditors", "See an investigation you can follow step by step, with every flag backed by a check."],
  ["Host countries", "Make cross-border transfers carry a corresponding adjustment, enforced in code."],
  ["Credit buyers", "Buy from a market where each tonne is counted once, with a public trail to prove it."],
];

export default function Home({ go }: { go: (path: string) => void }) {
  const [info, setInfo] = useState<ArenaInfo | null>(null);
  useEffect(() => { fetchArena().then(setInfo).catch(() => setInfo(null)); }, []);
  const result = info?.result;
  const open = (e: React.MouseEvent) => { e.preventDefault(); go("/arena"); };

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <h1>Only honest credits make it through.</h1>
          <p className="lede">
            Carbon Gauntlet checks every carbon-credit claim with an AI verifier, enforces the rules in a smart-contract registry,
            and proves it works by letting AI agents try to cheat it.
          </p>
          <div className="cta">
            <a className="button primary" href="/arena" onClick={open}>Run the gauntlet</a>
            <a className="button" href="#how">See how it works</a>
          </div>
          <p className="fine">A prototype for the IEEE ClimateChain Global Hackathon 2026. Synthetic projects on the Base Sepolia testnet.</p>
        </div>

        {result && (
          <figure className="hero-result" aria-labelledby="h-result">
            <figcaption id="h-result">One recorded run: the same agents and the same attacks, in two markets.</figcaption>
            {(["UNPROTECTED", "PROTECTED"] as Mode[]).map((mode) => (
              <div key={mode} className={`result-row ${mode.toLowerCase()}`}>
                <div className="result-score">
                  <strong>{result[mode].metrics.integrityScore}</strong>
                  <span>{mode === "UNPROTECTED" ? "Without checks" : "With Carbon Gauntlet"}</span>
                </div>
                <TonnageBar ledger={result[mode].ledger} />
              </div>
            ))}
            <p className="fine">
              Integrity score: the share of issued credits that are neither fraudulent nor counted twice, out of 100.
              Each block is one batch of credits, sized by tonnes.
            </p>
          </figure>
        )}
      </section>

      <section className="problem">
        <p>
          A carbon credit is a promise that one tonne of CO₂ was kept out of the air. The promise breaks when the same forest is
          claimed twice, a report is copied, a baseline is inflated, or a retired credit is sold again. Carbon Gauntlet checks the
          claim before a credit exists, and enforces the rules for as long as it does.
        </p>
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

      <section id="attackers" className="attackers" aria-labelledby="h-attackers">
        <h2 id="h-attackers">Who tries to break it</h2>
        <p className="section-lede">
          Each agent is Claude with a goal and a set of moves. Nobody scripts its attacks: it reads every rejection and tries something else.
        </p>
        {info && (
          <ul className="cast">
            {info.roles.map((r) => (
              <li key={r.id} className={r.honest ? "honest" : "attacker"}>
                <h3>{r.name}</h3>
                <p className="side">{r.honest ? "Plays fair" : "Cheats when it can"}</p>
                <p>{r.goal}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="catches" aria-labelledby="h-catches">
        <h2 id="h-catches">What it catches</h2>
        <table>
          <thead><tr><th scope="col">The trick</th><th scope="col">What stops it</th></tr></thead>
          <tbody>
            {CATCHES.map(([trick, stop]) => (
              <tr key={trick}><th scope="row">{trick}</th><td>{stop}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section id="proof" className="proof-home" aria-labelledby="h-proof">
        <h2 id="h-proof">Proof you can check</h2>
        <ul>
          <li>Both registries are deployed on Base Sepolia, with their source code published on BaseScan
            {info?.deployments.PROTECTED.chain && info.deployments.UNPROTECTED.chain && (
              <>: <a href={addressUrl(info.deployments.UNPROTECTED.chain.registry)} target="_blank" rel="noreferrer">open market</a> and{" "}
                <a href={addressUrl(info.deployments.PROTECTED.chain.registry)} target="_blank" rel="noreferrer">protected market</a></>
            )}.
          </li>
          <li>Every move in the Arena links to its transaction. Blocked attacks were sent too, so they appear as failed transactions: the contract itself refused them.</li>
          <li>Each run's full action log is hashed and stored on-chain, so a published result can be checked against what happened.</li>
          <li>The verifier is tested on 12 synthetic projects with planted frauds, and the code ships with its tests. <a href={REPO_URL} target="_blank" rel="noreferrer">Read the source on GitHub ↗</a></li>
        </ul>
      </section>

      <section className="audience" aria-labelledby="h-audience">
        <h2 id="h-audience">Who it's for</h2>
        <dl>
          {AUDIENCE.map(([who, why]) => (
            <div key={who}><dt>{who}</dt><dd>{why}</dd></div>
          ))}
        </dl>
      </section>

      <section className="closing">
        <h2>Watch six rounds in about a minute and a half.</h2>
        <a className="button primary" href="/arena" onClick={open}>Run the gauntlet</a>
      </section>
    </div>
  );
}
