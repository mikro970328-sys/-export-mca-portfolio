# UX8 · Inicio y navegación

Fecha: 2026-09-21. Rama: `feat/ux8-dashboard-navigation-clarity`.
Base: `f60115e` (main, mejoras de Direct Ship incluidas).

## Alcance

- Inicio muestra «Requiere atención» y actividad reciente antes del catálogo de
  indicadores. Cabecera y tarjetas más compactas.
- Cuatro indicadores financieros principales por moneda; los ocho restantes
  siguen disponibles en un desplegable nativo. No se suman monedas ni se
  recalculan cifras del backend.
- Filtros desplegables con período, moneda y cantidad de filtros activos visibles.
  Se conserva la aclaración de que los saldos son actuales.
- Los desplegables conservan su estado durante el refresco y tras error/reintento.
  Es una preferencia de la sesión de página, no una preferencia de cuenta.
- «Buscar sección» filtra los controles existentes por nombre y grupo. Ignora
  mayúsculas, acentos y espacios exteriores. No busca registros comerciales.
- Buscar no modifica `.hidden`, los permisos ni el estado persistido de grupos.
  Limpiar/Escape restaura el menú; navegar o contraerlo limpia la búsqueda.
- El encabezado muestra el grupo activo y un solo destino lleva `aria-current`.

Los cambios viven en los owners existentes de Dashboard y navegación. No hay
observers, wrappers globales, botones clonados ni una nueva capa visual paralela.
Figma no es dependencia de ejecución ni de futuras modificaciones funcionales.

## Verificación realizada

`npm run test:dashboard-navigation`: **88 comprobaciones DOM aprobadas**.
Usa jsdom 26.1.0, con tráfico de red prohibido, respuestas sintéticas, destinos y
permisos simulados. Ejecuta los owners reales en dos ramas de `matchMedia`
(escritorio y móvil); **no calcula ni certifica layout visual**.

Cubre búsqueda, grupos, permisos, controles originales, Escape, colapso,
restauración inicial del menú móvil, navegación, contexto, monedas, 12 métricas
por moneda, filtros, estados abiertos/cerrados, solicitudes duplicadas, errores,
reintento, estados vacíos, escape de texto y delegación a Tracking.

También pasaron 22 gates existentes: Dashboard ejecutivo/presentación, propiedad
frontend/shell, resiliencia, acceso, iconos, bases visuales, tareas, sincronización
en vivo, borradores (estático y runtime), presentación de Clientes/Accesos/alertas/
inbox/Tracking, cierre de modales y límites públicos/de API B9.
Las expectativas de versiones de assets se actualizaron junto a los assets;
no se eliminaron validaciones. El workflow visual incorpora el nuevo gate DOM.

## Límites y siguiente paso

La apertura del fixture local en el navegador de esta sesión fue rechazada por
su política de URL. No se eludió la restricción. **Revisión visual, teclado real,
Chrome/Safari y dispositivo móvil real: pendientes.** No hay capturas verificadas.

El fixture reproducible `scripts/preview-ux8-dashboard-navigation.mjs` genera
JSON con HTML de escritorio/móvil usando assets locales. Su harness está en
`scripts/lib/ux8-browser-harness.js`; el shell productivo no lo carga. Muestra
claramente «DATOS FICTICIOS» y bloquea conexiones. Está preparado para revisión
en un entorno que autorice esos archivos, pero no fue aprobado visualmente aquí.

No se ha ejecutado aceptación de API/base de datos ni el flujo comercial completo
en esta entrega. No se modificaron backend, esquema, datos, credenciales,
permisos de cuentas ni notificaciones. No se integró ni publicó en producción.

Antes de integrar: revisar visualmente desktop/móvil, contrastar un Dashboard
real autorizado de solo lectura y completar los gates del commit en CI. Un
Preview no es base de datos aislada: no crear operaciones comerciales de prueba.
