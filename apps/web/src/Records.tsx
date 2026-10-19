import { useEffect, useState } from "react";
import { fetchRecords, fetchRecordText, readAnchor, recordLink, sha256Hex, txUrl, addressUrl, type RecordMeta, type RecordView } from "./api";
import { MARKET } from "./Market";
import { modelText } from "./text";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const short = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-6)}`;

type Check = { state: "idle" | "checking" | "done" | "error"; digestOk?: boolean; chainOk?: boolean; onChain?: string | null; message?: string };

/**
 * Proof that a live run is permanent and untouched: its link, its fingerprint, and the transaction that
 * anchored the fingerprint on-chain. "Check it yourself" recomputes the fingerprint in the browser from
 * the stored record and reads the anchor straight from Base Sepolia, without trusting our API.
 */
export function RecordProof({ record, persistent }: { record: RecordView | null; persistent: boolean }) {
  const [copied, setCopied] = useState(false);
  const [check, setCheck] = useState<Check>({ state: "idle" });

  if (!record || record.status === "playing" || record.status === "saving") {
    return <div className="record-proof"><p className="record-line pending">Saving this run and anchoring it on-chain…</p></div>;
  }
  if (record.status === "failed" || !record.digest) {
    return <div className="record-proof"><p className="record-line">This run couldn't be saved.</p></div>;
  }
  const link = recordLink(record.id);
  const anchor = txUrl(record.anchorTx);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked: the link is visible anyway */ }
  };
  const verify = async () => {
    setCheck({ state: "checking" });
    try {
      const digest = await sha256Hex(await fetchRecordText(record.id));
      const onChain = record.registry ? await readAnchor(record.registry, record.id) : null;
      setCheck({ state: "done", digestOk: digest === record.digest, chainOk: !!onChain && onChain === digest.toLowerCase(), onChain });
    } catch (err) {
      setCheck({ state: "error", message: err instanceof Error ? err.message : "Couldn't reach the chain." });
    }
  };

  return (
    <div className="record-proof">
      <h3>This run is on the record</h3>
      <div className="record-link">
        <input readOnly value={link} aria-label="Permanent link to this run" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>
      </div>
      <dl className="record-facts">
        <div><dt>Fingerprint</dt><dd><code title={record.digest}>{short(record.digest)}</code></dd></div>
        <div>
          <dt>On-chain</dt>
          <dd>
            {anchor ? <a href={anchor} target="_blank" rel="noreferrer">Anchored on Base Sepolia</a>
              : record.anchor === "pending" ? "Anchoring…"
              : record.anchor === "failed" ? "Anchoring failed; the record is still saved"
              : "Not anchored"}
          </dd>
        </div>
      </dl>
      {anchor && record.registry && (
        <div className="record-verify">
          <button type="button" onClick={() => void verify()} disabled={check.state === "checking"}>
            {check.state === "checking" ? "Checking…" : "Check it yourself"}
          </button>
          {check.state === "done" && (
            <ul className="verify-checks">
              <li className={check.digestOk ? "ok" : "bad"}>{check.digestOk ? "✓" : "✗"} The record's fingerprint, recomputed in your browser, {check.digestOk ? "matches" : "does not match"}.</li>
              <li className={check.chainOk ? "ok" : "bad"}>
                {check.chainOk ? "✓" : "✗"} The fingerprint stored in the <a href={addressUrl(record.registry)} target="_blank" rel="noreferrer">registry contract</a> {check.chainOk ? "is the same: nothing was changed after the run." : check.onChain ? "is different." : "wasn't found yet. Try again in a minute."}
              </li>
            </ul>
          )}
          {check.state === "error" && <p className="status error">{check.message}</p>}
        </div>
      )}
      {!persistent && <p className="fine">This server keeps runs in memory only, so this link lasts until it restarts.</p>}
    </div>
  );
}

/** Every saved live run, newest first. */
export function PastRuns({ refresh, current, onOpen }: { refresh: unknown; current: string | null; onOpen: (id: string) => void }) {
  const [runs, setRuns] = useState<RecordMeta[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetchRecords().then((r) => { setRuns(r); setFailed(false); }).catch(() => setFailed(true));
  }, [refresh]);
  if (failed || !runs?.length) return null;

  return (
    <section className="past-runs" aria-labelledby="h-past">
      <div className="section-head"><h2 id="h-past">Past live runs</h2></div>
      <p className="hint">Every live run is saved, and its fingerprint is anchored on-chain.</p>
      <ul>
        {runs.map((r) => (
          <li key={r.id} className={r.id === current ? "on" : ""}>
            <button type="button" className="past-open" onClick={() => onOpen(r.id)} aria-current={r.id === current ? "true" : undefined}>
              <span className="past-when">{when(r.createdAt)}</span>
              <span className="past-scores">
                <span className="bad">{MARKET.UNPROTECTED.title} {r.metrics.UNPROTECTED?.integrityScore ?? "–"}</span>
                <span className="good">{MARKET.PROTECTED.title} {r.metrics.PROTECTED?.integrityScore ?? "–"}</span>
              </span>
              <span className="past-model">{modelText(r.model)}</span>
            </button>
            {txUrl(r.anchorTx) && <a className="past-proof" href={txUrl(r.anchorTx)} target="_blank" rel="noreferrer">On-chain proof</a>}
          </li>
        ))}
      </ul>
    </section>
  );
}
