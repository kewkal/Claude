import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { estimateCostUsd } from "@/lib/claude-pricing";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { assertClaudeBudget } from "@/lib/usage";

export interface ClaudeJsonRequest<T> {
  /** Stable, cacheable instructions + data (identical across the versions of one plan). */
  system: string;
  /** Per-call instructions. */
  user: string;
  schema: Record<string, unknown>;
  /** Short label for the usage log. */
  note: string;
  maxTokens?: number;
  /** Used instead of the API when DATA_MODE=fixtures. */
  fixture: () => T;
}

export interface ClaudeJsonResult<T> {
  data: T;
  model: string;
  costUsd: number;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  const apiKey = env.anthropicApiKey;
  if (!apiKey) throw new AppError("CLAUDE_NOT_CONFIGURED", "ANTHROPIC_API_KEY is not set.");
  client ??= new Anthropic({ apiKey, maxRetries: 2, timeout: 240_000 });
  return client;
}

/**
 * One structured-output Claude call. Streams (long outputs), uses adaptive thinking at medium effort,
 * opts into server-side refusal fallbacks, logs token cost, and enforces the monthly budget.
 */
export async function claudeJson<T>(req: ClaudeJsonRequest<T>): Promise<ClaudeJsonResult<T>> {
  if (env.fixtureMode) return { data: req.fixture(), model: "fixture", costUsd: 0 };
  await assertClaudeBudget();
  const model = env.anthropicModel;

  let message;
  try {
    const stream = getClient().beta.messages.stream({
      model,
      max_tokens: req.maxTokens ?? 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: req.schema } },
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: req.user }],
    });
    message = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AppError("CLAUDE_NOT_CONFIGURED", "Claude rejected the API key. Check ANTHROPIC_API_KEY.");
    if (e instanceof Anthropic.RateLimitError) throw new AppError("CLAUDE_ERROR", "Claude is rate-limiting requests. Try again in a minute.");
    if (e instanceof Anthropic.BadRequestError) throw new AppError("CLAUDE_ERROR", `Claude rejected the request: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new AppError("CLAUDE_ERROR", `Claude API error (${e.status ?? "network"}). Try again.`);
    throw new AppError("CLAUDE_ERROR", `Couldn't reach Claude: ${(e as Error).message}`);
  }

  const costUsd = estimateCostUsd(message.model ?? model, message.usage);
  await getDb().logUsage({
    kind: "claude",
    engine: message.model ?? model,
    input_tokens: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0),
    output_tokens: message.usage.output_tokens,
    cost_usd: costUsd,
    note: req.note,
  });

  if (message.stop_reason === "refusal") throw new AppError("CLAUDE_ERROR", "Claude declined this request. Try adjusting the trip inputs.");
  if (message.stop_reason === "max_tokens") throw new AppError("CLAUDE_ERROR", "Claude's answer was cut off (too long). Try fewer days or a lighter pace.");

  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return { data: JSON.parse(text) as T, model: message.model ?? model, costUsd };
  } catch {
    throw new AppError("CLAUDE_ERROR", "Claude returned an unreadable answer. Try again.");
  }
}
