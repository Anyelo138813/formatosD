alter table public.plants
  add column if not exists timezone_name text not null default 'UTC'
  check (timezone_name in ('UTC', 'America/Tijuana'));

update public.plants set timezone_name = 'America/Tijuana' where code = 'MAIN';

alter table public.source_file_versions
  drop constraint if exists source_file_versions_resource_type_check,
  drop constraint if exists source_file_versions_plant_id_resource_type_sha256_key;

alter table public.source_file_versions
  add constraint source_file_versions_resource_type_check
  check (resource_type in ('employee_database', 'production_plan')),
  add column if not exists duplicate_of_version_id uuid
    references public.source_file_versions(id) on delete set null;

create unique index if not exists source_file_versions_employee_hash_uidx
  on public.source_file_versions (plant_id, resource_type, sha256)
  where resource_type = 'employee_database' and sha256 is not null;
create index if not exists source_file_versions_production_hash_idx
  on public.source_file_versions (plant_id, sha256)
  where resource_type = 'production_plan' and sha256 is not null;
create index if not exists source_file_versions_duplicate_of_idx
  on public.source_file_versions (duplicate_of_version_id);
drop index if exists public.source_file_versions_one_active_idx;
create unique index source_file_versions_one_active_idx
  on public.source_file_versions (plant_id, resource_type)
  where is_active;

create table public.production_plan_imports (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete restrict,
  source_file_version_id uuid not null unique references public.source_file_versions(id) on delete restrict,
  previous_active_version_id uuid references public.source_file_versions(id) on delete set null,
  status text not null default 'uploaded'
    check (status in ('uploaded','staging','invalid','ready','applying','applied','cancelled','failed')),
  source_row_count integer not null default 0 check (source_row_count >= 0),
  data_row_count integer not null default 0 check (data_row_count >= 0),
  auxiliary_row_count integer not null default 0 check (auxiliary_row_count >= 0),
  blank_row_count integer not null default 0 check (blank_row_count >= 0),
  new_count integer not null default 0 check (new_count >= 0),
  modified_count integer not null default 0 check (modified_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  absent_count integer not null default 0 check (absent_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  conflict_count integer not null default 0 check (conflict_count >= 0),
  blocking_conflict_count integer not null default 0 check (blocking_conflict_count >= 0),
  manual_adjustment_warning_count integer not null default 0 check (manual_adjustment_warning_count >= 0),
  fingerprint_schema_version smallint not null default 1 check (fingerprint_schema_version = 1),
  validation_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(validation_summary) = 'object'),
  cleanup_eligible_at timestamptz,
  validated_at timestamptz,
  applied_at timestamptz,
  cancelled_at timestamptz,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  unique (id, plant_id)
);

create table public.production_orders (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete restrict,
  order_no text not null check (btrim(order_no) <> ''),
  order_no_normalized text generated always as (upper(btrim(order_no))) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  unique (plant_id, order_no_normalized),
  unique (id, plant_id)
);

create table public.production_plan_lots (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete restrict,
  order_id uuid not null,
  base_plan_number text not null check (btrim(base_plan_number) <> ''),
  base_plan_number_normalized text generated always as (upper(btrim(base_plan_number))) stored,
  current_lot_version_id uuid,
  first_seen_source_version_id uuid not null references public.source_file_versions(id) on delete restrict,
  last_seen_source_version_id uuid not null references public.source_file_versions(id) on delete restrict,
  is_active boolean not null default true,
  inactive_at timestamptz,
  inactive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  foreign key (order_id, plant_id) references public.production_orders(id, plant_id) on delete restrict,
  unique (plant_id, base_plan_number_normalized),
  unique (id, plant_id)
);

create table public.production_plan_staging_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null,
  plant_id uuid not null,
  sheet_name text not null default 'Sheet1',
  source_row_number integer not null check (source_row_number > 0),
  row_kind text not null check (row_kind in ('data','auxiliary','blank','rejected')),
  auxiliary_type text check (auxiliary_type is null or auxiliary_type in ('allocation_quantity','transfer_hours','total_working_hours')),
  order_no text,
  order_no_normalized text,
  base_plan_number text,
  base_plan_number_normalized text,
  canonical_data jsonb not null default '{}'::jsonb check (jsonb_typeof(canonical_data) = 'object'),
  raw_data jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_data) = 'object'),
  row_fingerprint text check (row_fingerprint is null or row_fingerprint ~ '^[0-9a-f]{64}$'),
  validation_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_errors) = 'array'),
  validation_warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_warnings) = 'array'),
  matched_lot_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  foreign key (import_id, plant_id) references public.production_plan_imports(id, plant_id) on delete cascade,
  foreign key (matched_lot_id, plant_id) references public.production_plan_lots(id, plant_id) on delete set null,
  unique (import_id, sheet_name, source_row_number),
  unique (id, import_id)
);

create table public.production_plan_staging_schedules (
  id uuid primary key default gen_random_uuid(),
  staging_row_id uuid not null references public.production_plan_staging_rows(id) on delete cascade,
  schedule_date date not null,
  shift text not null check (shift in ('day','night')),
  quantity numeric not null check (quantity >= 0),
  source_column text,
  created_at timestamptz not null default now(),
  unique (staging_row_id, schedule_date, shift)
);

create table public.production_plan_import_items (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.production_plan_imports(id) on delete cascade,
  staging_row_id uuid references public.production_plan_staging_rows(id) on delete cascade,
  lot_id uuid references public.production_plan_lots(id) on delete cascade,
  classification text not null check (classification in ('new','modified','unchanged','absent','rejected','conflict')),
  previous_fingerprint text,
  incoming_fingerprint text,
  change_data jsonb not null default '{}'::jsonb check (jsonb_typeof(change_data) = 'object'),
  created_at timestamptz not null default now()
);

create table public.production_plan_import_conflicts (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.production_plan_imports(id) on delete cascade,
  staging_row_id uuid references public.production_plan_staging_rows(id) on delete cascade,
  lot_id uuid references public.production_plan_lots(id) on delete cascade,
  conflict_type text not null check (conflict_type in (
    'duplicate_base_plan','base_plan_reused_for_another_order','incompatible_material_change',
    'incompatible_model_change','incompatible_destination_change','possible_base_plan_change',
    'missing_identity','invalid_required_value','source_changed_under_manual_override'
  )),
  field_name text,
  severity text not null check (severity in ('blocking','warning')),
  old_value jsonb,
  new_value jsonb,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create table public.production_plan_lot_versions (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null,
  plant_id uuid not null,
  source_file_version_id uuid not null references public.source_file_versions(id) on delete restrict,
  source_row_number integer not null check (source_row_number > 0),
  row_fingerprint text not null check (row_fingerprint ~ '^[0-9a-f]{64}$'),
  fingerprint_schema_version smallint not null default 1 check (fingerprint_schema_version = 1),
  canonical_data jsonb not null check (jsonb_typeof(canonical_data) = 'object'),
  source_data jsonb not null default '{}'::jsonb check (jsonb_typeof(source_data) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  foreign key (lot_id, plant_id) references public.production_plan_lots(id, plant_id) on delete restrict,
  unique (lot_id, source_file_version_id),
  unique (id, lot_id)
);

alter table public.production_plan_lots
  add constraint production_plan_lots_current_version_fkey
  foreign key (current_lot_version_id, id)
  references public.production_plan_lot_versions(id, lot_id) on delete restrict;

create table public.production_plan_schedule_values (
  id uuid primary key default gen_random_uuid(),
  lot_version_id uuid not null references public.production_plan_lot_versions(id) on delete cascade,
  schedule_date date not null,
  shift text not null check (shift in ('day','night')),
  quantity numeric not null check (quantity >= 0),
  source_column text,
  created_at timestamptz not null default now(),
  unique (lot_version_id, schedule_date, shift)
);

create table public.production_plan_auxiliary_rows (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete restrict,
  source_file_version_id uuid not null references public.source_file_versions(id) on delete cascade,
  sheet_name text not null,
  source_row_number integer not null check (source_row_number > 0),
  line text,
  row_type text not null check (row_type in ('allocation_quantity','transfer_hours','total_working_hours')),
  canonical_data jsonb not null check (jsonb_typeof(canonical_data) = 'object'),
  raw_data jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_data) = 'object'),
  row_fingerprint text not null check (row_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (source_file_version_id, sheet_name, source_row_number)
);

create table public.production_plan_manual_adjustments (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete restrict,
  lot_id uuid not null,
  field_name text not null check (field_name in (
    'line','materialType','destination','brand','peDoc','orderQty','planQuantity','productionDate',
    'workOrderNo','plannedStartTime','plannedEndTime','orderRemarks','priority','productionStatus',
    'planningStatus','scheduleStatus','remark'
  )),
  adjusted_value jsonb not null,
  based_on_lot_version_id uuid references public.production_plan_lot_versions(id) on delete restrict,
  reason text not null check (btrim(reason) <> ''),
  is_active boolean not null default true,
  supersedes_adjustment_id uuid references public.production_plan_manual_adjustments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  foreign key (lot_id, plant_id) references public.production_plan_lots(id, plant_id) on delete cascade,
  check (
    (field_name in ('orderQty','planQuantity') and jsonb_typeof(adjusted_value) in ('number','null')) or
    (field_name = 'productionDate' and (jsonb_typeof(adjusted_value) = 'null' or (jsonb_typeof(adjusted_value) = 'string' and adjusted_value #>> '{}' ~ '^\\d{4}-\\d{2}-\\d{2}$'))) or
    (field_name not in ('orderQty','planQuantity','productionDate') and jsonb_typeof(adjusted_value) in ('string','null'))
  )
);

create unique index production_plan_adjustments_active_uidx
  on public.production_plan_manual_adjustments (lot_id, field_name) where is_active;

create index production_plan_imports_plant_status_idx on public.production_plan_imports (plant_id, status, created_at desc);
create index production_plan_imports_previous_active_idx on public.production_plan_imports (previous_active_version_id);
create index production_orders_plant_active_idx on public.production_orders (plant_id, is_active, order_no_normalized);
create index production_plan_lots_order_id_idx on public.production_plan_lots (order_id);
create index production_plan_lots_first_source_idx on public.production_plan_lots (first_seen_source_version_id);
create index production_plan_lots_last_source_idx on public.production_plan_lots (last_seen_source_version_id);
create index production_plan_lots_current_version_idx on public.production_plan_lots (current_lot_version_id);
create index production_plan_lots_active_idx on public.production_plan_lots (plant_id, base_plan_number_normalized) where is_active;
create index production_plan_staging_rows_import_base_idx on public.production_plan_staging_rows (import_id, base_plan_number_normalized) where row_kind = 'data';
create index production_plan_staging_rows_plant_idx on public.production_plan_staging_rows (plant_id);
create index production_plan_staging_rows_matched_lot_idx on public.production_plan_staging_rows (matched_lot_id);
create index production_plan_staging_schedules_row_idx on public.production_plan_staging_schedules (staging_row_id);
create index production_plan_import_items_import_class_idx on public.production_plan_import_items (import_id, classification);
create index production_plan_import_items_staging_idx on public.production_plan_import_items (staging_row_id);
create index production_plan_import_items_lot_idx on public.production_plan_import_items (lot_id);
create index production_plan_conflicts_import_severity_idx on public.production_plan_import_conflicts (import_id, severity);
create index production_plan_conflicts_staging_idx on public.production_plan_import_conflicts (staging_row_id);
create index production_plan_conflicts_lot_idx on public.production_plan_import_conflicts (lot_id);
create index production_plan_lot_versions_lot_idx on public.production_plan_lot_versions (lot_id, created_at desc);
create index production_plan_lot_versions_source_idx on public.production_plan_lot_versions (source_file_version_id);
create index production_plan_schedule_lot_version_idx on public.production_plan_schedule_values (lot_version_id);
create index production_plan_auxiliary_plant_idx on public.production_plan_auxiliary_rows (plant_id);
create index production_plan_auxiliary_source_idx on public.production_plan_auxiliary_rows (source_file_version_id);
create index production_plan_adjustments_plant_idx on public.production_plan_manual_adjustments (plant_id);
create index production_plan_adjustments_lot_idx on public.production_plan_manual_adjustments (lot_id);
create index production_plan_adjustments_based_on_idx on public.production_plan_manual_adjustments (based_on_lot_version_id);
create index production_plan_adjustments_supersedes_idx on public.production_plan_manual_adjustments (supersedes_adjustment_id);
