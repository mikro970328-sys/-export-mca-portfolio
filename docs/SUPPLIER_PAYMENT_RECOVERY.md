# Recuperación de pagos a proveedor

Corte: 2026-09-16. Base publicada PR #323, `1296968075ed1adce7a81b483fd65bd266999c2b`.
Rama `fix/supplier-payment-recovery`. La PR registra CI exacto, aplicación y publicación finales.

## Defecto demostrado antes del cambio

El recorrido comercial creó una factura real de proveedor de USD 250 sobre la
misma PO. Un único clic de pago de USD 40, destruyendo sus respuestas HTTP después
del commit, produjo seis pagos de 40 y dejó saldo 10. La red de Chromium reentregó
la petición; el rechazo siguiente por exceso de saldo ocultaba la multiplicación.
[Run de reproducción](https://github.com/mikro970328-sys/-export-mca-portfolio/actions/runs/35152111624):
head `1044f795f0d6842b4d98728a62e6dc7822a472f9`, job `104982694010`.
COM-01/13 pasaban y COM-14 exigía un solo movimiento. No ocurrió en producción.

## Corrección en los owners existentes

- Payables genera una identidad por formulario y la conserva tras errores; impide
  envíos simultáneos y cerrar mientras guarda. No pierde la confirmación si falla
  después el refresco. Una respuesta de pago revertido no se presenta como pago nuevo.
- La API conserva autorización vigente antes de SQL, valida UUID y envía la identidad.
  No escribe un segundo audit después del commit. Sin identidad de un cliente
  anterior genera una por petición: esa compatibilidad no deduplica reenvíos sin clave.
- Los RPC existentes register_supplier_payment y pay_supplier_bill_canonical
  serializan la misma clave con un advisory lock transaccional. Comparan acción,
  destino, importe, fecha, método, referencia, notas y actor. Conflicto significa
  rechazo; nunca se deduplica solo porque producto, importe o referencia coincidan.
- Ledger, aplicación directa y audit se confirman o revierten juntos. Un replay
  devuelve el mismo pago incluso tras liquidación, redistribución o reverso.
  No restaura aplicaciones ni revive dinero revertido. Identidad y payload inmutables.
- Nuevo formulario/identidad permite otro pago legítimo por el mismo importe.
  Si se cierra o recarga un formulario cuya confirmación se perdió, revisar el
  historial antes de crear otro: no se afirma recuperación entre dispositivos.
- Sin nuevos observers, wrappers, dependencias productivas ni tablas. Se conservan
  precisión de centavos, divisas, permisos y reglas de reverso/aplicación.

## Migración y despliegue compatible

`supabase/migrations/20260916212051_supplier_payment_retry_integrity.sql` fue generada con
`supabase@2.117.0 migration new supplier_payment_retry_integrity`
en run `35151851742`. El contenido preserva filas históricas: dos columnas
nullable y una clave única parcial. No modifica ni elimina pagos anteriores.

Preflight de catálogo: cero dependientes de los dos RPC que pasan de siete a
ocho argumentos; octavo opcional conserva llamadas anteriores. Solo service_role
puede ejecutarlos. Las tablas siguen sin INSERT/UPDATE/DELETE directo de ese rol.
El guard de mutación existente protege los nuevos campos.

Aplicar primero la migración validada y después desplegar por Git/Vercel.
Las llamadas antiguas sin clave NO emiten audit SQL: su API anterior conserva
su propio audit durante la transición. La API nueva siempre identifica y usa
audit SQL. API-26 verifica ambos contratos. Antes de aplicar hay que volver a
comprobar definición, dependencias, constraints y conteos; la presencia del
archivo no acredita aplicación remota. No hay rollback destructivo automático:
un rollback de frontend/API puede conservar el esquema compatible.

## Pruebas y evidencia

- API-19/26: parciales y liquidación completa, anticipo y aplicación posterior,
  igualdad legítima con otra clave, conflictos por cada campo/actor/acción,
  reverso, claves inválidas, permisos, rollback por audit fallido, inmutabilidad
  y compatibilidad de despliegue. API financiera: 26/26 en run `35153269309`.
- CON-13/16: conexiones PostgreSQL realmente bloqueadas entre sí, misma clave,
  conflicto y rollback de la primera transacción; un pago/audit o ningún fantasma.
  Matriz operador/HTTP: 27/27 en el mismo run.
- COM-14: navegador Chromium original, un pago de 40, saldo 210 y mismo ID al
  reintentar. Aprobó en run `35153269309`, job `104986539212`.
  SF-13 detectó una aserción de privilegios que aún nombraba la firma antigua;
  se actualiza a ocho argumentos y se añade comprobación del segundo RPC.
- COM-15/18 amplían el cierre: offline antes de enviar, anticipo 35 con confirmación
  perdida, distribución, lector actualizado, retirada/restauración de permiso
  con formulario abierto y liquidación 175 con respuesta perdida. Exigen AR/AP 0,
  caja entrante 400/saliente 250/neta 150, COGS real 250, gasto 50,
  contribución 100, stock 0 y tres pagos/audits atribuibles al operador.
  Resultado final de esta ampliación y matriz completa: consultar la PR.

Todas las pruebas comerciales usan bases desechables y cuentas artificiales.
Producción y Preview no reciben operaciones QA; Preview comparte base productiva.
No se ejecutan transferencias bancarias ni envíos a clientes. WebKit emulado no
certifica iPhone físico, PWA instalada o push, diferidos por Daniel.
