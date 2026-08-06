-- ============================================================================
-- PRISM — editorial database
--
-- Paste the whole file into the Supabase SQL Editor and press Run.
-- Safe to run repeatedly: every statement is idempotent.
--
-- Security model in one sentence: the publishable key is public, so nothing
-- here trusts the client — every table denies access by default and the
-- policies below are the only way in.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Controlled vocabularies.
-- ---------------------------------------------------------------------------
do $$ begin
  create type prism_section as enum (
    'physics_astronomy', 'chemistry_materials', 'biology_health',
    'earth_environment', 'computation_math', 'quantitative_social');
exception when duplicate_object then null; end $$;

do $$ begin
  create type prism_article_type as enum (
    'research_article', 'short_report', 'replication',
    'registered_report', 'review', 'comment');
exception when duplicate_object then null; end $$;

do $$ begin
  create type prism_status as enum (
    'submitted', 'screening', 'under_review', 'revision',
    'accepted', 'declined', 'withdrawn');
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  full_name   text not null default '',
  email       text not null default '',
  school      text,
  grade       text,
  country     text,
  orcid       text,
  role        text not null default 'author',
  created_at  timestamptz not null default now()
);

-- Role started out as an enum. A value added to a Postgres enum cannot be used
-- in the same transaction that added it, which would break this script the
-- moment a new role is introduced. Text with a check constraint gives the same
-- integrity guarantee and can grow without that trap.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles'
               and column_name = 'role' and udt_name = 'prism_role') then
    alter table public.profiles alter column role drop default;
    alter table public.profiles alter column role type text using role::text;
    alter table public.profiles alter column role set default 'author';
  end if;
end $$;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in (
  'author', 'reviewer', 'board_member',
  'section_editor', 'faculty_editor', 'deputy_editor', 'chief_editor'));


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
create trigger ms_number_trigger before insert or update on public.manuscripts
  for each row execute function public.set_ms_number();


-- ---------------------------------------------------------------------------
-- files
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
-- status_events — append-only audit trail
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
create trigger status_log_trigger after insert or update on public.manuscripts
  for each row execute function public.log_status_change();


-- ---------------------------------------------------------------------------
-- review assignments
-- ---------------------------------------------------------------------------
create table if not exists public.review_assignments (
  id             uuid primary key default gen_random_uuid(),
  manuscript_id  uuid not null references public.manuscripts on delete cascade,
  reviewer_id    uuid not null references public.profiles(id) on delete cascade,
  assigned_by    uuid references public.profiles(id),
  assigned_at    timestamptz not null default now(),
  due_at         date,
  state          text not null default 'invited'
                 check (state in ('invited','accepted','declined','submitted')),
  decline_reason text,
  unique (manuscript_id, reviewer_id)
);
create index if not exists assign_reviewer_idx on public.review_assignments(reviewer_id);
create index if not exists assign_ms_idx on public.review_assignments(manuscript_id);


-- ---------------------------------------------------------------------------
-- reviews — everything here may eventually be shown to the author, because
-- PRISM publishes the review record. Anything that must NOT reach the author
-- lives in review_notes instead. Separate tables mean that boundary is
-- enforced by RLS, not by remembering to omit a column.
-- ---------------------------------------------------------------------------
create table if not exists public.reviews (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null unique references public.review_assignments on delete cascade,
  manuscript_id  uuid not null references public.manuscripts on delete cascade,
  reviewer_id    uuid not null references public.profiles(id) on delete cascade,
  sound          int not null check (sound between 1 and 5),
  honest         int not null check (honest between 1 and 5),
  checkable      int not null check (checkable between 1 and 5),
  legible        int not null check (legible between 1 and 5),
  summary        text not null check (char_length(summary) >= 20),
  major_points   text,
  minor_points   text,
  recommendation text not null
                 check (recommendation in ('accept','minor_revision','major_revision','decline')),
  signed         boolean not null default false,
  submitted_at   timestamptz not null default now()
);
create index if not exists reviews_ms_idx on public.reviews(manuscript_id);

create table if not exists public.review_notes (
  review_id  uuid primary key references public.reviews on delete cascade,
  note       text not null,
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- decisions — signed by a named editor, never anonymous
-- ---------------------------------------------------------------------------
create table if not exists public.decisions (
  id            uuid primary key default gen_random_uuid(),
  manuscript_id uuid not null references public.manuscripts on delete cascade,
  editor_id     uuid not null references public.profiles(id),
  decision      text not null
                check (decision in ('accept','minor_revision','major_revision','decline')),
  letter        text not null check (char_length(letter) >= 20),
  signed_name   text not null,
  created_at    timestamptz not null default now()
);
create index if not exists decisions_ms_idx on public.decisions(manuscript_id);


-- ---------------------------------------------------------------------------
-- Auto-create a profile on sign-up.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, school, grade, country)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', ''),
          coalesce(new.email, ''),
          new.raw_user_meta_data->>'school',
          new.raw_user_meta_data->>'grade',
          new.raw_user_meta_data->>'country')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER so a policy on `profiles` can ask what role
-- the caller holds without re-entering that same policy and recursing — the
-- most common way to get Supabase RLS wrong.
-- ---------------------------------------------------------------------------
create or replace function public.my_role()
returns text language sql security definer stable set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Sees the whole queue: editors, plus board members in an advisory capacity.
create or replace function public.can_see_queue()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role in ('board_member','section_editor','faculty_editor',
                                   'deputy_editor','chief_editor')
                     from public.profiles where id = auth.uid()), false);
$$;

-- Moves manuscripts through the workflow and assigns referees.
create or replace function public.is_editor()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role in ('section_editor','faculty_editor',
                                   'deputy_editor','chief_editor')
                     from public.profiles where id = auth.uid()), false);
$$;

-- Signs decisions. A student section editor deliberately cannot.
create or replace function public.can_decide()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role in ('faculty_editor','deputy_editor','chief_editor')
                     from public.profiles where id = auth.uid()), false);
$$;

-- Changes other people's roles.
create or replace function public.can_manage_people()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role in ('deputy_editor','chief_editor')
                     from public.profiles where id = auth.uid()), false);
$$;

-- Roles are a hierarchy, so authority over them is expressed as a rank. You may
-- only manage people strictly below you, and only hand out roles strictly below
-- your own. The chief editor is the single exception and may do either.
create or replace function public.role_rank(r text)
returns int language sql immutable as $$
  select case r
    when 'author'         then 10
    when 'reviewer'       then 20
    when 'board_member'   then 30
    when 'section_editor' then 40
    when 'faculty_editor' then 50
    when 'deputy_editor'  then 80
    when 'chief_editor'   then 100
    else 0 end;
$$;

create or replace function public.is_chief()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select role = 'chief_editor' from public.profiles where id = auth.uid()), false);
$$;


-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.manuscripts        enable row level security;
alter table public.manuscript_files   enable row level security;
alter table public.status_events      enable row level security;
alter table public.review_assignments enable row level security;
alter table public.reviews            enable row level security;
alter table public.review_notes       enable row level security;
alter table public.decisions          enable row level security;

-- profiles ------------------------------------------------------------------
drop policy if exists "read own profile"      on public.profiles;
drop policy if exists "editors read profiles" on public.profiles;
drop policy if exists "update own profile"    on public.profiles;
drop policy if exists "chief updates roles"   on public.profiles;
drop policy if exists "managers update roles" on public.profiles;

create policy "read own profile" on public.profiles
  for select using (id = auth.uid());
create policy "editors read profiles" on public.profiles
  for select using (public.can_see_queue());

-- A user may edit their own details but MAY NOT promote themselves. my_role()
-- is SECURITY DEFINER and STABLE, so it reports the role as of the start of
-- the statement; a plain subquery could observe the row mid-update and let an
-- escalation through.
create policy "update own profile" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = public.my_role());

-- Deputies and the chief may appoint people, bounded by rank.
--
--   USING      tests the row as it stands  -> whose role you may touch
--   WITH CHECK tests the row as it will be -> which role you may grant
--
-- Both must clear your own rank, so a deputy can neither demote the chief who
-- appointed them nor quietly promote a friend to deputy. Nobody edits their own
-- role here at all; the "update own profile" policy covers your own details and
-- pins the role column, which also stops a chief from accidentally demoting
-- themselves and locking everyone out.
create policy "managers update roles" on public.profiles
  for update
  using (public.can_manage_people()
         and id <> auth.uid()
         and (public.is_chief()
              or public.role_rank(role) < public.role_rank(public.my_role())))
  with check (public.can_manage_people()
              and (public.is_chief()
                   or public.role_rank(role) < public.role_rank(public.my_role())));

-- manuscripts ---------------------------------------------------------------
drop policy if exists "authors read own ms"     on public.manuscripts;
drop policy if exists "editors read all ms"     on public.manuscripts;
drop policy if exists "reviewers read assigned" on public.manuscripts;
drop policy if exists "authors submit"          on public.manuscripts;
drop policy if exists "authors edit pre-review" on public.manuscripts;
drop policy if exists "editors update ms"       on public.manuscripts;

create policy "authors read own ms" on public.manuscripts
  for select using (author_id = auth.uid());
create policy "editors read all ms" on public.manuscripts
  for select using (public.can_see_queue());
create policy "reviewers read assigned" on public.manuscripts
  for select using (exists (
    select 1 from public.review_assignments a
    where a.manuscript_id = id and a.reviewer_id = auth.uid()
      and a.state in ('invited','accepted','submitted')));

create policy "authors submit" on public.manuscripts
  for insert with check (author_id = auth.uid() and status = 'submitted');
create policy "authors edit pre-review" on public.manuscripts
  for update using (author_id = auth.uid() and status in ('submitted','revision'))
  with check (author_id = auth.uid());
create policy "editors update ms" on public.manuscripts
  for update using (public.is_editor()) with check (public.is_editor());

-- files ---------------------------------------------------------------------
drop policy if exists "read own files"       on public.manuscript_files;
drop policy if exists "editors read files"   on public.manuscript_files;
drop policy if exists "reviewers read files" on public.manuscript_files;
drop policy if exists "attach own files"     on public.manuscript_files;

create policy "read own files" on public.manuscript_files
  for select using (exists (select 1 from public.manuscripts m
    where m.id = manuscript_id and m.author_id = auth.uid()));
create policy "editors read files" on public.manuscript_files
  for select using (public.can_see_queue());
create policy "reviewers read files" on public.manuscript_files
  for select using (exists (select 1 from public.review_assignments a
    where a.manuscript_id = manuscript_id and a.reviewer_id = auth.uid()
      and a.state in ('invited','accepted','submitted')));
create policy "attach own files" on public.manuscript_files
  for insert with check (uploaded_by = auth.uid() and exists (
    select 1 from public.manuscripts m
    where m.id = manuscript_id and m.author_id = auth.uid()));

-- status events -------------------------------------------------------------
drop policy if exists "read own events"     on public.status_events;
drop policy if exists "editors read events" on public.status_events;
create policy "read own events" on public.status_events
  for select using (exists (select 1 from public.manuscripts m
    where m.id = manuscript_id and m.author_id = auth.uid()));
create policy "editors read events" on public.status_events
  for select using (public.can_see_queue());

-- assignments ---------------------------------------------------------------
drop policy if exists "reviewer reads own assignments" on public.review_assignments;
drop policy if exists "editors read assignments"       on public.review_assignments;
drop policy if exists "editors create assignments"     on public.review_assignments;
drop policy if exists "reviewer answers invitation"    on public.review_assignments;
drop policy if exists "editors update assignments"     on public.review_assignments;

create policy "reviewer reads own assignments" on public.review_assignments
  for select using (reviewer_id = auth.uid());
create policy "editors read assignments" on public.review_assignments
  for select using (public.can_see_queue());
create policy "editors create assignments" on public.review_assignments
  for insert with check (public.is_editor());
-- A referee may accept or decline their own invitation, and nothing else.
create policy "reviewer answers invitation" on public.review_assignments
  for update using (reviewer_id = auth.uid())
  with check (reviewer_id = auth.uid() and state in ('accepted','declined','submitted'));
create policy "editors update assignments" on public.review_assignments
  for update using (public.is_editor()) with check (public.is_editor());

-- reviews -------------------------------------------------------------------
drop policy if exists "reviewer reads own review"   on public.reviews;
drop policy if exists "editors read reviews"        on public.reviews;
drop policy if exists "authors read after decision" on public.reviews;
drop policy if exists "reviewer writes own review"  on public.reviews;

create policy "reviewer reads own review" on public.reviews
  for select using (reviewer_id = auth.uid());
create policy "editors read reviews" on public.reviews
  for select using (public.can_see_queue());
-- The author sees the reports only once a decision has been issued — never
-- while review is still in progress.
create policy "authors read after decision" on public.reviews
  for select using (exists (
    select 1 from public.manuscripts m
    where m.id = manuscript_id and m.author_id = auth.uid()
      and m.status in ('revision','accepted','declined')));
create policy "reviewer writes own review" on public.reviews
  for insert with check (reviewer_id = auth.uid() and exists (
    select 1 from public.review_assignments a
    where a.id = assignment_id and a.reviewer_id = auth.uid() and a.state = 'accepted'));

-- confidential notes — editors only, never the author
drop policy if exists "editors read notes"   on public.review_notes;
drop policy if exists "reviewer writes note" on public.review_notes;
create policy "editors read notes" on public.review_notes
  for select using (public.is_editor());
create policy "reviewer writes note" on public.review_notes
  for insert with check (exists (
    select 1 from public.reviews r where r.id = review_id and r.reviewer_id = auth.uid()));

-- decisions -----------------------------------------------------------------
drop policy if exists "authors read own decisions" on public.decisions;
drop policy if exists "editors read decisions"     on public.decisions;
drop policy if exists "faculty writes decisions"   on public.decisions;
create policy "authors read own decisions" on public.decisions
  for select using (exists (select 1 from public.manuscripts m
    where m.id = manuscript_id and m.author_id = auth.uid()));
create policy "editors read decisions" on public.decisions
  for select using (public.can_see_queue());
create policy "faculty writes decisions" on public.decisions
  for insert with check (public.can_decide() and editor_id = auth.uid());


-- ---------------------------------------------------------------------------
-- Table privileges. Coarse layer: which tables the API may touch at all.
-- RLS above is the fine layer: which rows. Both are required.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select, insert, update on public.profiles           to authenticated;
grant select, insert, update on public.manuscripts        to authenticated;
grant select, insert         on public.manuscript_files   to authenticated;
grant select                 on public.status_events      to authenticated;
grant select, insert, update on public.review_assignments to authenticated;
grant select, insert         on public.reviews            to authenticated;
grant select, insert         on public.review_notes       to authenticated;
grant select, insert         on public.decisions          to authenticated;

grant execute on function public.my_role()           to authenticated;
grant execute on function public.can_see_queue()     to authenticated;
grant execute on function public.is_editor()         to authenticated;
grant execute on function public.can_decide()        to authenticated;
grant execute on function public.can_manage_people() to authenticated;
grant execute on function public.is_chief()          to authenticated;
grant execute on function public.role_rank(text)     to authenticated;

-- If the project has "automatically expose new tables" switched on, Supabase
-- will already have granted these to anon. RLS reduces anon to zero rows
-- either way, but the privilege has no reason to exist.
revoke all on public.profiles           from anon;
revoke all on public.manuscripts        from anon;
revoke all on public.manuscript_files   from anon;
revoke all on public.status_events      from anon;
revoke all on public.review_assignments from anon;
revoke all on public.reviews            from anon;
revoke all on public.review_notes       from anon;
revoke all on public.decisions          from anon;


-- ---------------------------------------------------------------------------
-- Storage: private bucket for manuscript PDFs.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manuscripts', 'manuscripts', false, 26214400, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 26214400,
                               allowed_mime_types = array['application/pdf'];

drop policy if exists "upload own manuscript"    on storage.objects;
drop policy if exists "read own manuscript"      on storage.objects;
drop policy if exists "editors read manuscripts" on storage.objects;

create policy "upload own manuscript" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'manuscripts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "read own manuscript" on storage.objects
  for select to authenticated
  using (bucket_id = 'manuscripts' and (storage.foldername(name))[1] = auth.uid()::text);
-- Referees need the PDF as well, so this covers the queue-visible group plus
-- anyone holding a live assignment on that particular manuscript.
create policy "editors read manuscripts" on storage.objects
  for select to authenticated
  using (bucket_id = 'manuscripts' and (public.can_see_queue() or exists (
    select 1 from public.review_assignments a
    join public.manuscript_files f on f.manuscript_id = a.manuscript_id
    where f.storage_path = storage.objects.name and a.reviewer_id = auth.uid()
      and a.state in ('invited','accepted','submitted'))));


-- ---------------------------------------------------------------------------
-- The first chief editor can only be made here, because the application has
-- no path that lets anyone change their own role:
--
--   update public.profiles set role = 'chief_editor'
--   where email = 'you@example.com' returning email, role;
--
-- Everyone after that is appointed through the People tab in the portal.
-- ---------------------------------------------------------------------------
