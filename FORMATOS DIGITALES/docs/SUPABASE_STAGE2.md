# Etapa 2: Production Plan

## Alcance

Production Plan se importa como un archivo versionado. El archivo original se conserva en el bucket privado `source-files`, sus filas se cargan primero en staging y sólo una llamada transaccional a `apply_production_plan_import` modifica el plan activo.

La identidad estable es:

```text
plant_id + upper(btrim(base_plan_number))
```

Los guiones y el contenido interno de `Base plan number` no se alteran. `Order No.` sólo agrupa comercialmente.

## Migraciones

Aplicar en orden:

1. `20260720053000_production_plan_schema.sql`
2. `20260720053100_production_plan_api_rls.sql`
3. `20260720053200_production_plan_effective_lot_version.sql`
4. `20260720053300_production_plan_advisor_indexes.sql`

La primera migración configura `MAIN.timezone_name = 'America/Tijuana'` y crea el índice único parcial que permite una sola versión activa por `plant_id` y `resource_type`.

## Flujo de importación

1. El navegador calcula SHA-256 únicamente para detectar archivos repetidos y crear la relación `duplicate_of_version_id`. Este valor no se usa como `row_fingerprint`.
2. Se crea una versión inactiva en `source_file_versions`, marcada inicialmente como `uploadState: pending`.
3. Se crea `production_plan_imports` con fecha de limpieza futura.
4. El Excel se carga en `source-files` y luego se insertan filas y calendarios en staging.
5. PostgreSQL normaliza los valores visibles y calcula el fingerprint confiable.
6. `validate_production_plan_import` clasifica cada lote como `new`, `modified`, `unchanged`, `absent` o `rejected` y genera conflictos bloqueantes.
7. La página muestra el resumen. El usuario puede cancelar o aplicar.
8. `apply_production_plan_import` toma un advisory transaction lock por planta, vuelve a validar y aplica todo dentro de la misma transacción.

Una importación `applied` devuelve `alreadyApplied: true`; no crea una segunda versión de lotes. Un doble clic también se bloquea en la interfaz.

## Validaciones bloqueantes

- Base plan vacío.
- Base plan duplicado dentro del archivo.
- Base plan ya usado con otro Order No.
- Cambio incompatible de material, modelo o destino.
- Posible cambio de Base plan detectado por atributos equivalentes.
- Filas de datos rechazadas.

Las filas auxiliares se guardan en `production_plan_auxiliary_rows`; nunca se convierten en órdenes. Los lotes ausentes se marcan inactivos, sin borrarlos.

## Datos importados y ajustes manuales

`production_plan_lot_versions.imported_data` conserva cada versión importada. Los cambios de la página se guardan aparte en `production_plan_manual_adjustments`.

Sólo se aceptan estos campos manuales:

```text
line, materialCode, sku, internalModel, customerModel, materialType,
destination, brand, peDoc, orderQty, planQuantity, productionDate,
workOrderNo, plannedStartTime, plannedEndTime
```

La restricción SQL valida que cantidades sean números, fechas sean cadenas ISO y los demás campos sean cadenas o `null`. La vista `production_plan_effective` tiene `security_invoker = true` y combina importación + ajuste sin que una nueva carga sobrescriba silenciosamente el ajuste.

## Seguridad

- Todas las tablas expuestas tienen RLS.
- Lectura: miembros activos de la planta.
- Escritura/importación: miembros activos `admin` o `editor`.
- Los RPC son `SECURITY INVOKER`, tienen `search_path` vacío y validan `auth.uid()` y la membresía.
- `anon` y `PUBLIC` no tienen permiso de ejecución sobre los RPC.
- El bucket `source-files` continúa privado.
- El frontend sólo consume `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` desde `env.js`; nunca usa `service_role`.

## Respaldo y operación offline

Google Drive, Google Apps Script e IndexedDB no fueron retirados. Si Supabase no responde, la aplicación conserva el Excel activo en IndexedDB y usa el mismo flujo de respaldo existente. Los uploads no aplicados quedan con `cleanup_eligible_at`; esta etapa no los elimina automáticamente.

## Operación en la página

En **Production Plan** seleccione o arrastre un Excel. La página analiza primero el archivo y muestra el resumen. **Aplicar versión** sólo se habilita cuando el estado es `ready` y no hay conflictos bloqueantes. **Cancelar** conserva el archivo/versionado para auditoría y limpieza posterior.

