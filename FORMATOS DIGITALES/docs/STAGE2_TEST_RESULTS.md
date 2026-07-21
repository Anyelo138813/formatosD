# Resultados de pruebas — Etapa 2

Fecha: 2026-07-19

## Excel actual

- Filas de lote: 372
- Filas auxiliares: 51
- Filas rechazadas: 0
- Base plan únicos: 372
- Total de filas clasificadas: 423

La simulación histórica seguida de la versión reciente equivalente produjo: 372 `unchanged`, 0 `new`, 0 `modified`, 0 `absent`.

## Database y transacciones

| Prueba | Resultado |
|---|---|
| Primera versión sintética (372 lotes) | 372 new; aplicada |
| Versión reciente equivalente | 372 unchanged; 0 new/modified/absent |
| Lote nuevo | Detectado y aplicado |
| Lote modificado | Detectado y versionado |
| Lote ausente | Marcado inactivo; no eliminado |
| Base plan duplicado | Conflicto bloqueante; no aplicado |
| Base plan reutilizado con otra orden | Conflicto bloqueante; no aplicado |
| Doble aplicación | Segunda llamada devolvió `alreadyApplied: true` |
| Importación concurrente | Serializada por advisory transaction lock |
| Error forzado dentro de la transacción | Rollback completo |
| Conservación de versión activa tras error | Correcta |
| Campo manual no permitido | Rechazado por constraint |
| Tipo manual inválido | Rechazado por constraint |

Las plantas, versiones y datos sintéticos creados por las pruebas se eliminaron al finalizar.

## RLS y navegador

- `anon` no puede seleccionar lotes: bloqueado.
- `anon` no puede ejecutar los RPC: permiso revocado.
- Usuario autenticado sin membresía: ve cero filas y no puede validar/aplicar imports ajenos.
- Todas las tablas `production_plan_*` expuestas tienen RLS y políticas.
- `production_plan_effective` usa `security_invoker=true`.
- El navegador cargó sin errores y el parser obtuvo 372/51/0.
- Con Supabase inaccesible, Employees volvió a `employees.xlsx` y Production Plan volvió a `production-plan.xlsx` mediante el respaldo local/IndexedDB.

## Security Advisor

No reportó vulnerabilidades nuevas de las tablas o funciones de Production Plan. Permanece una advertencia de proyecto: **Leaked Password Protection Disabled**, que se corrige en Supabase Dashboard > Authentication > Security.

Los avisos iniciales de foreign keys sin índice y políticas SELECT superpuestas de Production Plan fueron corregidos en `20260720053300_production_plan_advisor_indexes.sql`.

## Incidente de primera carga — 2026-07-20

La primera carga real creó correctamente la versión `b5c13120-fa71-4695-8216-0e031178a77b` y la importación `ff3ab441-03a1-4227-a196-bdc3e677916e`. Storage respondió 200, staging insertó 423 filas y 833 calendarios, y la validación devolvió 372 `new`, 51 auxiliares y cero conflictos.

El fallo visible ocurrió en la consulta posterior de la vista previa. PostgREST respondió HTTP 300 porque `production_plan_imports` tiene dos relaciones hacia `source_file_versions` y el embed no especificaba cuál usar. Se corrigió la consulta con el hint `production_plan_imports_source_file_version_id_fkey`.

La aplicación ahora restaura imports pendientes al recargar y, si se vuelve a seleccionar el mismo archivo mientras su import está `uploaded`, `staging`, `invalid` o `ready`, retoma esa evidencia en vez de crear otra versión.

La importación real se aplicó dentro de una transacción de prueba y luego se revirtió: produjo 372 lotes activos y una versión activa; la segunda aplicación fue idempotente. Después del rollback quedaron, como se esperaba, cero lotes, cero versiones activas, una versión inactiva, un objeto privado y la importación original en estado `ready`.
