# B9.0 · Auditoría integral de seguridad

Base auditada: `a7023f121ffb2617a941d2273e6ead0805909188` (release B8).

## Arquitectura vigente

- Autenticación ERP: JWT propio emitido por `api/login.js`; usuarios y roles viven en `admin_users` + P3 access control.
- Backend: Vercel API usa `SUPABASE_SERVICE_ROLE_KEY`; el frontend no necesita Supabase anon key.
- Autorización P3: `authenticateAdmin`, `authorizeAdmin`, `authorizeAdminAny`, `admin_effective_permissions`.
- Datos públicos intencionales se sirven mediante endpoints backend, no mediante acceso directo Supabase.

## Hallazgos

### CRITICAL · B9-01 · Bypass directo de la matriz P3 por Supabase Auth

El schema `public` conserva default ACLs de Supabase que conceden tablas/secuencias/functions a `anon` y `authenticated`. En el estado auditado existen grants directos para 26 tablas y 7 views por cada rol (231 privilege entries por rol).

Siete tablas legacy mantienen además policies `authenticated ALL` basadas únicamente en `auth.uid() is not null`: `documents`, `expenses`, `importers`, `operation_items`, `operations`, `products`, `suppliers`.

Existe al menos un usuario Supabase Auth confirmado. Una prueba transaccional B9 con `SET LOCAL ROLE authenticated` insertó correctamente una fila en `suppliers`; el test terminó en `ROLLBACK` y confirmó residuo 0. Por tanto, un usuario Supabase Auth puede modificar datos sin pasar por `authorizeAdmin` ni por la matriz P3.

**B9.1:** revocar privilegios efectivos de `anon/authenticated`, retirar policies legacy `authenticated ALL` y corregir default privileges para `postgres` y `supabase_admin`, preservando `service_role`.

### CRITICAL · B9-02 · Callback Twilio sin verificación de firma

`api/twilio-status.js` acepta cualquier POST y actualiza `notifications.delivery_status` usando `MessageSid`/`SmsSid`. No valida `X-Twilio-Signature` ni autentica el callback.

**B9.2:** validar firma Twilio contra la URL exacta del callback y `TWILIO_AUTH_TOKEN`; rechazar callbacks inválidos antes de cualquier escritura.

### HIGH · B9-03 · Auditoría fail-open y no atómica

`writeAudit()` captura errores y permite continuar. Muchas mutaciones escriben el dato primero y el audit event después en una segunda operación. Una falla de auditoría no revierte la mutación.

**B9.3:** hacer inmutables los eventos auditados y garantizar audit trail transaccional/fail-closed para administración y mutaciones financieras/operativas críticas.

### HIGH · B9-04 · Tokens no revocados por cambio de contraseña

Los JWT duran 12 horas. `authenticateAdmin()` revalida estado/rol en DB, pero el token no tiene `iat`/session version y el cambio de contraseña no invalida tokens previos.

**B9.3:** introducir versión/issued-at de sesión y rechazar tokens anteriores a `password_changed_at` o a una revocación explícita.

### MEDIUM · B9-05 · Endpoints públicos legacy muertos

`api/public-marketplace.js` depende de `inventory_listings` / `marketplace_leads`, inexistentes en producción. `api/public-tracking.js` depende de columnas `public_tracking_*` y `operation_events`, también inexistentes. Son endpoints service-role públicos que hoy terminan en error y ya no representan el modelo operativo actual.

**B9.2:** retirar/410 estas rutas o reconstruirlas únicamente si existe un owner de producto actual; no dejar service-role public endpoints huérfanos.

### LOW · B9-06 · Grants EXECUTE heredados en trigger functions

Los default privileges también conceden EXECUTE a `anon/authenticated` sobre trigger functions. Casi todos los functions expuestos son triggers no invocables como RPC de negocio; el único function no-trigger directamente ejecutable es `canonical_cuba_document_type(text)`, una normalización pura.

**B9.1:** limpiar EXECUTE por defecto y conceder explícitamente sólo a roles requeridos.

### LOW · B9-07 · `search_path` mutable en trigger legacy

`set_commercial_publications_updated_at` no fija `search_path`; Supabase advisor lo marca como warning.

**B9.1:** fijar `search_path` explícito.

## Controles que sí están correctos

- P3 eliminó `requireAdmin/requireMasterAdmin` de handlers privados.
- Dashboard/Reportes y RPCs financieros B5–B8 están reservados a `service_role`.
- Views legacy con grants directos usan `security_invoker=true`; no saltan RLS por ownership del view.
- `commercial_publications` tiene una policy pública SELECT intencional y limitada a publicaciones visibles.
- Administración de roles/equipos/usuarios/trabajadores ya genera audit events.
- Login tiene bloqueo temporal por intentos fallidos.
- `operational-links.js` autentica identidad y aplica permisos por dominio antes de cargar datasets.

## Fases propuestas

### B9.1 · Database privilege hardening
- Revocar grants actuales de `anon/authenticated` en objetos internos `public`.
- Corregir default privileges de `postgres` y `supabase_admin`.
- Eliminar policies legacy `authenticated ALL`.
- Preservar `service_role` y validar APIs productivas.
- Fijar `search_path` pendiente.

### B9.2 · Webhooks y superficie pública
- Firma Twilio obligatoria.
- Retirar/410 marketplace/tracking legacy o rebasarlos sobre owner vigente.
- Gate para que todo webhook externo tenga autenticación verificable.

### B9.3 · Sesiones y auditoría robusta
- Invalidación de sesiones por password/revocation version.
- Audit log append-only.
- Audit trail transaccional/fail-closed en acciones sensibles.
- Pruebas de actor/action/entity y rollback.

### B9.4 · Security release gate
- Inventario CI de todos los handlers API y permissions.
- Pruebas DB con `anon`, `authenticated`, `service_role`.
- Verificación de RPC/functions/views, RLS/grants/default ACL.
- Advisors y smoke exacto de producción.

No se aplica DDL en B9.0. Los cambios comienzan únicamente en B9.1 después de cerrar esta auditoría.
