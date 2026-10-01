-- Travel Planner schema. Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- Row Level Security is ON with no policies: the public anon key can read/write nothing.
-- The app talks to these tables only from the server using the secret key.

create table if not exists api_cache (
  key         text primary key,           -- sha256 of engine + normalized params
  engine      text not null,
  params      jsonb not null,             -- normalized params (api_key never stored)
  response    jsonb not null,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists api_cache_expires_idx on api_cache (expires_at);

create table if not exists usage_log (
  id             bigserial primary key,
  kind           text not null check (kind in ('serpapi', 'claude')),
  engine         text not null,             -- serpapi engine or claude model
  cache_key      text,
  input_tokens   integer,
  output_tokens  integer,
  cost_usd       numeric(10, 5) not null default 0,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists usage_log_kind_created_idx on usage_log (kind, created_at desc);

create table if not exists settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists trips (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  inputs       jsonb not null,
  dataset      jsonb not null,              -- everything fetched for this trip (the grounding set)
  plan         jsonb not null,              -- Lean / Balanced / Splurge versions
  upgrades     jsonb,
  share_token  text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists trips_updated_idx on trips (updated_at desc);

alter table api_cache enable row level security;
alter table usage_log enable row level security;
alter table settings  enable row level security;
alter table trips     enable row level security;

-- Housekeeping: drop cache rows that expired more than 7 days ago.
-- Called opportunistically by the daily keep-alive cron.
create or replace function purge_expired_cache() returns integer
language sql security definer as $$
  with d as (delete from api_cache where expires_at < now() - interval '7 days' returning 1)
  select count(*)::int from d;
$$;
revoke all on function purge_expired_cache() from public, anon, authenticated;
