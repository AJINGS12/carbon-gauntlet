import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import type { ArenaEvent, Mode } from "./types.js";
import { timingSafeEqual } from "node:crypto";
import { createRun, getRun, playRound, computeMetrics, ledger, arenaSeed, tryTrick, canRunLive, TRICK_IDS, MAX_ROUNDS } from "./engine/run.js";
import { ROLES } from "./agents/roles.js";
import { loadRecording } from "./agents/recordings.js";
import { AGENT_MODEL, VERIFIER_MODEL } from "./llm/client.js";
import { startRecord, recordEvent, getRecord, getRecordText, listRecords, recordsPersistent } from "./records/recorder.js";

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));
app.use(express.json({ limit: "8kb" }));
app.set("trust proxy", 1); // Render sits behind a proxy; needed for per-visitor rate limits

/** Small in-memory rate limiter: enough to stop one visitor hammering the free sandbox. */
function rateLimit(perMinute: number) {
  const hits = new Map<string, number[]>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now(), key = req.ip ?? "anon";
    const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= perMinute) return res.status(429).json({ error: "Too many attempts. Wait a minute and try again." });
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    next();
  };
}

// Render health check + keep-awake ping target
app.get("/health", (_req, res) => res.json({ ok: true, demoMode: process.env.DEMO_MODE === "true" }));

/**
 * The recorded run's final result, for the home page. Computed once by replaying the recording
 * on the in-memory ledger (demo mode only, so it never calls the model or sends transactions).
 */
let preview: Promise<Record<Mode, { metrics: ReturnType<typeof computeMetrics>; ledger: ReturnType<typeof ledger> }> | null> | undefined;
function recordedResult() {
  if (process.env.DEMO_MODE !== "true" || (process.env.CHAIN_MODE ?? "mock") !== "mock") return Promise.resolve(null);
  preview ??= (async () => {
    const out = {} as Record<Mode, { metrics: ReturnType<typeof computeMetrics>; ledger: ReturnType<typeof ledger> }>;
    for (const mode of ["UNPROTECTED", "PROTECTED"] as const) {
      const run = await createRun(mode);
      for (let i = 0; i < MAX_ROUNDS; i++) await playRound(run, () => {});
      out[mode] = { metrics: computeMetrics(run), ledger: ledger(run) };
    }
    return out;
  })().catch(() => null);
  return preview;
}

/**
 * Live runs: Claude decides every move now, instead of replaying the recording. They cost API credit,
 * so they need an access code (LIVE_RUN_CODE) and are capped per day (LIVE_RUNS_PER_DAY, default 10).
 * Without a model key or a code, live runs are simply unavailable and the site stays replay-only.
 */
const liveCode = () => process.env.LIVE_RUN_CODE ?? "";
const livePerDay = () => Number(process.env.LIVE_RUNS_PER_DAY ?? 10);
let liveDay = "", liveUsed = 0;
function liveRemaining() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== liveDay) { liveDay = today; liveUsed = 0; }
  return Math.max(0, livePerDay() - liveUsed);
}
const liveAvailable = () => liveCode().length >= 6 && canRunLive();
function codeMatches(given: string) {
  const a = Buffer.from(given), b = Buffer.from(liveCode());
  return a.length === b.length && timingSafeEqual(a, b);
}

// Start a live run: one open and one protected market, played by Claude. Counts as one of today's runs.
app.post("/live", rateLimit(5), async (req, res) => {
  if (!liveAvailable()) return res.status(503).json({ error: "Live runs aren't switched on for this site." });
  const body = z.object({ code: z.string().max(100) }).safeParse(req.body);
  if (!body.success || !codeMatches(body.data.code)) return res.status(403).json({ error: "That access code isn't right." });
  if (liveRemaining() === 0) return res.status(429).json({ error: "Today's live runs are used up. The recorded run is still available." });
  liveUsed += 1;
  const [u, p] = await Promise.all([createRun("UNPROTECTED", { live: true }), createRun("PROTECTED", { live: true })]);
  const start = {
    UNPROTECTED: { metrics: computeMetrics(u), ledger: ledger(u) },
    PROTECTED: { metrics: computeMetrics(p), ledger: ledger(p) },
  };
  // Every live run is recorded from its first move, so it can be saved and anchored when it ends.
  const recordId = startRecord({ UNPROTECTED: u.id, PROTECTED: p.id }, start, `agents ${AGENT_MODEL}, verifier ${VERIFIER_MODEL}`, MAX_ROUNDS);
  res.status(201).json({
    maxRounds: MAX_ROUNDS,
    recordId,
    UNPROTECTED: { runId: u.id, ...start.UNPROTECTED },
    PROTECTED: { runId: p.id, ...start.PROTECTED },
    remainingToday: liveRemaining(),
  });
});

// Everything the Arena needs before a run: the actors, the projects, and where the proof lives.
app.get("/arena", async (_req, res) => {
  const chainMode = process.env.CHAIN_MODE ?? "mock";
  const deployment = (mode: Mode) => {
    const rec = process.env.DEMO_MODE === "true" ? loadRecording(mode) : null;
    const liveRegistry = process.env[mode === "PROTECTED" ? "REGISTRY_PROTECTED_ADDRESS" : "REGISTRY_UNPROTECTED_ADDRESS"];
    return {
      recording: rec ? { model: rec.model, recordedAt: rec.recordedAt } : null,
      // Live testnet runs use the configured registry; demo replays link to the run recorded on-chain.
      chain: chainMode === "testnet" && liveRegistry ? { network: "baseSepolia", registry: liveRegistry, anchorTx: undefined }
        : rec?.chain ? { network: rec.chain.network === "testnet" ? "baseSepolia" : rec.chain.network, registry: rec.chain.registry, anchorTx: rec.chain.anchorTx } : null,
    };
  };
  res.json({
    maxRounds: MAX_ROUNDS,
    demoMode: process.env.DEMO_MODE === "true",
    chainMode,
    roles: ROLES.map(({ id, name, honest, country, goal, portfolio }) => ({ id, name, honest, country, goal, portfolio })),
    ...arenaSeed(),
    deployments: { UNPROTECTED: deployment("UNPROTECTED"), PROTECTED: deployment("PROTECTED") },
    result: await recordedResult(),
    live: { available: liveAvailable(), remainingToday: liveAvailable() ? liveRemaining() : 0 },
    records: { persistent: recordsPersistent(), anchored: process.env.ANCHOR_RUNS === "true" },
  });
});

// Saved live runs: a list, one record (or, while it is still playing, everything so far), and the exact stored text.
app.get("/records", async (_req, res) => {
  try {
    res.json({ records: await listRecords(20) });
  } catch (err) {
    console.warn(`[records] list failed: ${(err as Error).message}`);
    res.status(502).json({ error: "Couldn't load past runs right now." });
  }
});
app.get("/records/:id", async (req, res) => {
  try {
    const view = await getRecord(req.params.id);
    if (!view) return res.status(404).json({ error: "No saved run with that link." });
    if (view.status === "playing") return res.json({ ...view, busy: Object.values(view.runIds).some((id) => getRun(id)?.busy) });
    res.json(view);
  } catch (err) {
    console.warn(`[records] get failed: ${(err as Error).message}`);
    res.status(502).json({ error: "Couldn't load that run right now." });
  }
});
app.get("/records/:id/body", async (req, res) => {
  try {
    const text = await getRecordText(req.params.id);
    if (!text) return res.status(404).json({ error: "No saved run with that link." });
    res.type("application/json").send(text);
  } catch (err) {
    console.warn(`[records] body failed: ${(err as Error).message}`);
    res.status(502).json({ error: "Couldn't load that run right now." });
  }
});

// "Try to cheat it yourself": one trick, run in a fresh open and protected market. Rule checks only, so it's free.
const TrickSchema = z.object({
  trick: z.enum(TRICK_IDS),
  copyFrom: z.string().max(40).optional(),
  shiftKm: z.number().min(0).max(20).optional(),
  note: z.string().max(240).optional(),
});
app.post("/sandbox", rateLimit(30), async (req, res) => {
  const body = TrickSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Pick one of the tricks." });
  const [UNPROTECTED, PROTECTED] = await Promise.all([tryTrick("UNPROTECTED", body.data), tryTrick("PROTECTED", body.data)]);
  res.json({ UNPROTECTED, PROTECTED });
});

// Start a run in one mode
app.post("/runs", async (req, res) => {
  const body = z.object({ mode: z.enum(["UNPROTECTED", "PROTECTED"]) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "mode must be UNPROTECTED or PROTECTED" });
  const run = await createRun(body.data.mode);
  res.status(201).json({ runId: run.id, mode: run.mode, maxRounds: MAX_ROUNDS, metrics: computeMetrics(run), ledger: ledger(run) });
});

app.get("/runs/:id", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found" });
  res.json({ runId: run.id, mode: run.mode, round: run.round, maxRounds: MAX_ROUNDS, metrics: computeMetrics(run), log: run.log, anchorTx: run.anchorTx });
});

// Play the next round, streaming every agent decision, verifier step and tx result (Server-Sent Events)
app.post("/runs/:id/rounds", async (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found" });
  if (run.round >= MAX_ROUNDS) return res.status(409).json({ error: "Run already finished" });
  if (run.busy) return res.status(409).json({ error: "This round is still being played. Try again in a moment." });
  run.busy = true;

  // X-Accel-Buffering stops proxies holding events back; the comment line keeps the stream open while Claude thinks.
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const ping = setInterval(() => res.write(": still thinking\n\n"), 15_000);
  const emit = (e: ArenaEvent) => {
    if (run.live) recordEvent(run.id, e);
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  try {
    await playRound(run, emit);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: "error", message: (err as Error).message })}\n\n`);
  } finally {
    clearInterval(ping);
    run.busy = false;
  }
  res.end();
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Carbon Gauntlet API on :${port}`));
