create table if not exists public.gemini_debug_log (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  message_id    bigint,
  outcome       text not null,
  model         text,
  http_status   int,
  finish_reason text,
  raw           text
);

alter table public.gemini_debug_log enable row level security;
-- no policies on purpose: only the edge function (service role) can read/write

notify pgrst, 'reload schema';