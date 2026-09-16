# Selección de Reportes durante una actualización

## Defecto confirmado
La repetición automática de PR #322 falló en DS-28: la factura de proveedor
SB-0002 estaba guardada, pero no se encontraba la columna AP actual en el lector.
La reproducción controlada en Actions 35146086517 retuvo una respuesta real de
/api/reports?dataset=invoices después de ejecutar SQL y pulsó supplier_bills.
El dataset seleccionado siguió siendo invoices. La pestaña se veía habilitada,
pero switchDataset descartaba el clic por state.loading. No era pérdida de datos.

## Corrección en el dueño existente
reports.js conserva la última selección y agrupa las lecturas solicitadas mientras
hay otra en curso. Descartar una respuesta anterior impide que repinte filas o
errores de la vista abandonada. Al terminar se consulta una sola vez la selección
y los filtros vigentes; una nueva invalidación durante esa lectura queda pendiente
para la siguiente. El mismo cierre atiende lecturas pendientes durante una
exportación CSV y conserva el nombre del dataset exportado.

Se preservan permisos, API, cálculos y formato de los reportes. No se añade otro
owner, observer o recarga de iframe. Sin migración ni cambios comerciales reales.

## Aceptación
- DS-28 incorpora el cruce exacto con respuesta HTTP real retenida; verifica la
  selección antes de liberar la respuesta y los dos saldos de 1050 después.
  La cadena continúa por aplicación, redistribución, pago y reverso hasta DS-33.
- Se amplía el gate existente del owner con seis regresiones: selección mientras
  carga, varias selecciones/filtros, error de vista abandonada, invalidación del
  mismo dataset, sesión retirada y selección durante CSV con nombre conservado.
- Se mantienen los ocho recorridos / dos motores de CI. Resultados exactos y
  publicación final en la PR. Datos de QA solo en PostgreSQL/PostgREST desechables.
