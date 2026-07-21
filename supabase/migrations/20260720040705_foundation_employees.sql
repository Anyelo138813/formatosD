create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table public.plants (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  default_plant_id uuid references public.plants(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create table public.plant_members (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  unique (plant_id, user_id)
);

create table public.source_file_versions (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete restrict,
  resource_type text not null check (resource_type in ('employee_database')),
  version integer not null check (version > 0),
  is_active boolean not null default false,
  storage_bucket text,
  storage_path text,
  original_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-fA-F]{64}$'),
  source_system text not null default 'supabase',
  external_id text,
  imported_count integer not null default 0 check (imported_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  source_data jsonb not null default '{}'::jsonb check (jsonb_typeof(source_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  unique (plant_id, resource_type, version),
  unique (plant_id, resource_type, sha256),
  check ((storage_bucket is null) = (storage_path is null))
);

create unique index source_file_versions_one_active_idx
  on public.source_file_versions (plant_id, resource_type)
  where is_active;

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete restrict,
  employee_number text not null check (btrim(employee_number) <> ''),
  full_name text not null check (btrim(full_name) <> ''),
  shift text,
  line text,
  area text,
  department text,
  position text,
  operation text,
  packing_category text,
  line_area text,
  is_active boolean not null default true,
  source_file_version_id uuid references public.source_file_versions(id) on delete set null,
  source_data jsonb not null default '{}'::jsonb check (jsonb_typeof(source_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  unique (plant_id, employee_number),
  unique (id, plant_id)
);

create table public.employee_skills (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete restrict,
  employee_id uuid not null,
  skill_key text not null check (btrim(skill_key) <> ''),
  skill_name text not null check (btrim(skill_name) <> ''),
  skill_value text,
  is_qualified boolean not null default false,
  source_data jsonb not null default '{}'::jsonb check (jsonb_typeof(source_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  foreign key (employee_id, plant_id) references public.employees(id, plant_id) on delete cascade,
  unique (employee_id, skill_key)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid references public.plants(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create index profiles_default_plant_id_idx on public.profiles (default_plant_id);
create index plant_members_user_id_idx on public.plant_members (user_id);
create index employees_plant_name_idx on public.employees (plant_id, full_name);
create index employees_source_file_version_id_idx on public.employees (source_file_version_id);
create index employee_skills_plant_id_idx on public.employee_skills (plant_id);
create index employee_skills_employee_id_idx on public.employee_skills (employee_id);
create index source_file_versions_plant_created_idx on public.source_file_versions (plant_id, created_at desc);
create index audit_events_plant_created_idx on public.audit_events (plant_id, created_at desc);
create index audit_events_record_idx on public.audit_events (table_name, record_id);

create or replace function private.set_audit_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, new.created_at);
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid(), new.created_by);
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by, old.updated_by);
  end if;
  return new;
end;
$$;

revoke all on function private.set_audit_fields() from public, anon, authenticated;

create or replace function private.has_plant_role(target_plant_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.plant_members pm
      where pm.plant_id = target_plant_id
        and pm.user_id = (select auth.uid())
        and pm.is_active
        and pm.role = any(allowed_roles)
    );
$$;

revoke all on function private.has_plant_role(uuid, text[]) from public, anon;
grant execute on function private.has_plant_role(uuid, text[]) to authenticated, service_role;

create or replace function private.can_access_source_file(object_name text, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.plant_members pm
      where pm.plant_id::text = split_part(object_name, '/', 1)
        and pm.user_id = (select auth.uid())
        and pm.is_active
        and pm.role = any(allowed_roles)
    );
$$;

revoke all on function private.can_access_source_file(text, text[]) from public, anon;
grant execute on function private.can_access_source_file(text, text[]) to authenticated, service_role;

create or replace function private.capture_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_before jsonb;
  row_after jsonb;
  target_plant uuid;
  target_record uuid;
  actor uuid := auth.uid();
begin
  row_before := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  row_after := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  target_plant := coalesce((row_after ->> 'plant_id')::uuid, (row_before ->> 'plant_id')::uuid);
  target_record := coalesce((row_after ->> 'id')::uuid, (row_before ->> 'id')::uuid);

  insert into public.audit_events (
    plant_id, actor_id, table_name, record_id, action, old_data, new_data,
    created_by, updated_by
  ) values (
    target_plant, actor, tg_table_name, target_record, tg_op, row_before, row_after,
    actor, actor
  );

  return coalesce(new, old);
end;
$$;

revoke all on function private.capture_audit_event() from public, anon, authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, created_by, updated_by)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.id,
    new.id
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'plants', 'profiles', 'plant_members', 'source_file_versions',
    'employees', 'employee_skills'
  ] loop
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function private.set_audit_fields()',
      table_name || '_set_audit_fields', table_name
    );
  end loop;
end;
$$;

create trigger source_file_versions_audit
after insert or update or delete on public.source_file_versions
for each row execute function private.capture_audit_event();

create trigger employees_audit
after insert or update or delete on public.employees
for each row execute function private.capture_audit_event();

create trigger employee_skills_audit
after insert or update or delete on public.employee_skills
for each row execute function private.capture_audit_event();

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

insert into public.plants (code, name)
values ('MAIN', 'Manufacturing Plant')
on conflict (code) do update set name = excluded.name;

alter table public.plants enable row level security;
alter table public.profiles enable row level security;
alter table public.plant_members enable row level security;
alter table public.source_file_versions enable row level security;
alter table public.employees enable row level security;
alter table public.employee_skills enable row level security;
alter table public.audit_events enable row level security;

revoke all on table public.plants, public.profiles, public.plant_members,
  public.source_file_versions, public.employees, public.employee_skills, public.audit_events
from anon, authenticated;

grant select on table public.plants, public.profiles, public.plant_members,
  public.source_file_versions, public.employees, public.employee_skills, public.audit_events
to authenticated;
grant update on table public.profiles, public.plants, public.plant_members,
  public.source_file_versions, public.employees, public.employee_skills
to authenticated;
grant insert on table public.plant_members, public.source_file_versions,
  public.employees, public.employee_skills
to authenticated;

create policy plants_select_member on public.plants
for select to authenticated
using ((select private.has_plant_role(id, array['admin', 'editor', 'viewer'])));

create policy plants_update_admin on public.plants
for update to authenticated
using ((select private.has_plant_role(id, array['admin'])))
with check ((select private.has_plant_role(id, array['admin'])) and updated_by = (select auth.uid()));

create policy profiles_select_own on public.profiles
for select to authenticated using (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()) and updated_by = (select auth.uid()));

create policy plant_members_select_member on public.plant_members
for select to authenticated
using ((select private.has_plant_role(plant_id, array['admin', 'editor', 'viewer'])));

create policy plant_members_insert_admin on public.plant_members
for insert to authenticated
with check ((select private.has_plant_role(plant_id, array['admin'])) and created_by = (select auth.uid()));

create policy plant_members_update_admin on public.plant_members
for update to authenticated
using ((select private.has_plant_role(plant_id, array['admin'])))
with check ((select private.has_plant_role(plant_id, array['admin'])) and updated_by = (select auth.uid()));

create policy source_file_versions_select_member on public.source_file_versions
for select to authenticated
using ((select private.has_plant_role(plant_id, array['admin', 'editor', 'viewer'])));

create policy source_file_versions_insert_editor on public.source_file_versions
for insert to authenticated
with check ((select private.has_plant_role(plant_id, array['admin', 'editor'])) and created_by = (select auth.uid()));

create policy source_file_versions_update_editor on public.source_file_versions
for update to authenticated
using ((select private.has_plant_role(plant_id, array['admin', 'editor'])))
with check ((select private.has_plant_role(plant_id, array['admin', 'editor'])) and updated_by = (select auth.uid()));

create policy employees_select_member on public.employees
for select to authenticated
using ((select private.has_plant_role(plant_id, array['admin', 'editor', 'viewer'])));

create policy employees_insert_editor on public.employees
for insert to authenticated
with check ((select private.has_plant_role(plant_id, array['admin', 'editor'])) and created_by = (select auth.uid()));

create policy employees_update_editor on public.employees
for update to authenticated
using ((select private.has_plant_role(plant_id, array['admin', 'editor'])))
with check ((select private.has_plant_role(plant_id, array['admin', 'editor'])) and updated_by = (select auth.uid()));

create policy employee_skills_select_member on public.employee_skills
for select to authenticated
using ((select private.has_plant_role(plant_id, array['admin', 'editor', 'viewer'])));

create policy employee_skills_insert_editor on public.employee_skills
for insert to authenticated
with check ((select private.has_plant_role(plant_id, array['admin', 'editor'])) and created_by = (select auth.uid()));

create policy employee_skills_update_editor on public.employee_skills
for update to authenticated
using ((select private.has_plant_role(plant_id, array['admin', 'editor'])))
with check ((select private.has_plant_role(plant_id, array['admin', 'editor'])) and updated_by = (select auth.uid()));

create policy audit_events_select_admin on public.audit_events
for select to authenticated
using ((select private.has_plant_role(plant_id, array['admin'])));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'source-files',
  'source-files',
  false,
  52428800,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy source_files_select_member on storage.objects
for select to authenticated
using (
  bucket_id = 'source-files'
  and (select private.can_access_source_file(name, array['admin', 'editor', 'viewer']))
);

create policy source_files_insert_editor on storage.objects
for insert to authenticated
with check (
  bucket_id = 'source-files'
  and (select private.can_access_source_file(name, array['admin', 'editor']))
);

create policy source_files_update_editor on storage.objects
for update to authenticated
using (
  bucket_id = 'source-files'
  and (select private.can_access_source_file(name, array['admin', 'editor']))
)
with check (
  bucket_id = 'source-files'
  and (select private.can_access_source_file(name, array['admin', 'editor']))
);

create policy source_files_delete_admin on storage.objects
for delete to authenticated
using (
  bucket_id = 'source-files'
  and (select private.can_access_source_file(name, array['admin']))
);
