import { pathToFileURL } from "node:url";

/** Where recorded traces live: data/traces/<kind>/ by default; TRACES_DIR overrides (tests use a temp dir). */
export function tracesDir(kind: "verifier" | "runs"): URL {
  const base = process.env.TRACES_DIR ? pathToFileURL(process.env.TRACES_DIR.replace(/[\\/]?$/, "/")) : new URL("../../../data/traces/", import.meta.url);
  return new URL(`${kind}/`, base);
}
