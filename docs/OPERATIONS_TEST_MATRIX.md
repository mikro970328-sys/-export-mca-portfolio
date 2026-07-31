# Expedientes — matriz de pruebas

## Propósito

Validar primero la línea base y después cualquier extracción o refactor. Las pruebas deben ejecutarse en Preview autenticada antes de considerar un merge a `main`.

## Datos de prueba

Usar únicamente registros QA autorizados. No eliminar expedientes, contenedores, clientes ni documentos reales.

## Matriz funcional

| ID | Escenario | Procedimiento | Resultado esperado |
|---|---|---|---|
| OP-001 | Abrir sección | Iniciar sesión y abrir “Expedientes de exportación” | Se muestra el formulario y el listado sin errores de consola |
| OP-002 | Selector de clientes | Comparar clientes disponibles con el módulo Clientes | El selector contiene los clientes cargados, sin duplicados |
| OP-003 | Crear expediente mínimo | Seleccionar cliente y crear sin mercancía ni contenedor | Se crea una sola operación y aparece un único mensaje de éxito |
| OP-004 | Cliente obligatorio | Intentar crear sin cliente | La operación no se crea y se muestra error comprensible |
| OP-005 | Crear con mercancía | Completar descripción, cantidad, unidad, costo y precio | Se crea un solo artículo asociado y los importes coinciden |
| OP-006 | Crear con contenedor | Introducir contenedor válido | Se crea o enlaza un shipment y la operación guarda `shipment_id` |
| OP-007 | Contenedor existente | Crear operación con número ya registrado | No se duplica el shipment existente |
| OP-008 | Normalización | Introducir contenedor con espacios o minúsculas | El vínculo usa el formato normalizado previsto por backend |
| OP-009 | Listado | Recargar expedientes | Orden descendente por creación y datos principales correctos |
| OP-010 | Abrir detalle | Pulsar “Abrir” | Modal con código, estado, cliente, logística, mercancía y totales |
| OP-011 | Totales | Usar una operación con costos, gastos y pagos | Venta, costos, utilidad y pendiente coinciden con datos fuente |
| OP-012 | Estado vacío | Probar cuenta sin operaciones o respuesta vacía | Mensaje “No hay expedientes registrados.” |
| OP-013 | Error GET | Simular fallo de `/api/operations` | El error se muestra en el área del listado, sin romper navegación |
| OP-014 | Error POST | Simular fallo de creación | No aparece éxito falso ni se limpia el formulario indebidamente |
| OP-015 | Doble clic | Pulsar dos veces rápidamente “Crear expediente” | Debe detectarse si existen duplicados; fase futura debe bloquear doble envío |
| OP-016 | Cambio de cliente | Crear o editar cliente y volver a Expedientes | Selector/listado se actualizan una sola vez |
| OP-017 | Aislamiento de Contenedores | Abrir y operar la sección Contenedores | Expedientes no agrega ni duplica acciones en esa tabla |
| OP-018 | Eliminación de shipment | Revisar botones de Contenedores | Existe como máximo un botón por fila y no depende del montaje de Expedientes |
| OP-019 | Navegación repetida | Alternar 10 veces entre secciones | No se duplican listeners, solicitudes ni elementos DOM |
| OP-020 | Sesión expirada | Abrir Expedientes con token inválido | Flujo de autenticación global actúa sin estado corrupto |

## Matriz responsive y PWA

| ID | Entorno | Verificación |
|---|---|---|
| OP-R01 | Escritorio Chrome | Formulario en dos columnas, listado usable y modal desplazable |
| OP-R02 | Ventana <= 900 px | Formulario en una columna y tabla con desplazamiento horizontal |
| OP-R03 | iPhone Safari | Campos, fechas, selects y botones accesibles sin desbordamiento crítico |
| OP-R04 | PWA instalada | Navegación y recarga funcionan igual que en navegador |
| OP-R05 | Reconexión | Abrir tras pérdida y recuperación de red | No se crean registros duplicados por reintentos manuales |

## Matriz de seguridad e integridad

| ID | Caso | Resultado requerido |
|---|---|---|
| OP-S01 | Texto con `<script>` en notas o descripción | Se muestra como texto; nunca se ejecuta código |
| OP-S02 | Usuario no autenticado | API rechaza todas las operaciones |
| OP-S03 | ID inexistente en GET detalle | Respuesta controlada y modal sin excepción |
| OP-S04 | PATCH con campos no permitidos | Campos ajenos no se persisten |
| OP-S05 | DELETE sobre operación relacionada | No ejecutar en producción; definir primero política y prueba aislada |
| OP-S06 | Fallo al crear artículo después de operación | Documentar si queda operación huérfana |
| OP-S07 | Fallo al crear shipment | Documentar estado parcial y posibilidad de recuperación |
| OP-S08 | Fallo de WhatsApp | La operación y shipment permanecen válidos; se registra fallo de notificación |

## Pruebas específicas de la extracción

Antes y después de mover código a `admin/operations-module.js`:

1. capturar número de solicitudes GET al entrar en Expedientes;
2. capturar estructura del DOM generado;
3. comparar payload exacto del POST;
4. comparar mensajes visibles;
5. comparar orden y contenido del listado;
6. confirmar ausencia de nuevos listeners duplicados;
7. confirmar que `erp-core.js` ya no toca `#shipments`;
8. confirmar que el script de operaciones se carga una sola vez y de forma explícita.

## Criterios de bloqueo

No se autoriza merge si ocurre cualquiera de estos casos:

- duplicación de operaciones, artículos o shipments;
- cambio de contrato con Supabase sin migración aprobada;
- pérdida de datos visibles;
- errores de consola al montar la sección;
- regresión en Clientes o Contenedores;
- exposición de acciones destructivas sin confirmación y auditoría;
- diferencia no explicada entre Preview y producción.

## Evidencia requerida

Para cerrar la fase deben quedar registrados:

- commit SHA validado;
- URL y estado de Vercel Preview;
- resultado de CI;
- navegadores/dispositivos probados;
- IDs QA utilizados;
- incidencias encontradas;
- confirmación explícita de que `main` no fue modificado durante la auditoría.
