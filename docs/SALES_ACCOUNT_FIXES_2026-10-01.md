# Correcciones de ventas y eliminación de cuentas

Ventas permite introducir pallets y unidades por pallet para calcular la cantidad, o elegir cantidad directa. El selector de clientes usa filas compactas con empresa, contacto, NIT, importadoras, teléfono y correo; una sola fila conserva su altura. La búsqueda también admite teléfono y correo y descarta respuestas antiguas.

Una ruta de abastecimiento hereda los pallets de la venta, ajustados por la cantidad y el saldo pendiente. Los cambios manuales de pallets se conservan. Preparar factura y Facturar una venta muestran cantidad e importe acordado, importe de cada línea y total. Las facturas parciales ajustan el importe sin exigir reintroducir el precio. La vista redondea cada línea como PostgreSQL; las reglas financieras siguen en los RPC existentes.

El administrador maestro puede eliminar cuentas activas o inactivas escribiendo el nombre de usuario. Se protege su propia cuenta y cualquier cuenta maestra, tanto en la interfaz como en API y SQL. Se eliminan credenciales, perfil, dispositivos, notificaciones y membresías; las sesiones dejan de autenticar. Las tareas quedan disponibles para reasignación. El historial y los documentos financieros se conservan mediante referencias UUID sin credenciales en un esquema privado.

Figma: https://www.figma.com/design/aq38kVEYDEmmNlUOAOvfYg?node-id=152-4529

Verificación: `check-sales-entry-flow.mjs`, `check-account-deletion.mjs`, 33 casos de aceptación real de ventas/logística, 44 comprobaciones de presentación de Ventas, controles de permisos, sesiones, propiedad de interfaz y privilegios de base de datos. Las pruebas de eliminación usan una base aislada y cuentas ficticias. La migración de producción conserva las dos cuentas existentes, cinco proveedores, venta y factura; MariaF permanece inactiva.
