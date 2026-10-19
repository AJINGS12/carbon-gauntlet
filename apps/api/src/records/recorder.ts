import { createHash, randomBytes } from "node:crypto";
import type { ArenaEvent, LedgerRow, Metrics, Mode } from "../types.js";
import type { TxResult } from "../chain/adapter.js";
import { createStore, type RecordMeta, type RecordStore } from "./store.js";

/**
 * Keeps a permanent record of every live run.
 *
 * While a live run plays, every streamed event is collected for both markets. When both markets
 * finish, the record is saved (Supabase, or memory locally), and its fingerprint (sha256 of the
 * stored text) is anchored on Base Sepolia, so anyone can check later that it was never edited.
 * Saving comes first: if anchoring fails, the record still exists, just without the on-chain proof.
 */

const MODES: Mode[] = ["UNPROTECTED", "PROTECTED"];
type Start = Record<Mode, { metrics: Metrics; ledger: LedgerRow[] }>;

export interface RecordBody { id: string; createdAt: string; model: string; start: Start; events: Record<Mode, ArenaEvent[]> }

interface Pair {
  body: RecordBody;
  runIds: Record<Mode, string>;
  rounds: Record<Mode, number>;
  maxRounds: number;
  status: "playing" | "saving" | "saved" | "failed";
  anchor: "off" | "pending" | "done" | "failed";
  meta?: RecordMeta;
  text?: string;
}

export type Anchorer = (recordId: string, digest: string) => Promise<TxResult & { registry: string }>;

let store: RecordStore | undefined;
const getStore = () => (store ??= createStore());
let anchorer: Anchorer | null | undefined;

/** ANCHOR_RUNS=true anchors each saved record on the protected registry (needs OPERATOR_PRIVATE_KEY). */
async function getAnchorer(): Promise<Anchorer | null> {
  if (anchorer !== undefined) return anchorer;
  const registry = process.env.REGISTRY_PROTECTED_ADDRESS;
  if (process.env.ANCHOR_RUNS !== "true" || !registry || !process.env.OPERATOR_PRIVATE_KEY) return (anchorer = null);
  const { createViemAdapter } = await import("../chain/viem-adapter.js");
  const chain = createViemAdapter(true, { local: process.env.ANCHOR_NETWORK === "local" });
  return (anchorer = async (id, digest) => ({ ...(await chain.anchorRun(id, digest)), registry }));
}

/** Tests swap in a memory store and a fake anchorer. */
export function setRecordingForTesting(s: RecordStore, a: Anchorer | null) { store = s; anchorer = a; pairs.clear(); byRun.clear(); }

const pairs = new Map<string, Pair>();
const byRun = new Map<string, Pair>();

/** Short, readable on the block explorer (the contract stores IDs up to 31 characters as text). */
const newId = () => "live-" + BigInt("0x" + randomBytes(8).toString("hex")).toString(36).slice(0, 10);

export function startRecord(runIds: Record<Mode, string>, start: Start, model: string, maxRounds: number): string {
  const id = newId();
  const pair: Pair = {
    body: { id, createdAt: new Date().toISOString(), model, start, events: { UNPROTECTED: [], PROTECTED: [] } },
    runIds, rounds: { UNPROTECTED: 0, PROTECTED: 0 }, maxRounds, status: "playing", anchor: "off",
  };
  pairs.set(id, pair);
  for (const mode of MODES) byRun.set(runIds[mode], pair);
  return id;
}

const modeOf = (pair: Pair, runId: string) => MODES.find((m) => pair.runIds[m] === runId)!;

/** Collects one streamed event. Verifier tool outputs are left out: the page never shows them and they are bulky. */
export function recordEvent(runId: string, e: ArenaEvent) {
  const pair = byRun.get(runId);
  if (!pair || pair.status !== "playing") return;
  const mode = modeOf(pair, runId);
  pair.body.events[mode].push(e.type === "verifier_step" ? { ...e, result: undefined } : e);
  if (e.type === "round_finished") {
    pair.rounds[mode] = e.round;
    if (MODES.every((m) => pair.rounds[m] >= pair.maxRounds)) void finish(pair);
  }
}

export const digestOf = (text: string) => "0x" + createHash("sha256").update(text).digest("hex");

async function finish(pair: Pair) {
  pair.status = "saving";
  const text = JSON.stringify(pair.body);
  const last = (mode: Mode) => [...pair.body.events[mode]].reverse().find((e) => e.type === "round_finished");
  const metrics = Object.fromEntries(MODES.map((m) => {
    const e = last(m);
    return [m, e?.type === "round_finished" ? e.metrics : pair.body.start[m].metrics];
  })) as Record<Mode, Metrics>;
  const meta: RecordMeta = { id: pair.body.id, createdAt: pair.body.createdAt, model: pair.body.model, metrics, digest: digestOf(text) };
  pair.text = text;
  pair.meta = meta;
  try {
    await getStore().save({ ...meta, body: text });
    pair.status = "saved";
  } catch (err) {
    console.warn(`[records] couldn't save ${meta.id}: ${(err as Error).message}`);
    pair.status = "failed";
    return;
  }
  const anchor = await getAnchorer().catch(() => null);
  if (!anchor) return;
  pair.anchor = "pending";
  try {
    const tx = await anchor(meta.id, meta.digest);
    if (!tx.accepted || !tx.txHash) throw new Error(tx.reason ?? "not accepted");
    meta.anchorTx = tx.txHash;
    meta.registry = tx.registry;
    pair.anchor = "done";
    await getStore().setAnchor(meta.id, tx.txHash, tx.registry);
  } catch (err) {
    console.warn(`[records] couldn't anchor ${meta.id}: ${(err as Error).message}`);
    if (pair.anchor === "pending") pair.anchor = "failed";
  }
}

export type RecordView =
  | ({ status: "playing"; runIds: Record<Mode, string>; round: number; body: RecordBody })
  | ({ status: "saving" | "saved" | "failed"; anchor: Pair["anchor"] } & Partial<RecordMeta> & { id: string });

/** A record by id: still playing (with everything so far, so a refreshed page can catch up), or finished. */
export async function getRecord(id: string): Promise<RecordView | null> {
  const pair = pairs.get(id);
  if (pair?.status === "playing") return { status: "playing", runIds: pair.runIds, round: Math.min(pair.rounds.UNPROTECTED, pair.rounds.PROTECTED), body: pair.body };
  if (pair) return { id, status: pair.status, anchor: pair.anchor, ...pair.meta };
  const stored = await getStore().get(id);
  if (!stored) return null;
  const { body: _body, ...meta } = stored;
  return { ...meta, status: "saved", anchor: meta.anchorTx ? "done" : "off" };
}

/** The exact stored text: what the fingerprint was computed from. */
export async function getRecordText(id: string): Promise<string | null> {
  const pair = pairs.get(id);
  if (pair?.text) return pair.text;
  return (await getStore().get(id))?.body ?? null;
}

export const listRecords = (limit: number) => getStore().list(limit);
export const recordsPersistent = () => getStore().persistent;
