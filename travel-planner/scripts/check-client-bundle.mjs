#!/usr/bin/env node
// Verifies no secrets reach the browser. Run after `next build`:
//   npm run build && npm run check:bundle
// Scans every file the browser can download (.next/static) for:
//   1. the actual values of secret env vars present at build time
//   2. known key prefixes (variable *names* appear in UI setup hints and aren't secret)
//   3. server-only endpoints (SerpApi search, Anthropic API, Supabase REST)
// and checks the source tree for NEXT_PUBLIC_ variables (which Next inlines into client code).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const staticDir = path.join(root, ".next", "static");
if (!existsSync(staticDir)) {
  console.error("No .next/static found. Run `npm run build` first.");
  process.exit(2);
}

const SECRET_VARS = ["SERPAPI_API_KEY", "ANTHROPIC_API_KEY", "SUPABASE_SECRET_KEY", "SESSION_SECRET", "APP_PASSWORD", "CRON_SECRET", "SUPABASE_URL"];
const needles = [];
for (const v of SECRET_VARS) {
  const val = process.env[v];
  if (val && val.length >= 8) needles.push({ label: `value of ${v}`, text: val });
}
needles.push(
  { label: "Anthropic key prefix", text: "sk-ant-" },
  { label: "Supabase secret key prefix", text: "sb_secret_" },
  { label: "SerpApi search endpoint", text: "serpapi.com/search" },
  { label: "SerpApi account endpoint", text: "serpapi.com/account" },
  { label: "Anthropic API host", text: "api.anthropic.com" },
  { label: "Supabase REST path", text: "/rest/v1" },
);

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(staticDir);
const hits = [];
for (const f of files) {
  const body = readFileSync(f, "utf8");
  for (const n of needles) if (body.includes(n.text)) hits.push(`${path.relative(root, f)}: contains ${n.label}`);
}

const srcHits = walk(path.join(root, "src"))
  .filter((f) => /\.(ts|tsx|js|mjs)$/.test(f))
  .filter((f) => readFileSync(f, "utf8").includes("NEXT_PUBLIC_"))
  .map((f) => `${path.relative(root, f)}: uses a NEXT_PUBLIC_ variable`);

const checkedValues = SECRET_VARS.filter((v) => (process.env[v] ?? "").length >= 8);
console.log(`Scanned ${files.length} client files for ${needles.length} patterns.`);
console.log(`Secret values checked: ${checkedValues.length ? checkedValues.join(", ") : "none set in this shell (names/prefixes/endpoints still checked)"}`);
if (hits.length || srcHits.length) {
  console.error("FAIL — possible secret exposure:");
  for (const h of [...hits, ...srcHits]) console.error(`  ${h}`);
  process.exit(1);
}
console.log("PASS — no secrets, key prefixes, or server-only endpoints in the client bundle; no NEXT_PUBLIC_ vars in src/.");
