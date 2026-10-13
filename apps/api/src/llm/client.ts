import Anthropic from "@anthropic-ai/sdk";

/**
 * The one place the app talks to an LLM. Agents and the verifier depend on this small interface,
 * so tests can pass a scripted fake and nothing else needs the SDK.
 */
export type CreateParams = Anthropic.Messages.MessageCreateParamsNonStreaming;
export type Message = Anthropic.Messages.Message;

export interface LlmClient {
  create(params: CreateParams): Promise<Message>;
}

export const DEFAULT_MODEL = process.env.LLM_MODEL || "claude-sonnet-5-5";
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 20_000);

/** Real client, or null when no key is configured (callers then use their deterministic fallback). */
export function createLlmClient(): LlmClient | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const sdk = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  return { create: (params) => sdk.messages.create(params) };
}
