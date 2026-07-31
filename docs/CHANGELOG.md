# Changelog — Export MCA ERP

Este archivo registra cambios técnicos y funcionales confirmados. No se debe registrar como desplegado un cambio que exista solamente en una rama o Preview.

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
- No se modificaron Supabase, `/api/clients`, Twilio, ShipsGo ni los CSV.
- Se añadió `scripts/check-clients-consolidation.mjs`.
- Se añadió `.github/workflows/clients-consolidation-check.yml`.
- La validación prohíbe en el módulo nuevo:
  - `MutationObserver`
  - `cloneNode`
  - `replaceWith`
  - `window.clients`
  - peticiones GET directas adicionales a `/api/clients`
- GitHub Actions run `30600879695` terminó con resultado `success`.
- Vercel generó la Preview `dpl_FgBtJBL1MeBP8FQvChC9KXbbQSFV` en estado `READY` para el commit `20537df4d038a3b0185df4a2a2c7079e62541f22`.
- La Preview está protegida por SSO; todavía no se han aprobado pruebas visuales autenticadas ni pruebas de escritura.
- La PR funcional permanece abierta como borrador y no está autorizada para producción.

Pendiente:

- unificar el selector `erpClient` con `fillClientSelects()`;
- retirar la construcción local de opciones en `admin/erp-core.js`;
- eliminar posteriormente la consulta duplicada de Clientes en `shipment-row-details.js`;
- ejecutar pruebas manuales con un registro QA autorizado;
- probar escritorio, móvil y PWA;
- documentar resultados antes de solicitar fusión.

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
