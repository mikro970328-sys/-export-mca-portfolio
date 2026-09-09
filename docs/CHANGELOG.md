# Changelog — Export MCA ERP

Este archivo registra cambios técnicos y funcionales confirmados. No se debe registrar como desplegado un cambio que exista solamente en una rama o Preview.

## 2026-09-09 — Aceptación de compras, recepción e inventario

Estado: publicado mediante [PR #281](https://github.com/mikro970328-sys/-export-mca-portfolio/pull/281), commit funcional `7af4562d4d91523a6a9a655c9ae2ee289f861dc7`. Producción `dpl_BAwNdKzGntGJioneE5M5RKhj1DaM` READY.

- 19 escenarios SQL y 8 de API aprobados con 31 migraciones reales en una base PGlite desechable. Se conservan cero filas operativas al terminar; no se escribieron datos comerciales en producción.
- Se reprodujo y corrigió la aceptación de `"false"` como permiso de exceso: ahora se requiere el booleano `true`.
- Moneda inválida, almacén omitido y línea inexistente se presentan como errores de entrada seguros (400), en lugar de fallos genéricos 500.
- La fixture UX5 de compras se alinea con la edición protegida ya vigente. Se añade workflow y matriz `PURCHASE_INVENTORY_ACCEPTANCE.md`.
- 9/9 workflows de PR y 3/3 del commit funcional en main aprobaron. Preview alcanza login administrativo/PWA; producción responde 200 en PWA y 401 esperado en APIs sin sesión. Sin 5xx en la consulta pospublicación observada.
- Límite: autenticación/transporte de API simulados y SQL sin concurrencia entre conexiones. No certifica navegador, iPhone/PWA ni el ciclo completo de ventas, despacho, finanzas o auditoría.

## 2026-09-09 — Recuperación de sincronización y señales reales

Estado: publicado mediante [PR #279](https://github.com/mikro970328-sys/-export-mca-portfolio/pull/279), commit funcional `ab53b7440afd6fb6d0017db57c0969d5c33cbfc9`. Vercel producción `dpl_2kdPSDZ9FoiStHTWvnsY4hyJFoth` READY; entrada ERP/PWA y asset live5 verificados con HTTP 200. Migración `20260909143701_live_sync_recovery.sql` aplicada y comprobada.

- Se corrige el bloqueo indefinido del polling con deadline de 12 segundos para respuesta y cuerpo, cancelación y reintentos progresivos.
- Las respuestas tardías de una sesión anterior no repintan ni cierran la sesión nueva. Se detiene al logout y se reanuda tras reconexión/restauración de página.
- Se mantienen el refresco selectivo, la cadencia 4 s visible/15 s en segundo plano y la protección de formularios modales.
- La QA autenticada encontró un bloqueo adicional: los paneles de Cuenta, confirmaciones y notificaciones conservan `role="dialog"` dentro de overlays ocultos. Se corrige su detección en el controlador existente, comprobando geometría y visibilidad CSS. La regresión falló antes de esta corrección y pasa con ella; no se añaden observers ni wrappers.
- Se sustituyen solo los triggers de sincronización por eventos con tablas de transición. Las sentencias sin cambios reales dejan de incrementar versiones; el cursor backend de web push no despierta la interfaz.
- No se borraron datos operativos ni se ampliaron privilegios. Se conservan las 17 áreas y 66 tablas visibles (198 triggers).
- Se añaden dos pruebas de regresión, se amplía B10 con el reconciliador real y se integran en GitHub Actions. Total local: 95/95 scripts aprobados.
- El último commit de la PR aprobó 46/46 workflows. La QA autenticada en dos pestañas de una cuenta confirmó refresco automático, espera durante el editor y aplicación al cerrarlo, con una señal de versión controlada y sin escrituras comerciales.
- Se verificó en Supabase una repetición de ambos reconciliadores con delta de notificaciones 0, dentro de transacciones revertidas.
- Se actualizan los assets a `20260909-live5` y se aclara el estado funcional pendiente en `CURRENT_STATE.md`.
- Límite: no certifica dos operadores productivos ni móvil/PWA real. BrowserStack de `main` (run `34378335000`) falla por cuota agotada; los otros seis workflows aprobaron.

## 2026-07-30

### Consolidación funcional del módulo Clientes

Estado: **PR #15 en borrador; Preview solamente; no fusionado a producción**

Rama: `refactor/clients-consolidation`

- Se creó `admin/clients-module.js` como implementación explícita del módulo Clientes.
- Se integraron directamente los seis campos actuales:
  - Nombre
  - Empresa
  - Nombre de la MIPYME
  - Importadora por la que importa
  - WhatsApp
  - Correo
- Se implementó un único flujo de creación con protección contra doble clic.
- Se implementó una única edición modal para los seis campos.
- Se corrigió el mensaje posterior a la creación para indicar que la bienvenida queda pendiente cuando no fue enviada.
- Se integró el menú de acciones dentro del módulo principal para escritorio y móvil.
- Las acciones usan claves estables para:
  - Editar
  - Enviar/Reenviar/Reintentar bienvenida
  - Historial
  - Eliminar
- `admin/client-extra-fields.js` permanece guardado, pero dejó de cargarse.
- `admin/client-actions-menu.js` permanece guardado, pero dejó de cargarse.
- `admin/erp-core.js` dejó de construir localmente las opciones de `erpClient`.
- Expedientes utiliza ahora `fillClientSelects()` como fuente compartida con Registrar contenedor.
- `admin/erp-core.js` dejó de envolver `window.loadAll` para refrescar clientes.
- Se añadió el evento explícito `export-mca:clients-changed` para recargar Expedientes después de crear o editar un cliente.
- `admin/shipment-row-details.js` dejó de consultar nuevamente `/api/clients` y `/api/shipments`.
- Los detalles de tracking reutilizan ahora las colecciones `clients` y `shipments` ya cargadas.
- El `MutationObserver` de detalles de tracking se mantiene temporalmente para la fase específica de Tracking.
- No se modificaron Supabase, `/api/clients`, Twilio, ShipsGo ni los CSV.
- Se añadió `scripts/check-clients-consolidation.mjs`.
- Se añadió `.github/workflows/clients-consolidation-check.yml`.
- La validación prohíbe en el módulo nuevo:
  - `MutationObserver`
  - `cloneNode`
  - `replaceWith`
  - `window.clients`
  - peticiones GET directas adicionales a `/api/clients`
- La validación también comprueba:
  - uso de `fillClientSelects()` en Expedientes;
  - ausencia de la función local `fillClients`;
  - ausencia del wrapper de `window.loadAll` en `erp-core.js`;
  - reutilización de datos cargados en detalles de tracking;
  - ausencia de consultas duplicadas en ese detalle.
- GitHub Actions run `30601356712` terminó con resultado `success` para el commit `3c1ae4c3a73e075a5a82bfb3a1f86fcd295aad38`.
- Vercel generó la Preview `dpl_2AeGj7UdhDCNVsFz8ohetFJG5Lsa` en estado `READY` para ese commit.
- La Preview está protegida por SSO; todavía no se han aprobado pruebas visuales autenticadas ni pruebas de escritura.
- La PR funcional permanece abierta como borrador y no está autorizada para producción.

Pendiente:

- ejecutar la matriz manual no destructiva en la Preview autenticada;
- verificar formulario y listado en escritorio;
- verificar menú y responsividad en iPhone/PWA;
- comprobar que `shipmentClient` y `erpClient` estén sincronizados;
- comprobar detalles de tracking con datos existentes;
- crear y editar un registro QA únicamente con autorización expresa;
- verificar bienvenida, historial y CSV;
- documentar resultados antes de solicitar fusión;
- no ejecutar eliminación física de clientes reales.

### Baseline del módulo Clientes

Estado: **documentación fusionada en `main`; sin cambios funcionales**

- Se inspeccionó el flujo completo de Clientes en frontend, backend y Supabase.
- Se creó `docs/MODULE_CLIENTS_BASELINE.md` con:
  - diccionario real de las 13 columnas de `clients`;
  - mapa de creación, edición, listado, bienvenida e historial;
  - dependencias con Contenedores, Expedientes, Dashboard y exportaciones;
  - análisis de `client-extra-fields.js` y `client-actions-menu.js`;
  - límites de la futura consolidación;
  - estrategia de rollback.
- Se creó `docs/CLIENTS_TEST_MATRIX.md` con pruebas de:
  - autenticación y carga;
  - formulario, creación y edición;
  - duplicados;
  - WhatsApp e historial;
  - Contenedores y Expedientes;
  - Dashboard y CSV;
  - escritorio, móvil y PWA;
  - rendimiento y estabilidad;
  - eliminación únicamente en entorno aislado.
- Se confirmó que la creación actual deja `welcome_status = pending` y la bienvenida se envía mediante una acción explícita.
- Se confirmó que no hay restricciones únicas de base de datos para teléfono o correo; la protección actual está en la API.
- Se confirmaron reglas de eliminación mixtas:
  - `CASCADE` para shipments, notifications y documents;
  - `SET NULL` para shipment_history;
  - `RESTRICT` para operations, invoices y payments.
- Se determinó que eliminar un cliente real puede borrar información asociada o fallar según sus relaciones.
- Se estableció que las pruebas destructivas no se ejecutarán en producción.
- No se pudo confirmar mediante las herramientas disponibles si Vercel Preview usa variables de Supabase separadas.
- La PR documental `#13` fue fusionada mediante squash.
- Commit de fusión: `6cbe2cdb02ccb25c42163f5f8c57501bd6304837`.

### Auditoría general de deuda técnica

Estado: **documentación fusionada en `main`; sin cambios funcionales**

- Se creó el inventario inicial de deuda técnica del frontend administrativo.
- Se identificaron loaders dinámicos, funciones globales sobrescritas, `MutationObserver`, timers, consultas duplicadas y dependencias por orden de carga.
- Se confirmó que la deuda técnica es alta, pero recuperable mediante consolidación progresiva sin reconstruir todo el ERP.
- Se definió el plan de limpieza por fases.
- Se estableció que ningún refactor funcional se realizará directamente en `main`.
- Se estableció el uso obligatorio de Preview Deployment de Vercel antes de integrar cambios funcionales.
- Se creó una fuente de contexto para continuidad entre chats mediante:
  - `docs/AI_CONTEXT.md`
  - `docs/CURRENT_STATE.md`
  - `docs/TECH_DEBT_INVENTORY.md`
  - `docs/CLEANUP_PLAN.md`
  - `docs/CHANGELOG.md`
- Se estableció Clientes como el primer módulo funcional que se consolidará después de completar su matriz de pruebas.
- La PR documental `#11` fue fusionada mediante squash en `main`.
- Commit de fusión: `1807f4a5e343c8b500e3f1534513a3e5234d56bb`.
- La corrección documental posterior se fusionó en el commit `ffe2a764696f786bb9d758ec63168b10ca82f839`.

### Producción

- No se modificó Supabase.
- No se modificaron APIs.
- La consolidación funcional de Clientes no está en `main`.
- Producción conserva el módulo anterior.
- La documentación de continuidad y el baseline de Clientes están disponibles en `main`.
# 2026-09-09 — Aceptación de ventas y logística (preparada)

- 39 escenarios de comportamiento en base aislada (29 SQL, 10 API), 74 migraciones reales y CI sin credenciales.
- Corrección atómica del reemplazo de cargues independientes y de la mercancía del contenedor al editar/asignar.
- La ruta de compatibilidad de ventas conserva el total exacto; validación de importes y respuestas 400 para sobreasignación/contexto.
- Las acciones de cargues reflejan la protección existente de vínculos comerciales. Matriz y límites: `docs/SALES_LOGISTICS_ACCEPTANCE.md`.
- Publicación y migración productiva pendientes al preparar la PR; no se registran escrituras comerciales QA en producción.
