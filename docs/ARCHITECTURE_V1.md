# Export Platform — Arquitectura 1.0

## Objetivo

Diseñar la plataforma de Export MCA como un sistema modular, multiempresa, auditable y preparado para crecer desde un CRM interno hacia un portal de clientes, marketplace, PWA y futuras aplicaciones móviles.

## Principios

1. Ningún registro operativo se elimina físicamente; se desactiva o archiva.
2. Toda acción relevante genera auditoría.
3. Los estados son catálogos controlados, no texto libre.
4. Los permisos se asignan por capacidad concreta y se agrupan en roles.
5. Cada operación puede tener responsables distintos por área.
6. El portal del cliente y el CRM comparten la misma base de datos y API.
7. La arquitectura es multiempresa mediante `company_id`.

## Módulos

- Núcleo: empresas, usuarios, roles, permisos, configuración y auditoría.
- CRM: clientes, contactos, responsables y notas.
- Comercial: productos, publicaciones, marketplace, cotizaciones y reservas.
- Operaciones: operaciones, contenedores, bookings, B/L, tracking, liberación y entrega.
- Inventario: almacenes, existencias y movimientos.
- Finanzas: facturas, cobros, gastos, conciliación y utilidades.
- Portal del cliente: cuentas, acceso, documentos, tracking y notificaciones.
- Comunicaciones: push, correo y WhatsApp.
- Integraciones: ShipsGo, Twilio, Supabase y APIs externas.

## Flujo principal

Producto → Publicación → Cliente → Cotización/Venta → Factura → Pago interno → Autorización → Booking → Contenedor → Tracking → Liberación → Entrega → Cierre.

## Roles iniciales

- Superadministrador
- Administrador
- Comercial
- Logística
- Finanzas
- Operaciones Cuba
- Almacén
- Atención al cliente

## Permisos iniciales

- `customers.create`
- `customers.read`
- `customers.update`
- `customers.archive`
- `products.create`
- `products.update`
- `products.publish`
- `products.notify`
- `products.renotify`
- `operations.create`
- `operations.authorize`
- `operations.assign`
- `containers.create`
- `containers.release`
- `deliveries.confirm`
- `finance.read`
- `finance.write`
- `users.create`
- `users.assign_roles`
- `settings.manage`
- `audit.read`

## Reglas de asignación

Cada cliente puede tener responsables generales por área. Cada operación puede sobrescribir esas asignaciones. La asignación específica de la operación tiene prioridad.

## Publicaciones y notificaciones

Un producto puede estar en borrador, publicado sin notificar, publicado y notificado, renotificado, pausado, agotado o archivado. La renotificación crea una nueva campaña; nunca duplica el producto.

## Estados comerciales sugeridos

- draft
- upcoming
- awaiting_departure_update
- departure_confirmed
- in_transit
- available_in_cuba
- low_stock
- sold_out
- paused
- archived

## Portal del cliente

Cada empresa cliente podrá tener varios usuarios con contraseña y permisos diferenciados, por ejemplo compras, logística y finanzas. La autenticación se implementará con Supabase Auth y perfiles propios en la base de datos.

## Escalabilidad

La estructura evita acoplar el sistema a una sola empresa, interfaz o canal. Las tablas de alto volumen tendrán índices por `company_id`, fechas, estados y claves de relación. Las notificaciones, eventos y auditoría se diseñan como registros append-only.

## Siguiente implementación

1. Migración SQL del núcleo.
2. RLS y políticas de acceso.
3. Autenticación y perfiles.
4. Usuarios, roles y permisos.
5. Clientes y asignaciones.
6. Productos, publicaciones y notificaciones push.
7. Operaciones, contenedores, liberación y entrega.
