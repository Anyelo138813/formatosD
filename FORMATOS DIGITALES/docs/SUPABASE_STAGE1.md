# Etapa 1: Fundación Supabase y Employee Database

Esta etapa mantiene Google Drive, Apps Script e IndexedDB. Supabase se intenta primero sólo para Employees cuando las variables están configuradas y existe una sesión Auth válida. Si no está disponible, la aplicación usa la copia de IndexedDB y después el proveedor actual (Drive o archivo incluido).

## Estructura creada

- `plants`, `profiles`, `plant_members`
- `employees`, `employee_skills`
- `source_file_versions`, `audit_events`
- bucket privado `source-files` (50 MiB; Excel solamente)
- RLS para roles `admin`, `editor` y `viewer`
- auditoría automática y campos `created_at`, `updated_at`, `created_by`, `updated_by`

Las migraciones reproducibles están en `supabase/migrations/` y el lote idempotente de empleados está en `supabase/seed.sql`.

## Configuración en Supabase Dashboard

1. Abre el proyecto `hmnnsjaaobgzzbmhcaui`.
2. En **Project Settings → API**, copia la Project URL y una clave moderna `sb_publishable_...`. No uses ni copies `service_role` al navegador.
3. En **Authentication → Users**, crea el primer usuario con correo y contraseña.
4. En **SQL Editor**, asigna ese usuario como administrador de la planta inicial, cambiando el correo:

```sql
insert into public.plant_members (plant_id, user_id, role, created_by, updated_by)
select p.id, u.id, 'admin', u.id, u.id
from public.plants p
join auth.users u on u.email = 'TU_CORREO@EMPRESA.COM'
where p.code = 'MAIN'
on conflict (plant_id, user_id) do update
set role = 'admin', is_active = true, updated_by = excluded.updated_by;

update public.profiles profile
set default_plant_id = plant.id, updated_by = profile.id
from public.plants plant, auth.users app_user
where plant.code = 'MAIN'
  and app_user.email = 'TU_CORREO@EMPRESA.COM'
  and profile.id = app_user.id;
```

5. Confirma en **Storage** que `source-files` aparece como privado. Sus rutas deben iniciar con el UUID de la planta: `<plant_id>/employee-database/<archivo>`.
6. En **Authentication → URL Configuration**, agrega la URL donde publicarás la aplicación y la URL local que utilices.

## Variables y ejecución local

```powershell
Copy-Item .env.example .env
# Edita .env y agrega SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\generate-runtime-env.ps1
.\local-server.ps1
```

`env.js` se genera localmente, está ignorado por Git y el Service Worker nunca lo guarda en caché. La clave publicable puede vivir en el cliente porque la protección real la proporcionan Auth y RLS; la clave `service_role` nunca debe usarse aquí.

Abre la página, entra a **Settings → Supabase Auth** e inicia sesión. La contraseña no se guarda en `localStorage`. Al cargar o reemplazar Employee Database, la aplicación conserva la copia Drive/IndexedDB y además intenta subir el Excel a `source-files` e importar Employees a Supabase.

## Reproducir la base

Con Supabase CLI instalado:

```powershell
supabase login
supabase link --project-ref hmnnsjaaobgzzbmhcaui
supabase db push
```

Para regenerar el lote desde el Excel actual:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-employees-seed.ps1
```

En una base nueva, `supabase db reset` aplica migraciones y `supabase/seed.sql`. En el proyecto conectado la migración y el lote ya fueron aplicados; no es necesario pegarlos nuevamente en SQL Editor.

## Operaciones disponibles

`SupabaseDataService` implementa:

- `getEmployees(filters)`
- `createEmployee(employee)`
- `updateEmployee(id, changes)`
- `importEmployeeDatabase(file, parsed)`
- `signIn(email, password)` y `signOut()`

Las mutaciones que fallan conservan una copia optimista y una cola en IndexedDB. `syncPending()` reintenta esa cola y también conserva la sincronización actual de Drive.

## Límites de esta etapa

Production Plan, Material Delivery, Model Change, firmas, PDF y demás reportes no se migraron. El archivo Excel fuente inicial todavía debe subirse físicamente al bucket después de crear el primer usuario Auth; sus 646 registros y metadatos de versión sí están cargados en Database.
