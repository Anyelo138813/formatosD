create or replace function private.canonicalize_production_json(value jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare result jsonb;
begin
  case jsonb_typeof(value)
    when 'object' then
      select coalesce(jsonb_object_agg(key, private.canonicalize_production_json(val) order by key), '{}'::jsonb)
      into result from jsonb_each(value) as item(key, val);
    when 'array' then
      select coalesce(jsonb_agg(private.canonicalize_production_json(val) order by private.canonicalize_production_json(val)::text), '[]'::jsonb)
      into result from jsonb_array_elements(value) as item(val);
    when 'string' then
      result := coalesce(to_jsonb(nullif(btrim(value #>> '{}'), '')), 'null'::jsonb);
    when 'number' then
      result := to_jsonb((value #>> '{}')::numeric);
    when 'boolean' then result := value;
    else result := 'null'::jsonb;
  end case;
  return result;
end;
$$;

revoke all on function private.canonicalize_production_json(jsonb) from public, anon;
grant execute on function private.canonicalize_production_json(jsonb) to authenticated, service_role;

create or replace function private.prepare_production_staging_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.order_no := nullif(btrim(new.order_no), '');
  new.base_plan_number := nullif(btrim(new.base_plan_number), '');
  new.order_no_normalized := case when new.order_no is null then null else upper(new.order_no) end;
  new.base_plan_number_normalized := case when new.base_plan_number is null then null else upper(new.base_plan_number) end;
  new.canonical_data := private.canonicalize_production_json(new.canonical_data - 'schedules');
  new.row_fingerprint := encode(extensions.digest(convert_to(new.canonical_data::text, 'UTF8'), 'sha256'), 'hex');
  return new;
end;
$$;

revoke all on function private.prepare_production_staging_row() from public, anon, authenticated;

create trigger production_plan_staging_prepare
before insert or update of order_no, base_plan_number, canonical_data
on public.production_plan_staging_rows
for each row execute function private.prepare_production_staging_row();

create or replace function public.validate_production_plan_import(target_import_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  imp public.production_plan_imports%rowtype;
  actor uuid := auth.uid();
  blocking_count integer;
  rejected_rows integer;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into imp from public.production_plan_imports where id = target_import_id for update;
  if not found then raise exception 'Production Plan import not found'; end if;
  if not (select private.has_plant_role(imp.plant_id, array['admin','editor'])) then
    raise exception 'Active admin/editor membership required' using errcode = '42501';
  end if;
  if imp.status in ('applied','applying','cancelled') then
    raise exception 'Import status % cannot be validated', imp.status;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_import_id::text, 0));

  update public.production_plan_staging_rows s
  set canonical_data = private.canonicalize_production_json(
        (s.canonical_data - 'schedules') || jsonb_build_object('schedules', coalesce((
          select jsonb_agg(jsonb_build_object(
            'date', ss.schedule_date::text, 'shift', ss.shift, 'quantity', ss.quantity,
            'sourceColumn', nullif(btrim(ss.source_column), '')
          ) order by ss.schedule_date, ss.shift)
          from public.production_plan_staging_schedules ss where ss.staging_row_id = s.id
        ), '[]'::jsonb))
      ),
      row_fingerprint = encode(extensions.digest(convert_to(private.canonicalize_production_json(
        (s.canonical_data - 'schedules') || jsonb_build_object('schedules', coalesce((
          select jsonb_agg(jsonb_build_object(
            'date', ss.schedule_date::text, 'shift', ss.shift, 'quantity', ss.quantity,
            'sourceColumn', nullif(btrim(ss.source_column), '')
          ) order by ss.schedule_date, ss.shift)
          from public.production_plan_staging_schedules ss where ss.staging_row_id = s.id
        ), '[]'::jsonb))
      )::text, 'UTF8'), 'sha256'), 'hex'),
      updated_by = actor
  where s.import_id = target_import_id;

  update public.production_plan_staging_rows
  set row_kind = 'rejected',
      validation_errors = validation_errors || jsonb_build_array(jsonb_build_object('code','missing_identity','message','Order No. and Base plan number are required')),
      updated_by = actor
  where import_id = target_import_id and row_kind = 'data'
    and (order_no_normalized is null or base_plan_number_normalized is null);

  delete from public.production_plan_import_items where import_id = target_import_id;
  delete from public.production_plan_import_conflicts where import_id = target_import_id;

  insert into public.production_plan_import_conflicts
    (import_id, staging_row_id, conflict_type, severity, field_name, new_value, details)
  select target_import_id, s.id, 'missing_identity', 'blocking',
         case when s.base_plan_number_normalized is null then 'basePlanNumber' else 'orderNo' end,
         coalesce(to_jsonb(s.base_plan_number), to_jsonb(s.order_no)),
         jsonb_build_object('sourceRow', s.source_row_number)
  from public.production_plan_staging_rows s
  where s.import_id = target_import_id and s.row_kind = 'rejected';

  insert into public.production_plan_import_conflicts
    (import_id, staging_row_id, conflict_type, severity, field_name, new_value, details)
  select target_import_id, s.id, 'duplicate_base_plan', 'blocking', 'basePlanNumber',
         to_jsonb(s.base_plan_number), jsonb_build_object('occurrences', d.occurrences)
  from public.production_plan_staging_rows s
  join (
    select base_plan_number_normalized, count(*) occurrences
    from public.production_plan_staging_rows
    where import_id = target_import_id and row_kind = 'data'
    group by base_plan_number_normalized having count(*) > 1
  ) d using (base_plan_number_normalized)
  where s.import_id = target_import_id and s.row_kind = 'data';

  update public.production_plan_staging_rows s
  set matched_lot_id = l.id, updated_by = actor
  from public.production_plan_lots l
  where s.import_id = target_import_id and s.row_kind = 'data'
    and l.plant_id = imp.plant_id
    and l.base_plan_number_normalized = s.base_plan_number_normalized;

  insert into public.production_plan_import_conflicts
    (import_id, staging_row_id, lot_id, conflict_type, severity, field_name, old_value, new_value)
  select target_import_id, s.id, l.id, 'base_plan_reused_for_another_order', 'blocking', 'orderNo',
         to_jsonb(o.order_no), to_jsonb(s.order_no)
  from public.production_plan_staging_rows s
  join public.production_plan_lots l on l.id = s.matched_lot_id
  join public.production_orders o on o.id = l.order_id
  where s.import_id = target_import_id and o.order_no_normalized <> s.order_no_normalized;

  insert into public.production_plan_import_conflicts
    (import_id, staging_row_id, lot_id, conflict_type, severity, field_name, old_value, new_value)
  select target_import_id, s.id, l.id,
         case f.field_name
           when 'materialCode' then 'incompatible_material_change'
           when 'destination' then 'incompatible_destination_change'
           else 'incompatible_model_change'
         end,
         'blocking', f.field_name, v.canonical_data -> f.field_name, s.canonical_data -> f.field_name
  from public.production_plan_staging_rows s
  join public.production_plan_lots l on l.id = s.matched_lot_id
  join public.production_plan_lot_versions v on v.id = l.current_lot_version_id
  cross join (values ('materialCode'),('internalModel'),('customerModel'),('destination')) as f(field_name)
  where s.import_id = target_import_id
    and coalesce(v.canonical_data -> f.field_name, 'null'::jsonb) <> coalesce(s.canonical_data -> f.field_name, 'null'::jsonb)
    and coalesce(v.canonical_data ->> f.field_name, '') <> ''
    and coalesce(s.canonical_data ->> f.field_name, '') <> '';

  insert into public.production_plan_import_conflicts
    (import_id, staging_row_id, lot_id, conflict_type, severity, field_name, old_value, new_value)
  select distinct target_import_id, s.id, l.id, 'source_changed_under_manual_override', 'warning', a.field_name,
         v.canonical_data -> a.field_name, s.canonical_data -> a.field_name
  from public.production_plan_staging_rows s
  join public.production_plan_lots l on l.id = s.matched_lot_id
  join public.production_plan_lot_versions v on v.id = l.current_lot_version_id
  join public.production_plan_manual_adjustments a on a.lot_id = l.id and a.is_active
  where s.import_id = target_import_id
    and coalesce(v.canonical_data -> a.field_name, 'null'::jsonb) <> coalesce(s.canonical_data -> a.field_name, 'null'::jsonb);

  insert into public.production_plan_import_conflicts
    (import_id, staging_row_id, lot_id, conflict_type, severity, field_name, old_value, new_value, details)
  select target_import_id, s.id, old_lot.id, 'possible_base_plan_change', 'blocking', 'basePlanNumber',
         to_jsonb(old_lot.base_plan_number), to_jsonb(s.base_plan_number),
         jsonb_build_object('reason','An absent active lot and a new lot share stable business attributes')
  from public.production_plan_staging_rows s
  join public.production_orders old_order
    on old_order.plant_id = imp.plant_id and old_order.order_no_normalized = s.order_no_normalized
  join public.production_plan_lots old_lot on old_lot.order_id = old_order.id and old_lot.is_active
  join public.production_plan_lot_versions old_v on old_v.id = old_lot.current_lot_version_id
  where s.import_id = target_import_id and s.row_kind = 'data' and s.matched_lot_id is null
    and not exists (
      select 1 from public.production_plan_staging_rows present
      where present.import_id = target_import_id and present.row_kind = 'data'
        and present.base_plan_number_normalized = old_lot.base_plan_number_normalized
    )
    and coalesce(old_v.canonical_data ->> 'materialCode','') = coalesce(s.canonical_data ->> 'materialCode','')
    and coalesce(old_v.canonical_data ->> 'internalModel','') = coalesce(s.canonical_data ->> 'internalModel','')
    and coalesce(old_v.canonical_data ->> 'destination','') = coalesce(s.canonical_data ->> 'destination','')
    and coalesce(old_v.canonical_data ->> 'workOrderNo','') = coalesce(s.canonical_data ->> 'workOrderNo','');

  insert into public.production_plan_import_items
    (import_id, staging_row_id, classification, incoming_fingerprint, change_data)
  select target_import_id, s.id, 'rejected', s.row_fingerprint,
         jsonb_build_object('errors', s.validation_errors)
  from public.production_plan_staging_rows s
  where s.import_id = target_import_id and s.row_kind = 'rejected';

  insert into public.production_plan_import_items
    (import_id, staging_row_id, lot_id, classification, previous_fingerprint, incoming_fingerprint)
  select target_import_id, s.id, s.matched_lot_id,
         case
           when exists (select 1 from public.production_plan_import_conflicts c where c.import_id = target_import_id and c.staging_row_id = s.id and c.severity = 'blocking') then 'conflict'
           when s.matched_lot_id is null then 'new'
           when v.row_fingerprint = s.row_fingerprint then 'unchanged'
           else 'modified'
         end,
         v.row_fingerprint, s.row_fingerprint
  from public.production_plan_staging_rows s
  left join public.production_plan_lots l on l.id = s.matched_lot_id
  left join public.production_plan_lot_versions v on v.id = l.current_lot_version_id
  where s.import_id = target_import_id and s.row_kind = 'data';

  insert into public.production_plan_import_items
    (import_id, lot_id, classification, previous_fingerprint)
  select target_import_id, l.id, 'absent', v.row_fingerprint
  from public.production_plan_lots l
  join public.production_plan_lot_versions v on v.id = l.current_lot_version_id
  where l.plant_id = imp.plant_id and l.is_active
    and not exists (
      select 1 from public.production_plan_staging_rows s
      where s.import_id = target_import_id and s.row_kind = 'data'
        and s.base_plan_number_normalized = l.base_plan_number_normalized
    );

  select count(*) filter (where severity = 'blocking'),
         count(*) filter (where conflict_type = 'source_changed_under_manual_override')
  into blocking_count, imp.manual_adjustment_warning_count
  from public.production_plan_import_conflicts where import_id = target_import_id;
  select count(*) into rejected_rows from public.production_plan_staging_rows
  where import_id = target_import_id and row_kind = 'rejected';

  update public.production_plan_imports i set
    status = case when blocking_count = 0 and rejected_rows = 0 then 'ready' else 'invalid' end,
    source_row_count = (select count(*) from public.production_plan_staging_rows where import_id = target_import_id),
    data_row_count = (select count(*) from public.production_plan_staging_rows where import_id = target_import_id and row_kind = 'data'),
    auxiliary_row_count = (select count(*) from public.production_plan_staging_rows where import_id = target_import_id and row_kind = 'auxiliary'),
    blank_row_count = (select count(*) from public.production_plan_staging_rows where import_id = target_import_id and row_kind = 'blank'),
    new_count = (select count(*) from public.production_plan_import_items where import_id = target_import_id and classification = 'new'),
    modified_count = (select count(*) from public.production_plan_import_items where import_id = target_import_id and classification = 'modified'),
    unchanged_count = (select count(*) from public.production_plan_import_items where import_id = target_import_id and classification = 'unchanged'),
    absent_count = (select count(*) from public.production_plan_import_items where import_id = target_import_id and classification = 'absent'),
    rejected_count = rejected_rows,
    conflict_count = (select count(*) from public.production_plan_import_conflicts where import_id = target_import_id),
    blocking_conflict_count = blocking_count,
    manual_adjustment_warning_count = imp.manual_adjustment_warning_count,
    validated_at = now(), updated_by = actor,
    validation_summary = jsonb_build_object('fingerprintSchemaVersion',1,'validatedBy',actor)
  where i.id = target_import_id
  returning to_jsonb(i.*) into result;

  update public.source_file_versions sf set
    imported_count = (result ->> 'data_row_count')::integer,
    duplicate_count = (select count(distinct base_plan_number_normalized) from public.production_plan_staging_rows s
      where s.import_id = target_import_id and s.row_kind = 'data'
        and 1 < (select count(*) from public.production_plan_staging_rows x where x.import_id=s.import_id and x.row_kind='data' and x.base_plan_number_normalized=s.base_plan_number_normalized)),
    rejected_count = rejected_rows, updated_by = actor
  where sf.id = imp.source_file_version_id;

  return result;
end;
$$;

revoke all on function public.validate_production_plan_import(uuid) from public, anon;
grant execute on function public.validate_production_plan_import(uuid) to authenticated;

create or replace function public.apply_production_plan_import(target_import_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  imp public.production_plan_imports%rowtype;
  actor uuid := auth.uid();
  validation jsonb;
  applied_result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into imp from public.production_plan_imports where id = target_import_id for update;
  if not found then raise exception 'Production Plan import not found'; end if;
  if not (select private.has_plant_role(imp.plant_id, array['admin','editor'])) then
    raise exception 'Active admin/editor membership required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(imp.plant_id::text, 0));
  select * into imp from public.production_plan_imports where id = target_import_id for update;
  if imp.status = 'applied' then
    return jsonb_build_object('id',imp.id,'status','applied','alreadyApplied',true,'appliedAt',imp.applied_at);
  end if;
  if imp.status <> 'ready' then raise exception 'Import must be ready; current status is %', imp.status; end if;

  validation := public.validate_production_plan_import(target_import_id);
  select * into imp from public.production_plan_imports where id = target_import_id for update;
  if imp.status <> 'ready' or imp.blocking_conflict_count <> 0 or imp.rejected_count <> 0 then
    raise exception 'Import validation failed; previous version remains active';
  end if;

  update public.production_plan_imports set status='applying', updated_by=actor where id=target_import_id;

  insert into public.production_orders (plant_id, order_no, is_active, created_by, updated_by)
  select distinct imp.plant_id, s.order_no, true, actor, actor
  from public.production_plan_staging_rows s
  join public.production_plan_import_items item on item.staging_row_id=s.id and item.import_id=target_import_id
  where s.import_id=target_import_id and s.row_kind='data' and item.classification in ('new','modified','unchanged')
  on conflict (plant_id, order_no_normalized) do update set is_active=true, updated_by=actor;

  insert into public.production_plan_lots
    (plant_id, order_id, base_plan_number, first_seen_source_version_id, last_seen_source_version_id, is_active, created_by, updated_by)
  select imp.plant_id, o.id, s.base_plan_number, imp.source_file_version_id, imp.source_file_version_id, true, actor, actor
  from public.production_plan_staging_rows s
  join public.production_plan_import_items item on item.staging_row_id=s.id and item.import_id=target_import_id and item.classification='new'
  join public.production_orders o on o.plant_id=imp.plant_id and o.order_no_normalized=s.order_no_normalized
  where s.import_id=target_import_id
  on conflict (plant_id, base_plan_number_normalized) do nothing;

  update public.production_plan_staging_rows s set matched_lot_id=l.id, updated_by=actor
  from public.production_plan_lots l
  where s.import_id=target_import_id and s.row_kind='data' and l.plant_id=imp.plant_id
    and l.base_plan_number_normalized=s.base_plan_number_normalized;

  insert into public.production_plan_lot_versions
    (lot_id, plant_id, source_file_version_id, source_row_number, row_fingerprint, fingerprint_schema_version, canonical_data, source_data, created_by)
  select s.matched_lot_id, imp.plant_id, imp.source_file_version_id, s.source_row_number,
         s.row_fingerprint, 1, s.canonical_data, s.raw_data, actor
  from public.production_plan_staging_rows s
  join public.production_plan_import_items item on item.staging_row_id=s.id and item.import_id=target_import_id
  where s.import_id=target_import_id and s.row_kind='data' and item.classification in ('new','modified','unchanged')
  on conflict (lot_id, source_file_version_id) do nothing;

  insert into public.production_plan_schedule_values
    (lot_version_id, schedule_date, shift, quantity, source_column)
  select lv.id, ss.schedule_date, ss.shift, ss.quantity, ss.source_column
  from public.production_plan_staging_schedules ss
  join public.production_plan_staging_rows s on s.id=ss.staging_row_id and s.import_id=target_import_id
  join public.production_plan_lot_versions lv on lv.lot_id=s.matched_lot_id and lv.source_file_version_id=imp.source_file_version_id
  on conflict (lot_version_id, schedule_date, shift) do nothing;

  update public.production_plan_lots l set
    current_lot_version_id=lv.id, last_seen_source_version_id=imp.source_file_version_id,
    is_active=true, inactive_at=null, inactive_reason=null, updated_by=actor
  from public.production_plan_lot_versions lv
  where lv.source_file_version_id=imp.source_file_version_id and lv.lot_id=l.id;

  update public.production_plan_lots l set
    is_active=false, inactive_at=now(), inactive_reason='absent_in_source_version', updated_by=actor
  where l.plant_id=imp.plant_id and l.is_active
    and not exists (select 1 from public.production_plan_staging_rows s where s.import_id=target_import_id and s.row_kind='data' and s.matched_lot_id=l.id);

  update public.production_orders o set is_active=exists(select 1 from public.production_plan_lots l where l.order_id=o.id and l.is_active), updated_by=actor
  where o.plant_id=imp.plant_id;

  insert into public.production_plan_auxiliary_rows
    (plant_id, source_file_version_id, sheet_name, source_row_number, line, row_type, canonical_data, raw_data, row_fingerprint, created_by)
  select imp.plant_id, imp.source_file_version_id, s.sheet_name, s.source_row_number,
         s.canonical_data ->> 'line', s.auxiliary_type, s.canonical_data, s.raw_data, s.row_fingerprint, actor
  from public.production_plan_staging_rows s
  where s.import_id=target_import_id and s.row_kind='auxiliary'
  on conflict (source_file_version_id, sheet_name, source_row_number) do nothing;

  update public.source_file_versions set is_active=false, updated_by=actor
  where plant_id=imp.plant_id and resource_type='production_plan' and id<>imp.source_file_version_id and is_active;
  update public.source_file_versions set is_active=true, updated_by=actor,
    imported_count=imp.data_row_count, duplicate_count=0, rejected_count=0
  where id=imp.source_file_version_id;

  update public.production_plan_imports set status='applied', applied_at=now(), failure_message=null, updated_by=actor
  where id=target_import_id
  returning jsonb_build_object(
    'id',id,'status',status,'alreadyApplied',false,'appliedAt',applied_at,
    'new',new_count,'modified',modified_count,'unchanged',unchanged_count,
    'absent',absent_count,'rejected',rejected_count,'auxiliary',auxiliary_row_count
  ) into applied_result;
  return applied_result;
end;
$$;

revoke all on function public.apply_production_plan_import(uuid) from public, anon;
grant execute on function public.apply_production_plan_import(uuid) to authenticated;

create or replace view public.production_plan_effective
with (security_invoker = true)
as
select l.id as lot_id, l.plant_id, o.order_no, l.base_plan_number, l.is_active,
       lv.source_file_version_id, lv.row_fingerprint, lv.created_at as imported_at,
       lv.canonical_data as imported_data,
       lv.canonical_data || coalesce(adj.values, '{}'::jsonb) as effective_data,
       coalesce(adj.values, '{}'::jsonb) as manual_adjustments
from public.production_plan_lots l
join public.production_orders o on o.id=l.order_id
join public.production_plan_lot_versions lv on lv.id=l.current_lot_version_id
left join lateral (
  select jsonb_object_agg(a.field_name, a.adjusted_value) as values
  from public.production_plan_manual_adjustments a where a.lot_id=l.id and a.is_active
) adj on true;

alter table public.production_plan_imports enable row level security;
alter table public.production_orders enable row level security;
alter table public.production_plan_lots enable row level security;
alter table public.production_plan_staging_rows enable row level security;
alter table public.production_plan_staging_schedules enable row level security;
alter table public.production_plan_import_items enable row level security;
alter table public.production_plan_import_conflicts enable row level security;
alter table public.production_plan_lot_versions enable row level security;
alter table public.production_plan_schedule_values enable row level security;
alter table public.production_plan_auxiliary_rows enable row level security;
alter table public.production_plan_manual_adjustments enable row level security;

revoke all on table public.production_plan_imports, public.production_orders, public.production_plan_lots,
  public.production_plan_staging_rows, public.production_plan_staging_schedules, public.production_plan_import_items,
  public.production_plan_import_conflicts, public.production_plan_lot_versions, public.production_plan_schedule_values,
  public.production_plan_auxiliary_rows, public.production_plan_manual_adjustments, public.production_plan_effective
from anon, authenticated;

grant select on table public.production_orders, public.production_plan_lots, public.production_plan_lot_versions,
  public.production_plan_schedule_values, public.production_plan_auxiliary_rows, public.production_plan_manual_adjustments,
  public.production_plan_effective to authenticated;
grant select,insert,update on table public.production_plan_imports, public.production_plan_staging_rows,
  public.production_plan_staging_schedules to authenticated;
grant select,insert,delete on table public.production_plan_import_items, public.production_plan_import_conflicts to authenticated;
grant insert,update on table public.production_orders, public.production_plan_lots, public.production_plan_lot_versions,
  public.production_plan_schedule_values, public.production_plan_auxiliary_rows, public.production_plan_manual_adjustments to authenticated;

create policy production_orders_select_member on public.production_orders for select to authenticated
using ((select private.has_plant_role(plant_id,array['admin','editor','viewer'])));
create policy production_orders_write_editor on public.production_orders for all to authenticated
using ((select private.has_plant_role(plant_id,array['admin','editor'])))
with check ((select private.has_plant_role(plant_id,array['admin','editor'])) and updated_by=(select auth.uid()));
create policy production_lots_select_member on public.production_plan_lots for select to authenticated
using ((select private.has_plant_role(plant_id,array['admin','editor','viewer'])));
create policy production_lots_write_editor on public.production_plan_lots for all to authenticated
using ((select private.has_plant_role(plant_id,array['admin','editor'])))
with check ((select private.has_plant_role(plant_id,array['admin','editor'])) and updated_by=(select auth.uid()));
create policy production_imports_select_editor on public.production_plan_imports for select to authenticated
using ((select private.has_plant_role(plant_id,array['admin','editor'])));
create policy production_imports_insert_editor on public.production_plan_imports for insert to authenticated
with check ((select private.has_plant_role(plant_id,array['admin','editor'])) and created_by=(select auth.uid()));
create policy production_imports_update_editor on public.production_plan_imports for update to authenticated
using ((select private.has_plant_role(plant_id,array['admin','editor'])))
with check ((select private.has_plant_role(plant_id,array['admin','editor'])) and updated_by=(select auth.uid()));
create policy production_staging_select_editor on public.production_plan_staging_rows for select to authenticated
using ((select private.has_plant_role(plant_id,array['admin','editor'])));
create policy production_staging_insert_editor on public.production_plan_staging_rows for insert to authenticated
with check ((select private.has_plant_role(plant_id,array['admin','editor'])) and created_by=(select auth.uid()));
create policy production_staging_update_editor on public.production_plan_staging_rows for update to authenticated
using ((select private.has_plant_role(plant_id,array['admin','editor'])))
with check ((select private.has_plant_role(plant_id,array['admin','editor'])) and updated_by=(select auth.uid()));
create policy production_staging_schedules_editor on public.production_plan_staging_schedules for all to authenticated
using (exists(select 1 from public.production_plan_staging_rows s where s.id=staging_row_id and (select private.has_plant_role(s.plant_id,array['admin','editor']))))
with check (exists(select 1 from public.production_plan_staging_rows s where s.id=staging_row_id and (select private.has_plant_role(s.plant_id,array['admin','editor']))));
create policy production_items_editor on public.production_plan_import_items for all to authenticated
using (exists(select 1 from public.production_plan_imports i where i.id=import_id and (select private.has_plant_role(i.plant_id,array['admin','editor']))))
with check (exists(select 1 from public.production_plan_imports i where i.id=import_id and (select private.has_plant_role(i.plant_id,array['admin','editor']))));
create policy production_conflicts_editor on public.production_plan_import_conflicts for all to authenticated
using (exists(select 1 from public.production_plan_imports i where i.id=import_id and (select private.has_plant_role(i.plant_id,array['admin','editor']))))
with check (exists(select 1 from public.production_plan_imports i where i.id=import_id and (select private.has_plant_role(i.plant_id,array['admin','editor']))));
create policy production_lot_versions_select_member on public.production_plan_lot_versions for select to authenticated
using ((select private.has_plant_role(plant_id,array['admin','editor','viewer'])));
create policy production_lot_versions_insert_editor on public.production_plan_lot_versions for insert to authenticated
with check ((select private.has_plant_role(plant_id,array['admin','editor'])) and created_by=(select auth.uid()));
create policy production_schedules_select_member on public.production_plan_schedule_values for select to authenticated
using (exists(select 1 from public.production_plan_lot_versions v where v.id=lot_version_id and (select private.has_plant_role(v.plant_id,array['admin','editor','viewer']))));
create policy production_schedules_insert_editor on public.production_plan_schedule_values for insert to authenticated
with check (exists(select 1 from public.production_plan_lot_versions v where v.id=lot_version_id and (select private.has_plant_role(v.plant_id,array['admin','editor']))));
create policy production_auxiliary_select_member on public.production_plan_auxiliary_rows for select to authenticated
using ((select private.has_plant_role(plant_id,array['admin','editor','viewer'])));
create policy production_auxiliary_insert_editor on public.production_plan_auxiliary_rows for insert to authenticated
with check ((select private.has_plant_role(plant_id,array['admin','editor'])) and created_by=(select auth.uid()));
create policy production_adjustments_select_member on public.production_plan_manual_adjustments for select to authenticated
using ((select private.has_plant_role(plant_id,array['admin','editor','viewer'])));
create policy production_adjustments_insert_editor on public.production_plan_manual_adjustments for insert to authenticated
with check ((select private.has_plant_role(plant_id,array['admin','editor'])) and created_by=(select auth.uid()));
create policy production_adjustments_update_editor on public.production_plan_manual_adjustments for update to authenticated
using ((select private.has_plant_role(plant_id,array['admin','editor'])))
with check ((select private.has_plant_role(plant_id,array['admin','editor'])) and updated_by=(select auth.uid()));

do $$
declare table_name text;
begin
  foreach table_name in array array['production_plan_imports','production_orders','production_plan_lots','production_plan_staging_rows','production_plan_manual_adjustments'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.set_audit_fields()', table_name||'_set_audit_fields', table_name);
  end loop;
  foreach table_name in array array['production_plan_imports','production_orders','production_plan_lots','production_plan_manual_adjustments'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.capture_audit_event()', table_name||'_audit', table_name);
  end loop;
end $$;

notify pgrst, 'reload schema';
