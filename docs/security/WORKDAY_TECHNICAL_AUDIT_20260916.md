# Auditoría técnica de cierre diario — 2026-09-16

Estado: inspección consolidada con pendientes explícitos; no certificación de
seguridad absoluta ni autorización para operar transferencias/envíos reales.
Código inspeccionado: `c7cd441c27e7b1d8d0474df194ac0c8367ec8682`, publicado
sin cambios funcionales adicionales como `9f4aea87c412ac2dc467c0d934eee2f084307978`, PR #324.
Producción `dpl_9KawWZViHyByoBhEAXw5ScdR32NN` READY en app/admin.exportmca.com.

## Evidencia y fronteras

| Área | Evidencia obtenida | Límite |
|---|---|---|
| Jornada operativa | COM-01/18 Chromium y WebKit, 16/16 historias/motores en run 35153777014 | Bases y usuarios desechables; no operaciones comerciales QA remotas |
| Reintentos financieros | 26/26 API, 27/27 concurrencia/HTTP, 14/14 variantes proveedor; 19/19 workflows | No equivale a deduplicación después de crear otro formulario/identidad |
| Owners y acceso API | Gates frontend, B9 API, privilegios y frontera pública aprobados; 61 endpoints clasificados sin unresolved/findings del scanner | Análisis estático directo; no rastrea todos los aliases o datos almacenados |
| Privilegios reales | 165 relaciones public sin SELECT/escrituras de anon/authenticated; ningún security definer no-extension ejecutable por esos roles | service_role es un rol privilegiado; los permisos funcionales dependen también de la API |
| Esquema real | Cero constraints no validadas y cero security definers no-extension sin search_path fijado | No prueba el contenido de cada función ni todos los invariantes |
| Datos financieros | Cero importes no finitos/no positivos/subcentavo en cobros, pagos proveedor y aplicaciones; cero saldos negativos AR/AP | Fotografías agregadas de lectura; no son una auditoría contable de documentos externos |
| Dependencias productivas | npm audit --omit=dev: 146 dependencias, cero vulnerabilidades conocidas, run 35154029352 | Resultado puntual del registro; no ausencia universal de vulnerabilidades ni auditoría de dependencias dev |
| Entrega | Git PR, Preview exacta READY, migración compatible antes del deploy, producción READY | No mensajes bancarios/clientes ni prueba física iPhone/PWA/push |

Run de auditoría:
https://github.com/mikro970328-sys/-export-mca-portfolio/actions/runs/35154029352
Pruebas y publicación financiera:
https://github.com/mikro970328-sys/-export-mca-portfolio/pull/324

## Hallazgos clasificados

### Cerrado en #324 — multiplicación de pagos al perder confirmación

Un solo clic de USD 40 generó seis registros en PostgreSQL aislado. Identidad
persistente del formulario, serialización por petición y auditoría transaccional
corrigen anticipo y pago directo, conservando pagos independientes iguales.
Ver SUPPLIER_PAYMENT_RECOVERY.md y su regresión anterior al cambio.
Migración local 20260916212051; registro productivo 20260916214707.
Postflight: cinco pagos y cuatro aplicaciones anteriores, estados e importes
sin cambios; cero identidades asignadas retroactivamente. Grants y constraints
verificados después de aplicar. Sin rollback destructivo ni limpieza de pagos.

### A-01 · Prioridad alta de endurecimiento — errores indirectos y almacenados

Código revisado, no explotación en producción:
- api/shipments.js, releaseShipment: el helper puede devolver notification_error
  con error.message dentro de una respuesta de éxito parcial; la clasificación
  directa del handler no sanea esa propiedad indirecta.
- api/history.js: lectura devuelve filas de notifications/shipment_history y,
  para cliente, audit_log. Sus campos técnicos pueden transportar errores
  persistidos; selectFields incluye '*'.
- api/clients.js: welcome_error puede guardar el error técnico y GET usa select=*.
- api/export.js: exportación de notificaciones incluye error_message.
- Algunos consumidores de UI ya sustituyen el detalle por mensajes seguros;
  ello no elimina el campo de la respuesta JSON/CSV.

Acceso autenticado y permisos presentes; no se ha demostrado acceso anónimo ni
que esos errores contengan secretos reales. El riesgo es divulgación técnica
innecesaria a lectores del módulo. Siguiente cambio: reproducir con un marcador
sensible artificial en helpers/filas y sanear proyecciones públicas JSON/CSV
sin borrar el historial, romper estados ni perder diagnóstico controlado.
Este hallazgo NO está corregido por #324.

### A-02 · Pendiente de reproducción — límites transaccionales legacy

inventory_movements todavía permite INSERT/UPDATE/DELETE a service_role.
No permite acceso a anon/authenticated; posee inventory_movements_bind_source
y triggers de sincronización, pero la presencia de triggers no demuestra
inmutabilidad. api/inventory.js es de lectura; no se detectó escritor directo
del ledger en las APIs inspeccionadas. Antes de revocar hay que localizar todos
los callers SQL, triggers y operaciones legacy.

La recepción manual ajena a PO en api/warehouse.js crea cabecera y líneas en
peticiones diferentes y compensa un fallo con DELETE de la cabecera. Inspección
de código: falta reproducir qué ocurre al perder confirmación tras guardar
líneas, antes de afirmar pérdida/duplicación o cambiar ese owner. No revocar
privilegios ni reescribir la recepción a ciegas.

### A-03 · Mantenimiento, no fallo comercial reproducido

- El inventario TECH_DEBT_INVENTORY.md de julio es histórico: sus afirmaciones
  de ausencia de tests/owners consolidados no describen la base actual.
  Los gates y recorridos vigentes prevalecen.
- Runtime distribuido en HTML/JS, API Vercel y SQL/PostgREST; mantener owners
  explícitos. No añadir wrappers, observers o un framework nuevo para este cierre.
- npm emite advertencias de deprecación de dependencias y de acciones con runtime
  Node 20 forzado a Node 24. El audit productivo devuelve cero vulnerabilidades;
  revisar actualización con su propia compatibilidad/regresión, no usar audit fix
  destructivo ni cambiar versiones solo para silenciar avisos.

## Avisos Supabase y recuperación

Asesores antes/después: 74 INFO de RLS habilitado sin políticas, coherentes con
tablas privadas sin grants anon/authenticated en el modelo backend-only.
No crear políticas públicas para quitar el aviso.
Referencia: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

Permanece un WARN de protección de contraseñas filtradas deshabilitada en
Supabase Auth. El ERP inspeccionado autentica mediante admin_users, hashPassword/
verifyPassword y JWT propio con session_version, no mediante ese servicio.
Activarlo aisladamente no certifica la protección de las claves del ERP.
Referencia: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

No se ha efectuado restauración de un backup productivo. La disponibilidad y
restaurabilidad de backups, retención y contingencia externa deben comprobarse
en entorno autorizado antes de declararlos certificados. No copiar datos
productivos ni lanzar restauraciones destructivas como parte de estas pruebas.

## Próximo orden de trabajo

1. Reproducir/sanear A-01 en los owners de respuestas e historial, sin mensajes reales.
2. Reproducir la frontera A-02 de recepción manual y revisar writers/ACL del ledger;
   corregir solo el defecto demostrado y con su matriz.
3. Consolidar esas correcciones, controles de recuperación e integraciones
   pendientes antes de declarar el ERP listo sin reservas.

La jornada comercial probada ya cierra; la auditoría deja trabajo concreto.
No inventar porcentaje global, ocultar pendientes, repetir módulos resueltos
o convertir WebKit emulado en certificación de iPhone físico.
