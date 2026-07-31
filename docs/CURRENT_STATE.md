# Current State — Export MCA ERP

Última actualización: 2026-07-30 22:43 ET

## Objetivo actual

Limpiar progresivamente la deuda técnica del ERP sin perder funciones existentes y sin interrumpir producción.

## Producción

- Rama productiva: `main`
- Último commit documental fusionado: `ffe2a764696f786bb9d758ec63168b10ca82f839`
- La fase actual no ha modificado código operativo, APIs ni Supabase.
- La PR de Arquitectura 1.0 continúa separada y no debe ejecutarse en producción durante esta limpieza.

## Documentación base en `main`

- `docs/AI_CONTEXT.md`
- `docs/CURRENT_STATE.md`
- `docs/TECH_DEBT_INVENTORY.md`
- `docs/CLEANUP_PLAN.md`
- `docs/CHANGELOG.md`

Cualquier IA, desarrollador o chat nuevo debe leer esos documentos antes de proponer o ejecutar cambios.

## Fase actual

**Fase 0 — Baseline y control de cambios**

### Rama activa

`audit/clients-baseline`

### Alcance

Auditoría documental completa del módulo Clientes. No se está cambiando comportamiento.

### Archivos creados en la rama

- `docs/MODULE_CLIENTS_BASELINE.md`
- `docs/CLIENTS_TEST_MATRIX.md`

### Commits de la rama

- `a85290942cc52e71a606f0d43aa8c30da8bd374c` — baseline técnico y mapa de dependencias
- `03e6ebf52bdd57b126beb6ec06198f863bf82528` — matriz de pruebas de regresión

## Hallazgos confirmados del módulo Clientes

### Frontend

- `admin/index.html` contiene la implementación base del formulario, listado, creación, edición, bienvenida e historial.
- `admin/client-extra-fields.js` inserta `mipyme_name` e `importer_name` después de cargar.
- Ese archivo clona y reemplaza `saveClient`, sustituye `editClient` y mantiene el parche mediante `MutationObserver`.
- `admin/client-actions-menu.js` asume posiciones de columnas y botones, oculta acciones originales y crea un menú mediante otro `MutationObserver`.
- La colección `clients` es una variable léxica; `window.clients` no es una fuente confiable. El parche de edición puede volver a consultar `/api/clients`.
- El selector de Expedientes es actualizado por dos implementaciones diferentes: `fillClientSelects()` y el wrapper de `admin/erp-core.js`.

### Backend

- `api/clients.js` soporta GET, POST, PATCH, reenvío de bienvenida y DELETE físico.
- La creación guarda `welcome_status = pending`; no envía automáticamente la bienvenida.
- La detección de duplicados por WhatsApp o correo está implementada en la API.
- No existe una restricción única de base de datos para teléfono o correo.

### Supabase

La tabla `clients` tiene 13 columnas actuales, incluyendo:

- `company`
- `mipyme_name`
- `importer_name`
- estado, fecha y error de bienvenida

Relaciones al eliminar cliente:

- `CASCADE`: `shipments`, `notifications`, `documents`
- `SET NULL`: `shipment_history`
- `RESTRICT`: `operations`, `invoices`, `payments`

Por ese motivo, no se ejecutarán pruebas destructivas sobre clientes reales.

### Dependencias externas

Los datos del cliente se consumen en:

- selector y búsqueda de Contenedores;
- selector y listado de Expedientes;
- detalles del tracking;
- Dashboard y alertas de bienvenida;
- historial;
- CSV de clientes, tracking, expedientes y notificaciones.

## Verificación de entorno Preview

Se confirmó que Vercel crea despliegues Preview para ramas, pero las herramientas disponibles no permiten verificar el alcance de las variables de entorno ni confirmar si Preview usa una Supabase separada.

**Bloqueador de pruebas destructivas:** una Preview no se considerará base aislada hasta verificar las variables de entorno. Mientras tanto, las pruebas deberán ser estáticas, de lectura o utilizar registros QA no relacionados.

## Trabajo completado de Fase 0

- inventario general de deuda técnica;
- baseline documental fusionado en `main`;
- mapa real del módulo Clientes;
- diccionario de datos de `clients`;
- inventario de relaciones y reglas de eliminación;
- flujo de creación, edición, listado, bienvenida e historial;
- dependencias con Contenedores, Expedientes, Dashboard y CSV;
- matriz de pruebas no destructivas y destructivas aisladas;
- estrategia de rollback propuesta.

## Trabajo pendiente antes de código funcional

1. Revisar y fusionar la documentación de `audit/clients-baseline`.
2. Confirmar si Preview dispone de Supabase aislada o establecer una estrategia QA segura.
3. Crear `refactor/clients-consolidation` desde el `main` más reciente.
4. Registrar SHA inicial de cada archivo funcional que se vaya a modificar.
5. Implementar la consolidación en commits pequeños.
6. No retirar los parches hasta aprobar la matriz de pruebas.

## Próxima acción exacta

Abrir una PR documental para `audit/clients-baseline`, verificar que solo incluya documentación y fusionarla en `main`.

Después, crear la rama funcional:

`refactor/clients-consolidation`

El primer commit funcional deberá integrar los seis campos y un solo flujo de creación/edición, sin cambiar nombres técnicos ni Supabase.

## Reglas para la futura rama funcional

- No trabajar directamente en `main`.
- No cambiar la semántica de `company`, `mipyme_name` o `importer_name`.
- No añadir nuevos `MutationObserver`.
- No retirar `client-extra-fields.js` ni `client-actions-menu.js` hasta que la implementación consolidada esté probada.
- No ejecutar eliminación de clientes reales.
- No fusionar a producción sin aprobación explícita.

## Regla para cerrar una sesión de trabajo

Antes de terminar cualquier sesión o chat se debe actualizar este archivo con:

- rama activa;
- último commit relevante;
- archivos modificados;
- pruebas ejecutadas y resultados;
- Preview de Vercel, cuando exista;
- riesgos o bloqueadores;
- siguiente acción exacta;
- confirmación de si el cambio llegó o no a producción.

## Estado de producción al cierre

La documentación base está en `main`. El baseline de Clientes está en una rama de auditoría. No se ha modificado el comportamiento productivo del ERP.
