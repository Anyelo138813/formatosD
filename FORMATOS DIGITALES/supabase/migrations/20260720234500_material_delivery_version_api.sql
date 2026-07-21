create or replace function public.save_material_delivery_version(
  target_report_id uuid,
  target_form_data jsonb,
  target_status text default 'completed',
  target_change_summary text default 'ActualizaciÃ³n del reporte'
)
returns table (report_id uuid, report_number text, version integer, status text, updated_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_report public.material_delivery_reports%rowtype;
  next_version integer;
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;
  if jsonb_typeof(target_form_data) is distinct from 'object' then
    raise exception 'Form data must be a JSON object';
  end if;
  if target_status not in ('draft', 'completed', 'cancelled') then
    raise exception 'Invalid report status';
  end if;

  select * into current_report
  from public.material_delivery_reports report
  where report.id = target_report_id
  for update;

  if not found then
    raise exception 'Material Delivery report not found or inaccessible';
  end if;
  if not (select private.has_plant_role(current_report.plant_id, array['admin', 'editor'])) then
    raise exception 'Insufficient permissions';
  end if;

  next_version := current_report.current_version + 1;

  insert into public.material_delivery_report_versions (
    plant_id, report_id, version, form_data, change_summary, created_by, updated_by
  ) values (
    current_report.plant_id, current_report.id, next_version, target_form_data,
    nullif(btrim(target_change_summary), ''), actor, actor
  );

  update public.material_delivery_reports report
  set status = target_status,
      rolling = nullif(btrim(target_form_data ->> 'rolling'), ''),
      internal_model = nullif(btrim(target_form_data ->> 'internalModel'), ''),
      customer_model = nullif(btrim(target_form_data ->> 'customerModel'), ''),
      line = nullif(btrim(target_form_data ->> 'line'), ''),
      trial_date = nullif(target_form_data ->> 'date', '')::date,
      current_version = next_version,
      form_data = target_form_data,
      updated_by = actor
  where report.id = current_report.id;

  return query
  select report.id, report.report_number, report.current_version, report.status, report.updated_at
  from public.material_delivery_reports report
  where report.id = current_report.id;
end;
$$;

revoke all on function public.save_material_delivery_version(uuid, jsonb, text, text)
from public, anon;
grant execute on function public.save_material_delivery_version(uuid, jsonb, text, text)
to authenticated;
