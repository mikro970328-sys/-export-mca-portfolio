# Aceptación de operadores y concurrencia

Fecha: 2026-09-09. Base: `95e352e0d466ca8392adef89e8e4897d19cf2da3`.

Publicado mediante [PR #287](https://github.com/mikro970328-sys/-export-mca-portfolio/pull/287), commit `81648443ce66eda2ce4ed2e331146ad631ae751e`; producción `dpl_6bf5Vba4JxrwFsDxrSCxgqfnptUb` READY. Esta entrega añade aceptación automatizada; no cambia reglas comerciales ni aplica migraciones a producción.

## Método

Esta matriz amplía compras, ventas/logística y finanzas con conexiones PostgreSQL independientes y los handlers originales de Vercel sobre HTTP contra PostgREST real. No sustituye la autenticación, permisos, consultas, transacciones ni auditoría por respuestas simuladas.

El workflow `Operator and Concurrency Acceptance` levanta PostgreSQL 17.6 (misma versión observada en producción) y PostgREST 12.2.3 en contenedores desechables. Las credenciales de prueba solo sirven allí; las contraseñas de las cuentas y el secreto administrativo se generan en memoria. No se usan secretos del repositorio ni datos comerciales productivos. El script rechaza bases remotas, nombres ajenos a `erp_operator_qa` y bases con objetos públicos preexistentes.

Se reutilizan los 85 archivos de migración del bloque financiero y se añaden seis de acceso/sesión/sincronización: 91 archivos, con el mismo límite financiero de P11 documentado en `FINANCE_ACCEPTANCE.md`. Las fixtures aportan tablas legacy y columnas verificadas; se omite la cuenta histórica de la migración de autenticación. No es una restauración completa de Supabase, Storage, tareas, notificaciones o integraciones.

Las carreras SQL mantienen abierta la primera transacción y exigen evidencia en `pg_blocking_pids` de que otra conexión espera antes de liberarla. La carrera HTTP exige dos transacciones de PostgREST esperando por la misma factura. Después se inspeccionan saldos, cantidades, filas y auditoría. No basta con lanzar dos promesas.

El servidor aloja los handlers sin modificaciones y adapta únicamente el prefijo `/rest/v1` de Supabase. La [configuración de contenedores](https://docs.postgrest.org/en/v12/explanations/install.html#docker) y la [recarga de esquema](https://docs.postgrest.org/en/v12/references/schema_cache.html#schema-cache-reloading-with-notify) siguen la documentación oficial. No certifica la versión productiva exacta de PostgREST ni el runtime de Vercel.

## Matriz

| ID | Comprobación | Resultado exigido |
|---|---|---|
| CON-01 | Dos cobros de 300 contra factura de 400 | Un cobro; saldo 100 |
| CON-02/03 | Aplicación de anticipo y cobro, ambos órdenes | Nunca exceden el total de la factura |
| CON-04/05 | Reembolso y aplicación del anticipo, ambos órdenes | No consumen dos veces el disponible |
| CON-06 | Dos pagos de 150 contra cuenta por pagar de 250 | Un pago y aplicación; sin pago huérfano |
| CON-07 | Dos recepciones de 70 contra compra de 100 | Recibido 70; pendiente 30 |
| CON-08 | Dos cargues de 70 contra stock de 100 | Solo uno reserva; disponible 30 |
| CON-09 | Dos facturas de 60 unidades contra venta de 100 | Una factura; sin cantidad duplicada |
| CON-10 | Reversión simultánea del mismo cobro | Saldo restaurado una vez |
| CON-11 | Rollback mientras otro cobro espera | Sin datos/señales fantasma; segundo cobro válido |
| CON-12 | Revocaciones simultáneas de sesión | Dos incrementos y dos auditorías |
| HTTP-01 | Login real de cuentas QA distintas | Identidades/tokens distintos y auditoría |
| HTTP-02 | Sin sesión y token alterado | 401 |
| HTTP-03 | Operador de lectura | Consulta permitida; escritura/roles 403; sin cambios |
| HTTP-04 | Cobro por A y versiones consultadas por A/B | Mismo cambio confirmado; actor auditado correcto |
| HTTP-05 | Conceder/retirar permisos sin renovar token | Permisos actuales; claims antiguos no elevan acceso |
| HTTP-06 | Cobros HTTP simultáneos A/B | Respuestas 200/400; un único cobro |
| HTTP-07 | Revocación individual y nuevo login | Token anterior 401; otra cuenta conserva acceso |
| HTTP-08 | Cambio de contraseña | Token/contraseña anteriores inválidos; nuevos válidos |
| HTTP-09 | Rol inactivo y cuenta inactiva | Permisos retirados y sesión rechazada respectivamente |
| HTTP-10 | Cinco contraseñas inválidas | Bloqueo temporal; otra cuenta sigue operativa |

## Evidencia y reproducción

- Esquema ampliado, dos identidades y cobro con `service_role` comprobados localmente con PGlite; no se cuentan como concurrencia real.
- 22/22 escenarios aprobados en la [PR #287](https://github.com/mikro970328-sys/-export-mca-portfolio/pull/287): [run 34396574892](https://github.com/mikro970328-sys/-export-mca-portfolio/actions/runs/34396574892), head `490e6bfc18b85a2b55e4016c28fea96346bf3cbd`. Los siete workflows de ese head aprobaron.
- La revisión final, incluida la espera explícita del contrato RPC, también aprobó 22/22: [run 34396893578](https://github.com/mikro970328-sys/-export-mca-portfolio/actions/runs/34396893578), head `e8f61d1ac288c4d5620b6ef870e208a883a5e322`. Siete workflows y ocho check runs aprobados.
- Main: seis de seis workflows aprobaron; [Operator and Concurrency Acceptance 34397039678](https://github.com/mikro970328-sys/-export-mca-portfolio/actions/runs/34397039678). Los otros cinco fueron Finance Acceptance, Purchase and Inventory Acceptance, Sales and Logistics Acceptance, B10.1 Secure PWA Web Push y Pages.
- Los seis owners SQL de autenticación, permisos y revocación inspeccionados coinciden con producción descontando formato. Los permisos legacy omitidos en la fixture (tablas/vistas de compras y almacén y secuencia de WR) se restauraron solo en QA tras contrastarlos con producción.
- Las primeras ejecuciones detectaron esas omisiones de fixture y una aserción contra una columna inexistente de la vista de stock; se corrigieron sin cambiar reglas productivas ni retirar escenarios. El arranque de PostgREST expuso OpenAPI antes de que el primer POST RPC estuviera disponible (404 transitorio): la espera ahora exige alcanzar el guard SQL de una identidad inexistente. Las solicitudes de negocio no tienen reintentos añadidos.
- Regresión local: 40 escenarios financieros, contrato de permisos y runtime de sesión revocable aprobados. Preview final `dpl_FvZropMsHGUfGGFVKaptJ59U5szR` READY; Chrome llega al login desde PWA. Producción: PWA HTTP 200 y API de versiones HTTP 401 sin sesión. Es comprobación de entrada, no de acciones comerciales autenticadas en navegador.
- Para reproducir: levantar servicios/variables de `.github/workflows/operator-acceptance.yml` con base vacía; ejecutar `npm ci --ignore-scripts --no-audit --no-fund` y `node scripts/check-operator-acceptance.mjs`. El proceso cierra sus conexiones y el runner desecha contenedores/datos.

## Límites y siguiente bloque

Versiones por HTTP no demuestran repintado de pantalla. Hay cobertura previa del runtime y Chrome con dos pestañas de una cuenta; falta aceptación visual con dos operadores y datos aislados.

El navegador rechazó el servidor local con `ERR_BLOCKED_BY_CLIENT`; el entorno local también impide el usuario de sistema necesario para PostgreSQL. No se modificaron esos controles. La concurrencia se ejecuta en integración.

Preview sigue enlazada a Supabase productivo: solo comprobar entrada/login. BrowserStack está bloqueado por cuota; no reintentar manualmente ni declarar iPhone/PWA certificado. Quedan la aceptación visual con backend aislado accesible y el dispositivo real, después mejoras y auditoría integral.
