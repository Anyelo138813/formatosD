create table public.material_delivery_reports (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete restrict,
  report_number text not null,
  status text not null default 'draft' check (status in ('draft', 'completed', 'cancelled')),
  rolling text,
  internal_model text,
  customer_model text,
  line text,
  trial_date date,
  current_version integer not null default 1 check (current_version > 0),
  form_data jsonb not null default '{}'::jsonb check (jsonb_typeof(form_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  unique (plant_id, report_number),
  unique (id, plant_id)
);

create table public.material_delivery_report_versions (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete restrict,
  report_id uuid not null,
  version integer not null check (version > 0),
  form_data jsonb not null check (jsonb_typeof(form_data) = 'object'),
  change_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  foreign key (report_id, plant_id) references public.material_delivery_reports(id, plant_id) on delete cascade,
  unique (report_id, version),
  unique (report_id, version, plant_id)
);

create table public.material_delivery_files (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete restrict,
  report_id uuid not null,
  report_version integer not null check (report_version > 0),
  file_kind text not null check (file_kind in ('xlsx', 'pdf')),
  storage_bucket text not null default 'report-files',
  storage_path text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  foreign key (report_id, report_version, plant_id)
    references public.material_delivery_report_versions(report_id, version, plant_id) on delete cascade,
  unique (report_id, report_version, file_kind)
);

create index material_delivery_reports_plant_updated_idx
  on public.material_delivery_reports (plant_id, updated_at desc);
create index material_delivery_reports_plant_rolling_idx
  on public.material_delivery_reports (plant_id, rolling) where rolling is not null;
create index material_delivery_reports_created_by_idx
  on public.material_delivery_reports (created_by);
create index material_delivery_reports_updated_by_idx
  on public.material_delivery_reports (updated_by);
create index material_delivery_versions_plant_idx
  on public.material_delivery_report_versions (plant_id, created_at desc);
create index material_delivery_versions_report_idx
  on public.material_delivery_report_versions (report_id, version desc);
create index material_delivery_versions_report_plant_idx
  on public.material_delivery_report_versions (report_id, plant_id);
create index material_delivery_versions_created_by_idx
  on public.material_delivery_report_versions (created_by);
create index material_delivery_versions_updated_by_idx
  on public.material_delivery_report_versions (updated_by);
create index material_delivery_files_plant_idx
  on public.material_delivery_files (plant_id, created_at desc);
create index material_delivery_files_report_idx
  on public.material_delivery_files (report_id, report_version);
create index material_delivery_files_version_plant_idx
  on public.material_delivery_files (report_id, report_version, plant_id);
create index material_delivery_files_created_by_idx
  on public.material_delivery_files (created_by);
create index material_delivery_files_updated_by_idx
  on public.material_delivery_files (updated_by);

create trigger material_delivery_reports_set_audit_fields
before insert or update on public.material_delivery_reports
for each row execute function private.set_audit_fields();

create trigger material_delivery_versions_set_audit_fields
before insert or update on public.material_delivery_report_versions
for each row execute function private.set_audit_fields();

create trigger material_delivery_files_set_audit_fields
before insert or update on public.material_delivery_files
for each row execute function private.set_audit_fields();

create trigger material_delivery_reports_audit
after insert or update or delete on public.material_delivery_reports
for each row execute function private.capture_audit_event();

create trigger material_delivery_versions_audit
after insert or update or delete on public.material_delivery_report_versions
for each row execute function private.capture_audit_event();

create trigger material_delivery_files_audit
after insert or update or delete on public.material_delivery_files
for each row execute function private.capture_audit_event();

alter table public.material_delivery_reports enable row level security;
alter table public.material_delivery_report_versions enable row level security;
alter table public.material_delivery_files enable row level security;

revoke all on table public.material_delivery_reports,
  public.material_delivery_report_versions, public.material_delivery_files
from public, anon, authenticated;

grant select on table public.material_delivery_reports,
  public.material_delivery_report_versions, public.material_delivery_files
to authenticated;
grant insert, update on table public.material_delivery_reports,
  public.material_delivery_report_versions, public.material_delivery_files
to authenticated;

create policy material_delivery_reports_select_member on public.material_delivery_reports
for select to authenticated
using ((select private.has_plant_role(plant_id, array['admin', 'editor', 'viewer'])));

create policy material_delivery_reports_insert_editor on public.material_delivery_reports
for insert to authenticated
with check (
  (select private.has_plant_role(plant_id, array['admin', 'editor']))
  and created_by = (select auth.uid())
);

create policy material_delivery_reports_update_editor on public.material_delivery_reports
for update to authenticated
using ((select private.has_plant_role(plant_id, array['admin', 'editor'])))
with check (
  (select private.has_plant_role(plant_id, array['admin', 'editor']))
  and updated_by = (select auth.uid())
);

create policy material_delivery_versions_select_member on public.material_delivery_report_versions
for select to authenticated
using ((select private.has_plant_role(plant_id, array['admin', 'editor', 'viewer'])));

create policy material_delivery_versions_insert_editor on public.material_delivery_report_versions
for insert to authenticated
with check (
  (select private.has_plant_role(plant_id, array['admin', 'editor']))
  and created_by = (select auth.uid())
);

create policy material_delivery_versions_update_editor on public.material_delivery_report_versions
for update to authenticated
using ((select private.has_plant_role(plant_id, array['admin', 'editor'])))
with check (
  (select private.has_plant_role(plant_id, array['admin', 'editor']))
  and updated_by = (select auth.uid())
);

create policy material_delivery_files_select_member on public.material_delivery_files
for select to authenticated
using ((select private.has_plant_role(plant_id, array['admin', 'editor', 'viewer'])));

create policy material_delivery_files_insert_editor on public.material_delivery_files
for insert to authenticated
with check (
  (select private.has_plant_role(plant_id, array['admin', 'editor']))
  and created_by = (select auth.uid())
);

create policy material_delivery_files_update_editor on public.material_delivery_files
for update to authenticated
using ((select private.has_plant_role(plant_id, array['admin', 'editor'])))
with check (
  (select private.has_plant_role(plant_id, array['admin', 'editor']))
  and updated_by = (select auth.uid())
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-files',
  'report-files',
  false,
  52428800,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf',
    'application/octet-stream'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy report_files_select_member on storage.objects
for select to authenticated
using (
  bucket_id = 'report-files'
  and (select private.can_access_source_file(name, array['admin', 'editor', 'viewer']))
);

create policy report_files_insert_editor on storage.objects
for insert to authenticated
with check (
  bucket_id = 'report-files'
  and (select private.can_access_source_file(name, array['admin', 'editor']))
);

create policy report_files_update_editor on storage.objects
for update to authenticated
using (
  bucket_id = 'report-files'
  and (select private.can_access_source_file(name, array['admin', 'editor']))
)
with check (
  bucket_id = 'report-files'
  and (select private.can_access_source_file(name, array['admin', 'editor']))
);

create policy report_files_delete_admin on storage.objects
for delete to authenticated
using (
  bucket_id = 'report-files'
  and (select private.can_access_source_file(name, array['admin']))
);
