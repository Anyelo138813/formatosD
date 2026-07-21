-- Stage 2 hardening: cover every Production Plan foreign key and avoid
-- overlapping SELECT policies reported by the Supabase advisors.

create index if not exists production_orders_created_by_idx
  on public.production_orders(created_by);
create index if not exists production_orders_updated_by_idx
  on public.production_orders(updated_by);

create index if not exists production_plan_auxiliary_created_by_idx
  on public.production_plan_auxiliary_rows(created_by);
create index if not exists production_plan_imports_created_by_idx
  on public.production_plan_imports(created_by);
create index if not exists production_plan_imports_updated_by_idx
  on public.production_plan_imports(updated_by);

create index if not exists production_plan_lot_versions_created_by_idx
  on public.production_plan_lot_versions(created_by);
create index if not exists production_plan_lot_versions_lot_plant_idx
  on public.production_plan_lot_versions(lot_id, plant_id);

create index if not exists production_plan_lots_created_by_idx
  on public.production_plan_lots(created_by);
create index if not exists production_plan_lots_updated_by_idx
  on public.production_plan_lots(updated_by);
create index if not exists production_plan_lots_current_version_lot_idx
  on public.production_plan_lots(current_lot_version_id, id);
create index if not exists production_plan_lots_order_plant_idx
  on public.production_plan_lots(order_id, plant_id);

create index if not exists production_plan_adjustments_created_by_idx
  on public.production_plan_manual_adjustments(created_by);
create index if not exists production_plan_adjustments_updated_by_idx
  on public.production_plan_manual_adjustments(updated_by);
create index if not exists production_plan_adjustments_lot_plant_idx
  on public.production_plan_manual_adjustments(lot_id, plant_id);

create index if not exists production_plan_staging_created_by_idx
  on public.production_plan_staging_rows(created_by);
create index if not exists production_plan_staging_updated_by_idx
  on public.production_plan_staging_rows(updated_by);
create index if not exists production_plan_staging_import_plant_idx
  on public.production_plan_staging_rows(import_id, plant_id);
create index if not exists production_plan_staging_matched_lot_plant_idx
  on public.production_plan_staging_rows(matched_lot_id, plant_id);

drop policy if exists production_orders_write_editor on public.production_orders;
create policy production_orders_insert_editor on public.production_orders
  for insert to authenticated
  with check (private.has_plant_role(plant_id, array['admin','editor']));
create policy production_orders_update_editor on public.production_orders
  for update to authenticated
  using (private.has_plant_role(plant_id, array['admin','editor']))
  with check (private.has_plant_role(plant_id, array['admin','editor']));

drop policy if exists production_lots_write_editor on public.production_plan_lots;
create policy production_lots_insert_editor on public.production_plan_lots
  for insert to authenticated
  with check (private.has_plant_role(plant_id, array['admin','editor']));
create policy production_lots_update_editor on public.production_plan_lots
  for update to authenticated
  using (private.has_plant_role(plant_id, array['admin','editor']))
  with check (private.has_plant_role(plant_id, array['admin','editor']));
