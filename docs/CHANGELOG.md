# Changelog — Export MCA ERP

No se registra como publicado un cambio solo por estar en una rama o Preview.
El historial previo íntegro se conserva, sin cambios, en
[history/CHANGELOG_20260909.md](history/CHANGELOG_20260909.md).

## 2026-09-10 UTC — Direct Ship: hora local y aceptación (PR #296)

Aceptación del código `e5ad0c846ac3dbd8c5077bfed2692a34da34ba50` aprobada:
13 workflows; Browser Operator Acceptance `34427427673`, seis jobs.
La publicación se verifica por merge/deployment registrados en PR #296.

- Conversión de datetime-local a ISO con zona en el navegador y rechazo de
  fecha vacía/inválida; asset `20260909-directtime1`. Sin SQL ni reescritura histórica.
- Diez checkpoints por motor Direct Ship, preservando matrices comerciales y
  de operadores. Desvinculación/reutilización, despacho y protección de cantidades.
- Cero WR/Cargues/inventario; hora SQL/pantalla consistente; cinco casos
  zona/fecha y quince comprobaciones de entradas inválidas.
- Se corrigió la configuración QA (descubrimiento, handler, grant legacy local,
  espera de respuestas, cierre y evidencia). No son cambios de datos productivos.
- Estado y contexto consolidados; el corte anterior y changelog se preservan
  como blobs idénticos en history. Riesgos y límites en la matriz específica.

## 2026-09-09 — Publicación de Compras/Cargues y compra a cobro (PR #295)

Publicado en `f97c8744ce2e4c4d7ca9d5139cb1fdd65fe314b8`, deployment
`dpl_GZpRvCoHJ676YwcGXQ1VCEZ6Nhri` READY. Supera la nota anterior en validación.
Conserva proveedor/almacenes de Compras (`20260909-masters1`) y acceso al detalle
móvil de Cargues (`20260909-loadcard1`). 12 workflows de PR y seis de main
aprobados; 12 checkpoints comerciales por motor y matrices previas preservadas.
