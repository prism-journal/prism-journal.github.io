-- ============================================================================
-- PRISM — editorial database, phase 1 (submission intake)
--
-- Paste this whole file into the Supabase SQL Editor and press Run.
-- It is safe to run more than once.
--
-- Security model in one sentence: the anon key is public, so NOTHING here
-- trusts the client — every table denies all access by default and the
-- policies below are the only way in.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Controlled vocabularies. These mirror the six sections and six article
-- types published on the website; keeping them as enums means a malformed
-- submission is rejected by the database, not merely by the form.
-- ---------------------------------------------------------------------------
do $$ begin
  create type prism_role as enum (
    'author', 'reviewer', 'section_editor', 'faculty_editor', 'chief_editor'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type prism_section as enum (
    'physics_astronomy', 'chemistry_materials', 'biology_health',
    'earth_environment', 'computation_math', 'quantitative_social'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type prism_article_type as enum (
    'research_article', 'short_report', 'replication',
    'registered_report', 'review', 'comment'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type prism_status as enum (
    'submitted', 'screening', 'under_review', 'revision',
    'accepted', 'declined', 'withdrawn'
  );
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------------
-- profiles — one row per account, created automatically on sign-up.
-- Role is NOT settable by the user; it defaults to 'author' and only a
-- chief editor can change it (enforced in the policies further down).
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  full_name   text not null default '',
  email       text not null default '',
  school      text,
  grade       text,
  country     text,
  orcid       text,
  role        prism_role not null default 'author',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- manuscripts
-- ---------------------------------------------------------------------------
create table if not exists public.manuscripts (
  id                uuid primary key default gen_random_uuid(),
  ms_number         text unique,
  title             text not null check (char_length(title) between 3 and 400),
  abstract          text not null check (char_length(abstract) between 40 and 4000),
  section           prism_section not null,
  article_type      prism_article_type not null,

  author_id         uuid not null references public.profiles(id) on delete restrict,
  coauthors         text default '',

  -- The integrity statements the website requires of every submission.
  mentor_statement  text not null check (char_length(mentor_statement) >= 10),
  data_doi          text,
  code_doi          text,
  ethics_ref        text,
  ai_disclosure     text,
  limitations       text,

  status            prism_status not null default 'submitted',
  editor_note       text,

  submitted_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists manuscripts_author_idx on public.manuscripts(author_id);
create index if not exists manuscripts_status_idx on public.manuscripts(status);

-- Human-readable accession number: PRISM-2027-0001
create sequence if not exists public.ms_seq;

create or replace function public.set_ms_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ms_number is null then
    new.ms_number := 'PRISM-' || to_char(now(), 'YYYY') || '-' ||
                     lpad(nextval('public.ms_seq')::text, 4, '0');
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists ms_number_trigger on public.manuscripts;
create trigger ms_number_trigger
  before insert or update on public.manuscripts
  for each row execute function public.set_ms_number();

-- ---------------------------------------------------------------------------
-- manuscript_files — metadata only; the bytes live in Storage.
-- ---------------------------------------------------------------------------
create table if not exists public.manuscript_files (
  id            uuid primary key default gen_random_uuid(),
  manuscript_id uuid not null references public.manuscripts on delete cascade,
  storage_path  text not null,
  filename      text not null,
  size_bytes    bigint,
  uploaded_by   uuid not null references public.profiles(id),
  uploaded_at   timestamptz not null default now()
);

create index if not exists files_ms_idx on public.manuscript_files(manuscript_id);

-- ---------------------------------------------------------------------------
-- status_events — append-only audit trail. A journal that cannot say who
-- changed a decision and when has no defensible record, so every status
-- change is written here and nothing is ever updated or deleted.
-- ---------------------------------------------------------------------------
create table if not exists public.status_events (
  id            uuid primary key default gen_random_uuid(),
  manuscript_id uuid not null references public.manuscripts on delete cascade,
  from_status   prism_status,
  to_status     prism_status not null,
  note          text,
  actor_id      uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

create index if not exists events_ms_idx on public.status_events(manuscript_id);

create or replace function public.log_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.status_events(manuscript_id, from_status, to_status, actor_id, note)
    values (new.id, null, new.status, new.author_id, 'submitted');
  elsif new.status is distinct from old.status then
    insert into public.status_events(manuscript_id, from_status, to_status, actor_id, note)
    values (new.id, old.status, new.status, auth.uid(), new.editor_note);
  end if;
  return new;
end $$;

drop trigger if exists status_log_trigger on public.manuscripts;
create trigger status_log_trigger
  after insert or update on public.manuscripts
  for each row execute function public.log_status_change();


-- ---------------------------------------------------------------------------
-- Auto-create a profile when someone signs up.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, school, grade, country)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    new.raw_user_meta_data->>'school',
    new.raw_user_meta_data->>'grade',
    new.raw_user_meta_data->>'country'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- Role helpers.
--
-- These are SECURITY DEFINER so that a policy on `profiles` can ask "what is
-- this user's role?" without re-entering the same policy and recursing
-- forever. This is the single most common way to get Supabase RLS wrong.
-- ---------------------------------------------------------------------------
create or replace function public.my_role()
returns prism_role language sql security definer stable set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_editor()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(
    (select role in ('section_editor','faculty_editor','chief_editor')
       from public.profiles where id = auth.uid()),
    false);
$$;

create or replace function public.is_chief()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(
    (select role = 'chief_editor' from public.profiles where id = auth.uid()),
    false);
$$;


-- ---------------------------------------------------------------------------
-- Row level security. Everything is denied until a policy allows it.
-- ---------------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.manuscripts      enable row level security;
alter table public.manuscript_files enable row level security;
alter table public.status_events    enable row level security;

-- profiles ------------------------------------------------------------------
drop policy if exists "read own profile"      on public.profiles;
drop policy if exists "editors read profiles" on public.profiles;
drop policy if exists "update own profile"    on public.profiles;
drop policy if exists "chief updates roles"   on public.profiles;

create policy "read own profile" on public.profiles
  for select using (id = auth.uid());

create policy "editors read profiles" on public.profiles
  for select using (public.is_editor());

-- A user may edit their own details but MAY NOT promote themselves. my_role()
-- is SECURITY DEFINER and STABLE, so it reports the role as of the start of the
-- statement — a plain subquery here could observe the row mid-update and let an
-- escalation through.
create policy "update own profile" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = public.my_role());

create policy "chief updates roles" on public.profiles
  for update using (public.is_chief()) with check (public.is_chief());

-- manuscripts ---------------------------------------------------------------
drop policy if exists "authors read own ms"   on public.manuscripts;
drop policy if exists "editors read all ms"   on public.manuscripts;
drop policy if exists "authors submit"        on public.manuscripts;
drop policy if exists "authors edit pre-review" on public.manuscripts;
drop policy if exists "editors update ms"     on public.manuscripts;

create policy "authors read own ms" on public.manuscripts
  for select using (author_id = auth.uid());

create policy "editors read all ms" on public.manuscripts
  for select using (public.is_editor());

-- You may only submit as yourself, and only in the 'submitted' state.
create policy "authors submit" on public.manuscripts
  for insert with check (author_id = auth.uid() and status = 'submitted');

-- Authors may fix their own submission only while it is still untouched.
create policy "authors edit pre-review" on public.manuscripts
  for update using (author_id = auth.uid() and status in ('submitted','revision'))
  with check (author_id = auth.uid());

create policy "editors update ms" on public.manuscripts
  for update using (public.is_editor()) with check (public.is_editor());

-- files ---------------------------------------------------------------------
drop policy if exists "read own files"    on public.manuscript_files;
drop policy if exists "editors read files" on public.manuscript_files;
drop policy if exists "attach own files"  on public.manuscript_files;

create policy "read own files" on public.manuscript_files
  for select using (exists (
    select 1 from public.manuscripts m
    where m.id = manuscript_id and m.author_id = auth.uid()));

create policy "editors read files" on public.manuscript_files
  for select using (public.is_editor());

create policy "attach own files" on public.manuscript_files
  for insert with check (uploaded_by = auth.uid() and exists (
    select 1 from public.manuscripts m
    where m.id = manuscript_id and m.author_id = auth.uid()));

-- status events — readable by the people it concerns, writable by nobody
-- directly (only the trigger, which runs as definer).
drop policy if exists "read own events"     on public.status_events;
drop policy if exists "editors read events" on public.status_events;

create policy "read own events" on public.status_events
  for select using (exists (
    select 1 from public.manuscripts m
    where m.id = manuscript_id and m.author_id = auth.uid()));

create policy "editors read events" on public.status_events
  for select using (public.is_editor());



-- ---------------------------------------------------------------------------
-- Table privileges.
--
-- Supabase can be told to expose new tables to the API automatically. Rather
-- than depend on that project setting being one way or the other, the grants
-- are written out here. This is the coarse layer: it says which tables the API
-- may touch at all. The RLS policies above are the fine layer, deciding which
-- ROWS. Both are required; neither substitutes for the other.
--
-- `anon` is granted nothing on purpose. Every portal action requires a signed-in
-- user, so an unauthenticated caller holding the public key can reach no data.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select, insert, update on public.profiles         to authenticated;
grant select, insert, update on public.manuscripts      to authenticated;
grant select, insert         on public.manuscript_files to authenticated;
grant select                 on public.status_events    to authenticated;

grant execute on function public.my_role()   to authenticated;
grant execute on function public.is_editor() to authenticated;
grant execute on function public.is_chief()  to authenticated;

-- If the project has "automatically expose new tables" switched on, Supabase
-- will already have granted these tables to anon. RLS still reduces anon to
-- zero rows, but there is no reason for the privilege to exist at all, so it
-- is taken back explicitly. Belt as well as braces.
revoke all on public.profiles         from anon;
revoke all on public.manuscripts      from anon;
revoke all on public.manuscript_files from anon;
revoke all on public.status_events    from anon;


-- ---------------------------------------------------------------------------
-- Storage: a private bucket for manuscript PDFs.
-- Files are namespaced by user id, and the policies below are what stop one
-- author from reading another author's submission.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manuscripts', 'manuscripts', false, 26214400, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 26214400,
      allowed_mime_types = array['application/pdf'];

drop policy if exists "upload own manuscript"  on storage.objects;
drop policy if exists "read own manuscript"    on storage.objects;
drop policy if exists "editors read manuscripts" on storage.objects;

create policy "upload own manuscript" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'manuscripts'
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "read own manuscript" on storage.objects
  for select to authenticated
  using (bucket_id = 'manuscripts'
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy "editors read manuscripts" on storage.objects
  for select to authenticated
  using (bucket_id = 'manuscripts' and public.is_editor());


-- ---------------------------------------------------------------------------
-- Make yourself chief editor. Sign up through the portal FIRST, then run
-- this line with your own address:
--
--   update public.profiles set role = 'chief_editor' where email = 'you@example.com';
--
-- Roles cannot be self-assigned through the app, so this SQL editor is
-- deliberately the only way the first editor is ever created.
-- ---------------------------------------------------------------------------
