import type { Metrics, Mode } from "../types.js";

/**
 * Where finished live runs are kept. Supabase (Postgres over its REST API) when SUPABASE_URL and
 * SUPABASE_SECRET_KEY are set; otherwise in memory, which is fine locally but forgets on restart.
 *
 * The full record is stored as text, byte for byte, so anyone can download it, hash it and compare the
 * hash with the one anchored on-chain. (A JSON column would reorder keys and break that check.)
 */
export interface RecordMeta {
  id: string;
  createdAt: string;
  model: string;
  metrics: Record<Mode, Metrics>;
  digest: string;          // 0x + sha256 of the stored body
  anchorTx?: string;       // Base Sepolia transaction that anchored the digest
  registry?: string;       // contract holding the anchor
}
export interface StoredRecord extends RecordMeta { body: string }

export interface RecordStore {
  readonly persistent: boolean;
  save(r: StoredRecord): Promise<void>;
  setAnchor(id: string, anchorTx: string, registry: string): Promise<void>;
  get(id: string): Promise<StoredRecord | null>;
  list(limit: number): Promise<RecordMeta[]>;
}

export class MemoryStore implements RecordStore {
  readonly persistent = false;
  private rows = new Map<string, StoredRecord>();
  async save(r: StoredRecord) { this.rows.set(r.id, { ...r }); }
  async setAnchor(id: string, anchorTx: string, registry: string) {
    const r = this.rows.get(id);
    if (r) Object.assign(r, { anchorTx, registry });
  }
  async get(id: string) { return this.rows.get(id) ?? null; }
  async list(limit: number) {
    return [...this.rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(({ body: _body, ...meta }) => meta);
  }
}

interface Row { id: string; created_at: string; model: string; metrics: Record<Mode, Metrics>; digest: string; anchor_tx: string | null; registry: string | null; body?: string }
const fromRow = (r: Row): StoredRecord => ({
  id: r.id, createdAt: r.created_at, model: r.model, metrics: r.metrics, digest: r.digest,
  anchorTx: r.anchor_tx ?? undefined, registry: r.registry ?? undefined, body: r.body ?? "",
});

/** Talks to Supabase's REST API with plain fetch: no SDK needed for three queries. */
export class SupabaseStore implements RecordStore {
  readonly persistent = true;
  constructor(private readonly url: string, private readonly key: string, private readonly fetcher: typeof fetch = fetch) {}

  private headers(extra: Record<string, string> = {}) {
    // New keys (sb_secret_...) go in the apikey header only; legacy service_role JWTs also need Authorization.
    const auth: Record<string, string> = this.key.startsWith("sb_") ? {} : { Authorization: `Bearer ${this.key}` };
    return { apikey: this.key, ...auth, "Content-Type": "application/json", ...extra };
  }
  private async call(path: string, init: RequestInit = {}) {
    const res = await this.fetcher(`${this.url.replace(/\/$/, "")}/rest/v1/${path}`, { ...init, headers: this.headers(init.headers as Record<string, string>) });
    if (!res.ok) throw new Error(`Supabase answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }

  async save(r: StoredRecord) {
    await this.call("runs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ id: r.id, created_at: r.createdAt, model: r.model, metrics: r.metrics, digest: r.digest, anchor_tx: r.anchorTx ?? null, registry: r.registry ?? null, body: r.body }),
    });
  }
  async setAnchor(id: string, anchorTx: string, registry: string) {
    await this.call(`runs?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ anchor_tx: anchorTx, registry }) });
  }
  async get(id: string) {
    const rows = (await (await this.call(`runs?id=eq.${encodeURIComponent(id)}&select=*`)).json()) as Row[];
    return rows[0] ? fromRow(rows[0]) : null;
  }
  async list(limit: number) {
    const rows = (await (await this.call(`runs?select=id,created_at,model,metrics,digest,anchor_tx,registry&order=created_at.desc&limit=${limit}`)).json()) as Row[];
    return rows.map((r) => { const { body: _body, ...meta } = fromRow(r); return meta; });
  }
}

export function createStore(): RecordStore {
  const url = process.env.SUPABASE_URL?.trim(), key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (url && key) return new SupabaseStore(url, key);
  return new MemoryStore();
}
