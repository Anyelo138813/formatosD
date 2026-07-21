create or replace view public.production_plan_effective
with (security_invoker = true)
as
select l.id as lot_id, l.plant_id, o.order_no, l.base_plan_number, l.is_active,
       lv.source_file_version_id, lv.row_fingerprint, lv.created_at as imported_at,
       lv.canonical_data as imported_data,
       lv.canonical_data || coalesce(adj.values, '{}'::jsonb) as effective_data,
       coalesce(adj.values, '{}'::jsonb) as manual_adjustments,
       lv.id as lot_version_id
from public.production_plan_lots l
join public.production_orders o on o.id=l.order_id
join public.production_plan_lot_versions lv on lv.id=l.current_lot_version_id
left join lateral (
  select jsonb_object_agg(a.field_name, a.adjusted_value) as values
  from public.production_plan_manual_adjustments a where a.lot_id=l.id and a.is_active
) adj on true;

revoke all on table public.production_plan_effective from anon, authenticated;
grant select on table public.production_plan_effective to authenticated;
notify pgrst, 'reload schema';
