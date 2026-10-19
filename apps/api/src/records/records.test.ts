import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRun, playRound, computeMetrics, ledger, MAX_ROUNDS } from "../engine/run.js";
import type { Mode } from "../types.js";
import { MemoryStore, SupabaseStore } from "./store.js";
import { digestOf, getRecord, getRecordText, listRecords, recordEvent, setRecordingForTesting, startRecord, type Anchorer, type RecordView } from "./recorder.js";

const MODES: Mode[] = ["UNPROTECTED", "PROTECTED"];
const done = async (id: string) => (await getRecord(id)) as Exclude<RecordView, { status: "playing" }> | null;
const until = async (ok: () => Promise<boolean>) => { for (let i = 0; i < 100 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 10)); };

async function livePair() {
  const runs = { UNPROTECTED: await createRun("UNPROTECTED"), PROTECTED: await createRun("PROTECTED") };
  const start = Object.fromEntries(MODES.map((m) => [m, { metrics: computeMetrics(runs[m]), ledger: ledger(runs[m]) }])) as never;
  const id = startRecord({ UNPROTECTED: runs.UNPROTECTED.id, PROTECTED: runs.PROTECTED.id }, start, "agents test, verifier test", MAX_ROUNDS);
  const play = (mode: Mode) => playRound(runs[mode], (e) => recordEvent(runs[mode].id, e));
  return { id, runs, play };
}

describe("records of live runs", () => {
  let store: MemoryStore;
  let anchored: { id: string; digest: string }[];
  const anchorer: Anchorer = async (id, digest) => { anchored.push({ id, digest }); return { accepted: true, txHash: "0x" + "ab".repeat(32), registry: "0xregistry" }; };
  beforeEach(() => { store = new MemoryStore(); anchored = []; setRecordingForTesting(store, anchorer); });

  it("shows a run in progress with everything so far, so a refreshed page can catch up", async () => {
    const { id, play } = await livePair();
    await play("UNPROTECTED");
    await play("PROTECTED");
    const view = await getRecord(id);
    expect(view?.status).toBe("playing");
    if (view?.status !== "playing") return;
    expect(view.round).toBe(1);
    expect(view.body.events.PROTECTED.at(-1)?.type).toBe("round_finished");
    expect(id).toMatch(/^live-[0-9a-z]{1,10}$/);
    expect(id.length).toBeLessThanOrEqual(31); // fits the contract's readable ID
  });

  it("saves the finished run, anchors its fingerprint, and the fingerprint matches the stored text", async () => {
    const { id, play } = await livePair();
    for (let i = 0; i < MAX_ROUNDS; i++) { await play("UNPROTECTED"); await play("PROTECTED"); }
    await until(async () => (await done(id))?.anchorTx !== undefined);

    const view = await done(id);
    expect(view).toMatchObject({ status: "saved", anchor: "done", anchorTx: "0x" + "ab".repeat(32), registry: "0xregistry" });
    const text = (await getRecordText(id))!;
    expect(view?.digest).toBe(digestOf(text));
    expect(anchored).toEqual([{ id, digest: digestOf(text) }]);
    const body = JSON.parse(text);
    expect(body.events.PROTECTED.filter((e: { type: string }) => e.type === "round_finished")).toHaveLength(MAX_ROUNDS);
    expect(body.events.PROTECTED.some((e: { type: string; result?: unknown }) => e.type === "verifier_step" && e.result !== undefined)).toBe(false);
    expect(view?.metrics?.PROTECTED.integrityScore).toBe(100);

    // Survives the server forgetting it: read back from the store alone.
    setRecordingForTesting(store, null);
    expect(await getRecord(id)).toMatchObject({ status: "saved", anchorTx: "0x" + "ab".repeat(32) });
    expect(await getRecordText(id)).toBe(text);
    expect((await listRecords(10)).map((r) => r.id)).toEqual([id]);
  });

  it("keeps the record when anchoring fails", async () => {
    setRecordingForTesting(store, async () => { throw new Error("rpc down"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { id, play } = await livePair();
    for (let i = 0; i < MAX_ROUNDS; i++) { await play("UNPROTECTED"); await play("PROTECTED"); }
    await until(async () => (await getRecord(id))?.status === "saved" && (await getRecord(id) as { anchor?: string }).anchor === "failed");
    expect(await getRecord(id)).toMatchObject({ status: "saved", anchor: "failed" });
    expect(await store.get(id)).not.toBeNull();
    warn.mockRestore();
  });

  it("ignores events from runs that aren't live", async () => {
    const run = await createRun("PROTECTED");
    await playRound(run, (e) => recordEvent(run.id, e));
    expect(await listRecords(10)).toEqual([]);
  });
});

describe("Supabase store", () => {
  it("sends new secret keys in the apikey header only, and reads rows back", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const row = { id: "live-x", created_at: "2026-10-19T00:00:00Z", model: "m", metrics: {}, digest: "0x1", anchor_tx: null, registry: null, body: "{}" };
      return new Response(init.method ? "" : JSON.stringify([row]), { status: init.method === "POST" ? 201 : 200 });
    }) as typeof fetch;
    const s = new SupabaseStore("https://abc.supabase.co/", "sb_secret_123", fake);
    await s.save({ id: "live-x", createdAt: "2026-10-19T00:00:00Z", model: "m", metrics: {} as never, digest: "0x1", body: "{}" });
    expect(calls[0].url).toBe("https://abc.supabase.co/rest/v1/runs");
    expect(calls[0].init.headers).toMatchObject({ apikey: "sb_secret_123" });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(await s.get("live-x")).toMatchObject({ id: "live-x", body: "{}", anchorTx: undefined });
  });

  it("surfaces Supabase errors instead of pretending it saved", async () => {
    const fake = (async () => new Response("relation runs does not exist", { status: 404 })) as unknown as typeof fetch;
    const s = new SupabaseStore("https://abc.supabase.co", "legacy.jwt.key", fake);
    await expect(s.list(5)).rejects.toThrow(/404/);
  });
});
