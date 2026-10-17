import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import type { ArenaEvent, Mode } from "./types.js";
import { createRun, getRun, playRound, computeMetrics, ledger, arenaSeed, MAX_ROUNDS } from "./engine/run.js";
import { ROLES } from "./agents/roles.js";
import { loadRecording } from "./agents/recordings.js";

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));
app.use(express.json());

// Render health check + keep-awake ping target
app.get("/health", (_req, res) => res.json({ ok: true, demoMode: process.env.DEMO_MODE === "true" }));

// Everything the Arena needs before a run: the actors, the projects, and where the proof lives.
app.get("/arena", (_req, res) => {
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
  });
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

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const emit = (e: ArenaEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  try {
    await playRound(run, emit);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: "error", message: (err as Error).message })}\n\n`);
  }
  res.end();
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Carbon Gauntlet API on :${port}`));
