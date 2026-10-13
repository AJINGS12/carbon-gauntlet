import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests never read or write the real demo recordings in data/traces.
process.env.TRACES_DIR = mkdtempSync(join(tmpdir(), "cg-traces-"));
// Tests never call a real model unless a test injects a fake one.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.RECORD_TRACES;
process.env.DEMO_MODE = "false";
