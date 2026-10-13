import type Anthropic from "@anthropic-ai/sdk";
import type { ArenaEvent, Attestation, Project } from "../types.js";
import { AttestationSchema } from "../types.js";
import { DEFAULT_MODEL, type LlmClient } from "../llm/client.js";
import { applyGuardrails, runChecks, verdictFor } from "./checks.js";
import { checkOverlap, compareBaseline, findReusedEvidence, findSimilarEvidence } from "./tools.js";
import { VERIFIER_SYSTEM, VERIFIER_TOOLS, submissionMessage } from "./prompt.js";
import { loadTrace, saveTrace, traceKey, type TraceStep } from "./traces.js";

export const MAX_STEPS = 6;          // investigation tool calls before the verdict is forced
const MAX_TURNS = MAX_STEPS + 2;     // hard stop on model round-trips

export interface HistoryEntry { projectId: string; status: Attestation["status"]; flags: string[] }

export interface VerifierContext {
  registry: Project[];                                  // projects the registry has already seen
  history: (developerId: string) => HistoryEntry[];     // past verifier decisions
}

export interface VerifyOptions {
  llm?: LlmClient | null;
  model?: string;
  demoMode?: boolean;     // replay recorded traces; never call the LLM
  record?: boolean;       // save live traces for later replay
}

/** Strip seed-only fields so neither the LLM nor the tools ever see which projects are planted frauds. */
const visible = (p: Project): Project => {
  const { planted: _hidden, ...rest } = p;
  return rest;
};

/**
 * Verifies one submission. Order of preference:
 *   demo mode → recorded trace (if one matches this exact situation) → rules
 *   live      → LLM investigation → rules if the LLM fails
 * Rule guardrails are applied to every LLM verdict, recorded or live.
 */
export async function verifyProject(
  submitted: Project,
  ctx: VerifierContext,
  emit: (e: ArenaEvent) => void,
  opts: VerifyOptions = {},
): Promise<Attestation> {
  const project = visible(submitted);
  const registry = ctx.registry.map(visible);
  const guard = runChecks(project, registry);
  const key = traceKey(project, registry);

  if (opts.demoMode) {
    const trace = loadTrace(project.projectId, key);
    if (trace) {
      trace.steps.forEach((s, i) => emit({ type: "verifier_step", projectId: project.projectId, step: i + 1, tool: s.tool, reason: s.reason, result: s.result, source: "replay" }));
      return { ...applyGuardrails(trace.attestation, project, guard.flags), engine: "replay" };
    }
    return rulesOnly(project, guard, emit);
  }

  if (opts.llm) {
    try {
      const steps: TraceStep[] = [];
      const raw = await investigate(project, registry, ctx, opts.llm, opts.model ?? DEFAULT_MODEL, (s) => {
        steps.push(s);
        emit({ type: "verifier_step", projectId: project.projectId, step: steps.length, tool: s.tool, reason: s.reason, result: s.result, source: "llm" });
      });
      if (opts.record) saveTrace(project.projectId, { key, model: opts.model ?? DEFAULT_MODEL, recordedAt: new Date().toISOString(), steps, attestation: raw });
      return { ...applyGuardrails(raw, project, guard.flags), engine: "llm" };
    } catch (err) {
      emit({ type: "verifier_step", projectId: project.projectId, step: 0, tool: "fallback", reason: `LLM unavailable (${(err as Error).message}); using rule checks`, result: null, source: "rules" });
    }
  }
  return rulesOnly(project, guard, emit);
}

function rulesOnly(project: Project, guard: ReturnType<typeof runChecks>, emit: (e: ArenaEvent) => void): Attestation {
  guard.steps.forEach((s, i) => emit({ type: "verifier_step", projectId: project.projectId, step: i + 1, tool: s.tool, reason: s.reason, result: s.result, source: "rules" }));
  const { status, recommendedAction } = verdictFor(guard.flags);
  return {
    projectId: project.projectId,
    status,
    recommendedAction,
    confidence: status === "APPROVED" ? 0.8 : 0.9,
    riskFlags: guard.flags,
    approvedReduction: status === "APPROVED" ? project.claimedReduction : 0,
    explanation: guard.flags.length ? guard.flags.map((f) => f.detail).join(". ") + "." : "All rule checks passed: no overlap, no reused or copied evidence, and a plausible claim.",
    engine: "rules",
  };
}

/** The Claude tool-use loop. Returns the model's own attestation (before guardrails). */
async function investigate(
  project: Project,
  registry: Project[],
  ctx: VerifierContext,
  llm: LlmClient,
  model: string,
  onStep: (s: TraceStep) => void,
): Promise<Attestation> {
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: submissionMessage(project) }];
  let toolCalls = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const mustSubmit = toolCalls >= MAX_STEPS;
    const res = await llm.create({
      model,
      max_tokens: 1500,
      temperature: 0,
      system: VERIFIER_SYSTEM,
      tools: VERIFIER_TOOLS,
      // "any" forces a tool call every turn, so the model can't drift into free text.
      tool_choice: mustSubmit ? { type: "tool", name: "submit_attestation" } : { type: "any" },
      messages,
    });

    const uses = res.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
    if (!uses.length) throw new Error("model returned no tool call");

    const submit = uses.find((u) => u.name === "submit_attestation");
    if (submit) {
      const parsed = AttestationSchema.safeParse({ ...(submit.input as object), projectId: project.projectId });
      if (!parsed.success) throw new Error(`invalid attestation: ${parsed.error.issues[0]?.message}`);
      return parsed.data;
    }

    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const use of uses) {
      toolCalls++;
      const input = use.input as { reason?: string; developerId?: string };
      const result = runTool(use.name, input, project, registry, ctx);
      onStep({ tool: use.name, reason: String(input.reason ?? ""), result });
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: results });
  }
  throw new Error(`no verdict after ${MAX_TURNS} turns`);
}

function runTool(name: string, input: { developerId?: string }, project: Project, registry: Project[], ctx: VerifierContext): unknown {
  switch (name) {
    case "check_overlap": return checkOverlap(project, registry);
    case "find_reused_evidence": return findReusedEvidence(project, registry);
    case "find_similar_evidence": return findSimilarEvidence(project, registry);
    case "compare_baseline": return compareBaseline(project);
    case "lookup_developer_history": return ctx.history(String(input.developerId ?? project.developerId));
    default: return { error: `unknown tool ${name}` };
  }
}
