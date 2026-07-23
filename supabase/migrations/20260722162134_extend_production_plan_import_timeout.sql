alter function public.validate_production_plan_import(uuid)
set statement_timeout = '60s';

alter function public.apply_production_plan_import(uuid)
set statement_timeout = '60s';
