# Resultados de pruebas · Etapa 1

Fecha: 2026-07-19 (America/Mexico_City)

## Importación

- Filas fuente: 650
- Empleados importados: 646
- Duplicados en el Excel por `employee_number`: 0
- Rechazados: 4 (sin número o sin nombre)
- Habilidades no vacías importadas: 553
- Grupos duplicados en Supabase después de importar: 0
- SHA-256: `b152b6200f0bf5cf1e20e6ea8f5d1b5c75e9af30e10bd697e4d33ab6dcfa469c`

## Base de datos y seguridad

- Migraciones remotas aplicadas: `foundation_employees`, `employee_fk_indexes`
- Siete tablas creadas con RLS activo.
- Bucket `source-files`: privado, límite 50 MiB, MIME de Excel restringido.
- Security Advisor: 0 hallazgos.
- Usuario autenticado sin membresía: 0 filas visibles.
- Usuario temporal con rol `editor`: lectura de 646 filas, creación y edición autorizadas.
- La prueba de usuario temporal se ejecutó dentro de una transacción y se revirtió.

## CRUD y persistencia

- Creación de empleado temporal: correcta.
- Lectura posterior en una llamada separada: correcta.
- Edición: correcta; `updated_at` cambió y `created_at` se conservó.
- Limpieza del registro temporal: correcta.
- Upsert de dos filas con la misma clave: 1 registro final.
- Auditoría creada para importaciones y cambios.

## Fallback y navegador

- Smoke test en Chrome headless: correcto.
- Sin `env.js` y con Google Drive seleccionado contra una URL deliberadamente inaccesible, la aplicación cargó 646 empleados desde IndexedDB/`employees.xlsx`.
- Estado mostrado: `Active · v1`.
- Importación de módulos: correcta.
- Errores no controlados: 0.

Ejecutar nuevamente:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\browser-smoke-test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\browser-smoke-test.ps1 -DriveFallback
```

La verificación inicial con identidades transaccionales fue complementada después con el usuario Auth real indicado en la sección siguiente.

## Activación final con usuario real

- Usuario Auth: `l22211384@tectijuana.edu.mx`.
- Planta/rol: `MAIN` / `admin`.
- Sesión real, lectura de 646 empleados, búsqueda y filtros: correctos.
- Empleado temporal: creado, editado, persistió después de recargar, fue desactivado y finalmente eliminado físicamente.
- Registros `ACTIVATION-*` restantes: 0.
- Empleados finales: 646 activos y 646 números distintos.
- `employees.xlsx` subido mediante la sesión autenticada: 1 objeto privado, 121,079 bytes.
- Usuario autorizado: 646 empleados y 1 archivo visibles mediante RLS.
- Usuario anónimo: Employees `401`; descarga de Storage denegada.
- Supabase inaccesible: fallback correcto a `employees.xlsx`/IndexedDB con 646 empleados.
- Google/Apps Script inaccesible: fallback correcto; `GoogleDriveService` y `Code.gs` permanecen disponibles.
- Versiones fuente: v1 (seed inicial, inactiva) y v2 (archivo autenticado en Storage, activa). No hay empleados duplicados; los 646 apuntan a v2.
- Security Advisor: RLS sin hallazgos; advertencia de Auth porque **Leaked Password Protection** está desactivada.
