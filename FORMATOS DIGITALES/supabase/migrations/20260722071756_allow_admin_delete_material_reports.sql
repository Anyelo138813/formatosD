grant delete on table public.material_delivery_reports to authenticated;

create policy material_delivery_reports_delete_admin
on public.material_delivery_reports
for delete
to authenticated
using ((select private.has_plant_role(plant_id, array['admin'])));
