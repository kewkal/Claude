// Published per-million-token prices (USD), checked against platform.claude.com/docs pricing on 10/01/2026.
// Cache writes bill at 1.25× input; cache reads at `cacheReadMult` × input.
export const CLAUDE_PRICING: Record<string, { input: number; output: number; cacheReadMult: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheReadMult: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheReadMult: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheReadMult: 0.05 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheReadMult: 0.1 },
  "claude-fable-5-1": { input: 10, output: 50, cacheReadMult: 0.025 },
};

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function estimateCostUsd(model: string, u: TokenUsage): number {
  // Unknown models are priced like Sonnet 5.5 so the meter never reads $0.
  const p = CLAUDE_PRICING[model] ?? CLAUDE_PRICING[model.replace(/-\d{8}$/, "")] ?? CLAUDE_PRICING["claude-sonnet-5-5"];
  const write = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const usd = (u.input_tokens * p.input + write * p.input * 1.25 + read * p.input * p.cacheReadMult + u.output_tokens * p.output) / 1_000_000;
  return Math.round(usd * 100000) / 100000;
}
