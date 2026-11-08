import "server-only";

// All secrets are read here and only here. This module imports "server-only",
// so any accidental import from a client component fails the build.

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function num(name: string, fallback: number): number {
  const v = read(name);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  get appPassword() {
    return read("APP_PASSWORD");
  },
  get sessionSecret() {
    return read("SESSION_SECRET");
  },
  get serpApiKey() {
    return read("SERPAPI_API_KEY");
  },
  get serpApiMonthlyQuota() {
    return num("SERPAPI_MONTHLY_QUOTA", 250);
  },
  get anthropicApiKey() {
    return read("ANTHROPIC_API_KEY");
  },
  get anthropicModel() {
    return read("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5";
  },
  get claudeMonthlyBudgetUsd() {
    return num("CLAUDE_MONTHLY_BUDGET_USD", 15);
  },
  get supabaseUrl() {
    return read("SUPABASE_URL");
  },
  get supabaseSecretKey() {
    return read("SUPABASE_SECRET_KEY");
  },
  get cronSecret() {
    return read("CRON_SECRET");
  },
  get fixtureMode() {
    return read("DATA_MODE") === "fixtures";
  },
};
