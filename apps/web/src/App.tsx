import { useState } from "react";

// Minimal Arena (Phase 1 skeleton). Next: agent cards with plans, project map (Leaflet),
// ledger screen, results / public-proof screen (spec section 10).

const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
type Mode = "UNPROTECTED" | "PROTECTED";
type Metrics = Record<string, number | null>;
interface FeedItem { id: number; round: number; text: string; kind: "ok" | "breach" | "blocked" | "agent" | "verifier" | "replan" }

const METRIC_LABELS: Record<string, string> = {
  fraudulentClaimsAccepted: "Fraudulent claims accepted",
  attacksBlocked: "Attacks blocked",
  creditsAtRisk: "Credits at risk (tCO2e)",
  doubleClaimedCredits: "Double-claimed (tCO2e)",
  integrityScore: "Integrity score",
  honestClaimsBlocked: "Honest claims blocked",
};

export default function App() {
  const [mode, setMode] = useState<Mode>("UNPROTECTED");
  const [runId, setRunId] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [maxRounds, setMaxRounds] = useState(6);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [busy, setBusy] = useState(false);

  const push = (round: number, text: string, kind: FeedItem["kind"]) =>
    setFeed((f) => [{ id: Date.now() + Math.random(), round, text, kind }, ...f]);

  async function start() {
    const res = await fetch(`${API}/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
    const data = await res.json();
    setRunId(data.runId); setMaxRounds(data.maxRounds); setRound(0); setFeed([]); setMetrics(null);
  }

  async function nextRound() {
    if (!runId) return;
    setBusy(true);
    const res = await fetch(`${API}/runs/${runId}/rounds`, { method: "POST" });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "", current = round + 1;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const e = JSON.parse(part.replace(/^data: /, ""));
        if (e.type === "round_started") current = e.round;
        if (e.type === "agent_decision") {
          const d = e.decision;
          const by = d.source === "llm" ? "AI" : d.source === "replay" ? "AI (recorded)" : "scripted";
          if (d.replanned) push(current, `${d.agentId} replans after a rejection. Was: ${(d.previousPlan ?? []).join(" → ") || "-"}. Now: ${d.plan.join(" → ")}`, "replan");
          if (d.step.action !== "WAIT") push(current, `${d.agentId} [${by}]: ${d.reason}`, "agent");
        }
        if (e.type === "agent_fallback") push(current, `${e.agentId}: ${e.reason}`, "agent");
        if (e.type === "verifier_step") {
          const by = e.source === "llm" ? "AI" : e.source === "replay" ? "AI (recorded)" : "rules";
          push(current, `Verifier [${by}] ${e.step ? `step ${e.step}: ` : ""}${e.tool} — ${e.reason}`, "verifier");
        }
        if (e.type === "attestation") {
          const a = e.attestation;
          push(current, `Verifier attests ${a.projectId}: ${a.status}${a.guardrailOverride ? " (guardrail override)" : ""}. ${a.explanation}`, "verifier");
        }
        if (e.type === "action_result" && e.action !== "WAIT")
          push(current, `${e.agentId} ${e.action}: ${e.accepted ? "ACCEPTED" : `BLOCKED (${e.reason})`}${e.attack ? " · attack" : ""}`, e.accepted ? (e.attack ? "breach" : "ok") : "blocked");
        if (e.type === "round_finished") { setRound(e.round); setMetrics(e.metrics); }
      }
    }
    setBusy(false);
  }

  return (
    <main>
      <header>
        <h1>Carbon Gauntlet</h1>
        <p className="tag">Only honest credits make it through.</p>
        <p className="label">Experimental prototype · synthetic data · not a real carbon registry</p>
      </header>

      <section className="controls">
        <div role="radiogroup" aria-label="Market mode">
          {(["UNPROTECTED", "PROTECTED"] as Mode[]).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)} disabled={busy}>
              {m === "UNPROTECTED" ? "Unprotected market" : "Protocol on"}
            </button>
          ))}
        </div>
        <button onClick={start} disabled={busy}>New run</button>
        <button onClick={nextRound} disabled={!runId || busy || round >= maxRounds}>
          {busy ? "Running…" : `Play round ${round + 1} of ${maxRounds}`}
        </button>
      </section>

      {metrics && (
        <section className="metrics">
          {Object.entries(METRIC_LABELS).map(([k, label]) => (
            <div key={k} className="tile"><span>{label}</span><strong>{metrics[k] ?? "—"}</strong></div>
          ))}
        </section>
      )}

      <section className="feed" aria-live="polite">
        {feed.map((f) => (
          <div key={f.id} className={`item ${f.kind}`}>
            <span className="round">R{f.round}</span>
            <span className="badge">{f.kind === "blocked" ? "✕ blocked" : f.kind === "ok" ? "✓ accepted" : f.kind === "breach" ? "! fraud through" : f.kind === "replan" ? "↻ replan" : f.kind}</span>
            {f.text}
          </div>
        ))}
      </section>
    </main>
  );
}
