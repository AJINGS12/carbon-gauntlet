-- Carbon Gauntlet: saved live runs. Paste into Supabase → SQL Editor → Run.
-- The API writes with the secret key; row level security with no policies keeps the table closed to everyone else.
create table if not exists runs (
  id          text primary key,            -- e.g. live-1rlratfxjw (also the on-chain anchor ID)
  created_at  timestamptz not null default now(),
  model       text,
  metrics     jsonb,                       -- final metrics for both markets
  digest      text not null,               -- 0x + sha256 of body
  anchor_tx   text,                        -- Base Sepolia tx that anchored the digest
  registry    text,                        -- contract holding the anchor
  body        text not null                -- the full run, byte for byte (hash it to check the digest)
);
alter table runs enable row level security;
create index if not exists runs_created_at on runs (created_at desc);
