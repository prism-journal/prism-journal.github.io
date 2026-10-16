-- Keepalive for the free-tier pause timer.
--
-- Run this once in the Supabase SQL editor. The scheduled workflow in
-- .github/workflows/keepalive.yml calls the function it creates.
--
-- Why a function that writes, rather than the select the workflow used to do:
-- the old ping read one row from journal_settings, returned HTTP 200 every
-- time, and the project was still flagged as inactive on 16 October 2026 and
-- paused outright on 14 September. A read can be answered without the database
-- doing durable work. An update cannot: it takes a row lock, writes WAL and
-- advances the transaction counter, which is activity by any definition.
--
-- The table is not reachable from outside. Row-level security is on and no
-- policy is created for it, and no table-level grant is issued, so the only
-- route in is the security-definer function below. The worst an anonymous
-- caller can do with the publishable key is move one timestamp forward and
-- increment one counter, which is exactly what the workflow wants anyway.

create table if not exists public.keepalive (
  id        int primary key default 1 check (id = 1),
  pinged_at timestamptz not null default now(),
  pings     bigint      not null default 0
);

insert into public.keepalive (id) values (1) on conflict (id) do nothing;

alter table public.keepalive enable row level security;
-- deliberately no policies: nothing reaches this table except through keepalive()

create or replace function public.keepalive()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  t timestamptz;
begin
  update public.keepalive
     set pinged_at = now(),
         pings     = pings + 1
   where id = 1
  returning pinged_at into t;
  return t;
end;
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

-- Check it by hand:
--   select public.keepalive();
-- or over the wire, which is what the workflow does:
--   curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/keepalive" \
--        -H "apikey: $PUBLISHABLE_KEY" -H "Content-Type: application/json" -d '{}'
