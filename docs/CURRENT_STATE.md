# Current State — Export MCA ERP

Última actualización: 2026-07-30

## Objetivo actual

Limpiar progresivamente la deuda técnica del ERP sin perder funciones existentes y sin interrumpir producción.

## Producción

- Rama productiva: `main`
- Último commit documental relevante: `1807f4a5e343c8b500e3f1534513a3e5234d56bb`
- La auditoría no modificó código operativo, APIs ni Supabase.
- La PR de Arquitectura 1.0 continúa separada y no debe ejecutarse en producción durante esta limpieza.

## Baseline documental

- PR `#11 — Inventariar deuda técnica y definir plan de limpieza`
- Estado: fusionada en `main`
- Alcance: documentación e inventario solamente

Documentos disponibles directamente en `main`:

- `docs/AI_CONTEXT.md`
- `docs/CURRENT_STATE.md`
- `docs/TECH_DEBT_INVENTORY.md`
- `docs/CLEANUP_PLAN.md`
- `docs/CHANGELOG.md`

Cualquier IA, desarrollador o chat nuevo debe leer estos documentos antes de proponer o ejecutar cambios.

## Hallazgos confirmados

- El frontend administrativo depende de loaders dinámicos y del orden de carga.
- Existen al menos 12 `MutationObserver` en los módulos inspeccionados.
- Varias funciones globales son sustituidas o envueltas.
- Clientes y contenedores clonan y reemplazan botones originales.
- Tracking tiene varios decoradores que modifican la misma tabla y repiten consultas.
- La PWA utiliza un iframe como segunda capa de aplicación.
- `package.json` no tiene pruebas, lint ni validaciones automáticas.

## Fase actual

**Fase 0 — Baseline y control de cambios**

Trabajo completado:

- inventario inicial de deuda técnica;
- identificación de módulos críticos;
- definición del orden de limpieza;
- creación y fusión del baseline documental;
- definición de reglas de continuidad entre chats.

Trabajo pendiente de Fase 0:

- completar el inventario de archivos administrativos y APIs relacionadas;
- preparar la matriz de pruebas de regresión para Clientes;
- documentar el comportamiento actual de crear, editar, listar, exportar, bienvenida e historial;
- definir el punto exacto de integración de `client-extra-fields.js` y `client-actions-menu.js`;
- crear una rama funcional exclusiva para Clientes desde el `main` más reciente;
- generar una Preview de Vercel antes de cualquier integración funcional a producción.

## Próxima acción exacta

Crear la matriz de pruebas y el mapa completo de dependencias del módulo Clientes. No cambiar código funcional todavía.

Después de aprobar esa matriz, crear la rama:

`refactor/clients-consolidation`

En esa rama se integrará el comportamiento útil de los parches dentro de la implementación principal. No se borrará ningún parche hasta que la nueva implementación pase todas las pruebas.

## Criterio para comenzar código

No comenzar el refactor funcional hasta tener documentado:

1. todos los campos y su correspondencia con Supabase;
2. todos los puntos que consumen `company`, `mipyme_name` e `importer_name`;
3. flujo completo de creación y edición;
4. acciones de bienvenida e historial;
5. selectores de clientes en Contenedores y Expedientes;
6. exportaciones CSV;
7. comportamiento en escritorio, móvil y PWA;
8. procedimiento de rollback.

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

La documentación de continuidad está en `main`. La limpieza técnica todavía no ha modificado el comportamiento del ERP.