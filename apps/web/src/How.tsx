/**
 * "How it works": what Carbon Gauntlet is, how a claim moves through it, who would use it,
 * why they would, and what it would take to run it for real. Plain English, with sources.
 */

const SRC = {
  science: { label: "West et al., Science (2023), via University of Bonn", url: "https://www.uni-bonn.de/en/news/148-2023" },
  rebuttal: { label: "Ecosystem Marketplace: scientists' rebuttal to West et al.", url: "https://www.ecosystemmarketplace.com/articles/press-release-top-scientist-sissue-rebuttal-to-west-et-al-paper/" },
  wcc: { label: "UK Woodland Carbon Code: validation costs (2025)", url: "https://www.woodlandcarboncode.org.uk/3-validation" },
  vcmi: { label: "VCMI: Strengthening VVB Capacities (Feb 2026)", url: "https://vcmintegrity.org/wp-content/uploads/2026/02/Strengthening-VVB-Capacities-Report_February-2026-v4.pdf" },
  sylvera: { label: "Sylvera: how quality affects carbon credit prices (2025)", url: "https://www.sylvera.com/blog/increase-carbon-project-quality-price" },
  ccp: { label: "Verra: first ICVCM Core Carbon Principles labels on the registry", url: "https://verra.org/first-icvcm-ccp-labels-now-active-on-the-verra-registry/" },
  article6: { label: "Corresponding adjustments under Article 6 of the Paris Agreement", url: "https://offset8capital.com/articles/corresponding-adjustment-guide/" },
};
type Source = keyof typeof SRC;
const ORDER: Source[] = ["science", "rebuttal", "wcc", "vcmi", "sylvera", "ccp", "article6"];
const Ref = ({ s }: { s: Source }) => <sup className="ref"><a href={`#src-${s}`} aria-label={`Source ${ORDER.indexOf(s) + 1}`}>{ORDER.indexOf(s) + 1}</a></sup>;

const FRAUD = [
  ["The same land, sold twice", "Two projects claim the same forest for the same years."],
  ["Copied reports", "One project's audit is reused for a plot nearby."],
  ["Inflated tonnes", "A project claims more CO₂ than its method could ever save."],
  ["Used credits sold again", "A credit already retired for one buyer is sold to another."],
  ["Counted by two countries", "The seller's country and the buyer's country both count the same tonne."],
];

const JOURNEY = [
  ["Register", "A developer registers its land and evidence. The registry contract refuses land that's already claimed for the same years."],
  ["Verify", "An AI verifier checks the claim like an auditor would: is the report really this project's, does the land overlap another project, is the evidence copied, are the tonnes realistic? Fixed rules can only make it stricter. Unclear cases go to a person."],
  ["Issue", "Credits are created only after approval, and never more than were approved."],
  ["Trade and retire", "A used credit can't be sold again. A sale to another country needs that country's adjustment first, so one tonne is never counted twice."],
];

const USERS = [
  ["Registries and auditors", "Screen every new project before a person reviews it. Approve the clear cases quickly, and send the suspicious ones to an auditor with the reasons attached."],
  ["Governments trading credits", "Under Article 6 of the Paris Agreement, countries must adjust their own count when they sell credits abroad. The contract won't move a credit across a border until that's recorded."],
  ["Market designers and policymakers", "Before launching a market or a new rule, let AI attackers try to break it, the way banks stress-test. Find the loopholes before real money does."],
];

const LIMITS = [
  ["Real data", "Project documents from public registries, satellite forest maps, and the list of accredited auditors. Today the projects are synthetic."],
  ["People decide", "The AI recommends; a person signs off on rejections and edge cases."],
  ["Shared control", "In production the registry, or several registries together, run the contract, not one company."],
  ["A pilot", "Screen past projects from a public registry and compare the results with known problem cases."],
];

export default function How({ go }: { go: (path: string) => void }) {
  const link = (to: string) => (e: React.MouseEvent) => { e.preventDefault(); go(to); };

  return (
    <div className="home how-page">
      <header className="how-hero">
        <p className="eyebrow">How it works</p>
        <h1>Check every claim before the credit exists.</h1>
        <p className="lede">
          A carbon credit is meant to stand for one tonne of CO₂ that was really kept out of the air. Carbon Gauntlet checks each claim before credits are created, and keeps a public record that can't be quietly changed.
        </p>
      </header>

      <section className="how-block" aria-labelledby="h-problem">
        <h2 id="h-problem">The problem</h2>
        <div className="problem-grid">
          <div className="stat-card">
            <strong>~6%</strong>
            <p>of credits from 18 forest-protection projects matched real cuts in emissions, a 2023 study in <em>Science</em> found.<Ref s="science" /> Some project developers dispute its methods.<Ref s="rebuttal" /></p>
          </div>
          <div>
            <p className="how-text">When a credit isn't real, a company claims a cut that never happened, and the climate pays. These are the usual tricks:</p>
            <ul className="fraud-list">
              {FRAUD.map(([t, d]) => <li key={t}><strong>{t}.</strong> {d}</li>)}
            </ul>
            <p className="how-text">Checking by hand is slow: developers in Africa report that validation and verification take about 4.5 to 5 months on average, and qualified auditors are in short supply.<Ref s="vcmi" /></p>
          </div>
        </div>
      </section>

      <section className="how-block" aria-labelledby="h-journey">
        <h2 id="h-journey">How a claim moves through it</h2>
        <ol className="steps journey">
          {JOURNEY.map(([t, d]) => <li key={t}><h3>{t}</h3><p>{d}</p></li>)}
        </ol>
        <p className="how-text tested">
          <strong>Tested by attackers.</strong> Four Claude agents, one honest and three cheaters, play the same market twice: once with no checks, once with Carbon Gauntlet.{" "}
          <a href="/arena" onClick={link("/arena")}>Watch them in the Arena</a>.
        </p>
      </section>

      <section className="how-block" aria-labelledby="h-who">
        <h2 id="h-who">Who it's for</h2>
        <ul className="user-cards">
          {USERS.map(([t, d]) => <li key={t}><h3>{t}</h3><p>{d}</p></li>)}
        </ul>
      </section>

      <section className="how-block" aria-labelledby="h-why">
        <h2 id="h-why">Why they'd use it</h2>
        <dl className="why-list">
          <div>
            <dt>Cost and speed</dt>
            <dd>A human check takes months and costs thousands per project: validating one small UK woodland project costs £1,800 to £2,500.<Ref s="wcc" /> An automated first check takes seconds and, in our runs, costs well under a dollar, so auditors spend their time on the hard cases.</dd>
          </div>
          <div>
            <dt>Trust pays</dt>
            <dd>Buyers already pay more for credits rated higher quality, for example about $5 more per rating band for reforestation credits.<Ref s="sylvera" /> A public record that can't be edited is how a seller proves quality.</dd>
          </div>
          <div>
            <dt>The rules point this way</dt>
            <dd>High-integrity labels (the Core Carbon Principles) now appear on major registries,<Ref s="ccp" /> and Article 6 of the Paris Agreement requires "corresponding adjustments" so two countries don't count the same tonne.<Ref s="article6" /> Carbon Gauntlet turns both into checks that run automatically.</dd>
          </div>
          <div>
            <dt>Nothing to replace</dt>
            <dd>It works alongside the registries that exist today: it checks claims before they go in, and records the result on a public blockchain.</dd>
          </div>
        </dl>
      </section>

      <section className="how-block" aria-labelledby="h-real">
        <h2 id="h-real">What it would take to run for real</h2>
        <ul className="tiles limits">
          {LIMITS.map(([t, d]) => <li key={t}><span><strong>{t}</strong>{d}</span></li>)}
        </ul>
      </section>

      <section className="how-block sources" aria-labelledby="h-sources">
        <h2 id="h-sources">Sources</h2>
        <ol>
          {ORDER.map((s) => <li key={s} id={`src-${s}`}><a href={SRC[s].url} target="_blank" rel="noreferrer">{SRC[s].label}</a></li>)}
        </ol>
      </section>

      <section className="closing">
        <h2>See it stop the cheaters.</h2>
        <div className="closing-actions">
          <a className="button primary big" href="/arena" onClick={link("/arena")}>Open the Arena</a>
          <a className="button big" href="/try" onClick={link("/try")}>Try to cheat it</a>
        </div>
      </section>
    </div>
  );
}
