# ERP de escritorio · Entrega del 26 de septiembre de 2026

La etapa de escritorio acordada con Daniel está implementada, publicada y verificada. Este estado sustituye los pendientes históricos de las entregas por módulo. El siguiente paso es revisar el iPhone físico; se avisa a Daniel antes de iniciarlo.

## Acceso

- ERP: https://admin.exportmca.com
- Figma: https://www.figma.com/design/aq38kVEYDEmmNlUOAOvfYg?node-id=141-2
- Última entrega de código: PR #358, https://github.com/mikro970328-sys/-export-mca-portfolio/pull/358

## Alcance cerrado

| Área | Entregas |
| --- | --- |
| Base blanca, navegación y Ventas | #345–346 |
| Gastos y Compras | #347–348 |
| Recepciones, Existencias y Productos | #349–350 |
| Cargues, Tracking y documentos | #351 |
| Facturación, Cuentas por pagar y Reportes | #352 |
| Clientes y Proveedores | #353 |
| Tareas y Trabajadores | #354 |
| Usuarios, roles, equipos y Mi cuenta | #355 |
| Inicio, alertas y notificaciones | #356 |
| Publicaciones, asignaciones y supervisión | #357 |
| Composición final del shell y relaciones de Compras | #358 |

Las pantallas usan los owners existentes, Inter local y los tokens compartidos. Compras presenta sus enlaces de proveedor, WR, facturas y pagos dentro de un desplegable de altura estable; descarta respuestas de compras cerradas o sustituidas. El detalle conserva todos sus datos y acciones. El shell usa 224 px y deja a cada módulo su propio espacio interior.

## Evidencia final

- Head probado: `78f8e90a4693aa19142a419b2582a62a9f91d910`.
- Árbol probado: `bbe3cdcfdee19003d6347385db9389f2561eb0fe`.
- CI: `36248419740`, 44/44 workflows y 22/22 trabajos.
- 174/174 pruebas visuales en Chromium y 174/174 en WebKit, con capturas revisadas.
- Los otros 20 trabajos ejercitan recorridos comerciales, concurrencia, recuperación, cancelaciones, navegación y documentos con API real y PostgreSQL/PostgREST desechables.
- Producción: `fc038fb9e56cf182df4b46db97af1ed1291d72a6`; Vercel `dpl_D7M6unyM73pSuBxsZxK62yTEq3Xt` READY.
- 11 archivos publicados idénticos al código revisado, comprobados por GET. Endpoints protegidos sin sesión: 401.
- Las pruebas no escriben datos QA en producción ni Preview y no envían mensajes o notificaciones reales.

## Continuidad

No quedan bloques pendientes de este rediseño de escritorio. La validación WebKit es simulada y no acredita el iPhone físico, Safari con teclado nativo, PWA instalada ni push. La siguiente revisión debe realizarse sobre el iPhone de Daniel después del aviso de cierre. No comprar tiempo de BrowserStack ni reactivar pruebas físicas o envíos por cuenta propia.

Las referencias detalladas de Figma, comportamiento y conservación de reglas están en `FIGMA_*.md`. Los estados anteriores se conservan como historial; esta entrega es el estado vigente.

