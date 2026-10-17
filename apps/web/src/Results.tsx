import type { ArenaInfo, LedgerRow, Mode } from "./api";
import { addressUrl, REPO_URL, txUrl } from "./api";
import type { Market } from "./useArena";
import { MARKET } from "./Market";
import { countryOf, modelText, nameOf, tonnes } from "./text";

export function LedgerTable({ ledger }: { ledger: LedgerRow[] }) {
  return (
    <div className="ledger-wrap">
      <table className="ledger">
        <caption className="sr-only">Credit batches</caption>
        <thead>
          <tr><th scope="col">Batch</th><th scope="col">Project</th><th scope="col">Host country</th><th scope="col">Owner</th><th scope="col" className="num">Tonnes</th><th scope="col">Status</th><th scope="col">Adjustment</th><th scope="col">Integrity</th></tr>
        </thead>
        <tbody>
          {ledger.map((b) => (
            <tr key={b.batchId} className={b.atRisk ? "risk" : ""}>
              <td className="num">{b.batchId}</td>
              <td>{b.projectId}</td>
              <td>{countryOf(b.hostCountry)}</td>
              <td>{nameOf(b.owner)}</td>
              <td className="num">{b.quantity.toLocaleString("en-US")}</td>
              <td>{b.status === "ACTIVE" ? "Active" : b.status === "RETIRED" ? "Retired" : "Frozen"}</td>
              <td>{b.adjusted ? "Recorded" : "None"}</td>
              <td>{b.atRisk ? <span className="stamp small fraud">At risk</span> : "Clean"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function Results({ info, markets }: { info: ArenaInfo; markets: Record<Mode, Market> }) {
  const u = markets.UNPROTECTED.metrics, p = markets.PROTECTED.metrics;
  if (!u || !p) return null;
  const issued = (m: Market) => m.ledger.reduce((t, b) => t + b.quantity, 0);
  const share = Math.round((100 * u.creditsAtRisk) / Math.max(1, issued(markets.UNPROTECTED)));
  const rows: [string, (m: NonNullable<typeof u>) => string][] = [
    ["Integrity score", (m) => `${m.integrityScore} / 100`],
    ["Fraudulent claims accepted", (m) => String(m.fraudulentClaimsAccepted)],
    ["Attacks blocked", (m) => String(m.attacksBlocked)],
    ["Credits at risk", (m) => tonnes(m.creditsAtRisk)],
    ["Credits sold or claimed twice", (m) => tonnes(m.doubleClaimedCredits)],
    ["Honest claims blocked", (m) => String(m.honestClaimsBlocked)],
  ];
  const rec = info.deployments.PROTECTED.recording;

  return (
    <section className="results" aria-labelledby="h-results">
      <h2 id="h-results">Same agents, same attacks, two outcomes.</h2>
      <p className="verdict-line">
        Without checks, {share}% of the credits in the market were fraudulent or counted twice.
        With Carbon Gauntlet, {p.creditsAtRisk === 0 ? "none were" : `${tonnes(p.creditsAtRisk)} were`}
        {p.honestClaimsBlocked === 0 ? ", and every honest project still got through." : `, but ${p.honestClaimsBlocked} honest claim${p.honestClaimsBlocked === 1 ? " was" : "s were"} blocked.`}
      </p>

      <table className="compare">
        <thead><tr><th scope="col"><span className="sr-only">Measure</span></th><th scope="col">{MARKET.UNPROTECTED.title}</th><th scope="col">{MARKET.PROTECTED.title}</th></tr></thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label}><th scope="row">{label}</th><td>{f(u)}</td><td>{f(p)}</td></tr>
          ))}
        </tbody>
      </table>

      <div className="proof">
        <h3>Check it yourself</h3>
        {rec && (
          <p>
            The agents' moves and the verifier's investigations were recorded from a live run on {date(rec.recordedAt)} ({modelText(rec.model)}).
            This page replays that run, so it makes no AI calls.
          </p>
        )}
        <ul>
          {(["UNPROTECTED", "PROTECTED"] as Mode[]).map((mode) => {
            const chain = info.deployments[mode].chain;
            const anchor = chain ? txUrl(markets[mode].anchorTx ?? chain.anchorTx) : undefined;
            return (
              <li key={mode}>
                <strong>{MARKET[mode].title}.</strong>{" "}
                {chain ? (
                  <>
                    Registry contract on Base Sepolia: <a href={addressUrl(chain.registry)} target="_blank" rel="noreferrer">{chain.registry.slice(0, 10)}…{chain.registry.slice(-4)}</a>.
                    {anchor && <> The hash of this run's full action log is stored in <a href={anchor} target="_blank" rel="noreferrer">this transaction</a>.</>}
                  </>
                ) : (
                  <>This run used the in-memory ledger, so there are no transactions to link.</>
                )}
              </li>
            );
          })}
        </ul>
        {info.deployments.PROTECTED.chain && (
          <p>Every move in the feeds above links to its transaction. Blocked attacks were sent too, so they show up as failed transactions: the contract itself refused them.</p>
        )}
        <p><a href={REPO_URL} target="_blank" rel="noreferrer">Source code, tests and the verifier evaluation on GitHub ↗</a></p>
      </div>
    </section>
  );
}
