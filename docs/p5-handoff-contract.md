# P5 · Contrato operativo de handoffs

P5 convierte estado real del negocio en tareas P4. No crea alertas ni notificaciones.

Principios:
- un reconciliador central por agregado;
- `dedupe_key` determinístico: una condición = una tarea;
- tareas de sistema con `origin=workflow`;
- routing configurable sin inventar equipos/usuarios;
- cambios de negocio abren, actualizan, completan, cancelan o reabren la misma tarea;
- dependencias P4 bloquean auto-completado hasta quedar resueltas;
- bootstrap solo de trabajo vigente, sin inundar históricos entregados.

Rutas iniciales:
1. sales_supply_planning
2. sales_procurement_linkage
3. purchase_receipt
4. direct_fulfillment
5. prepare_load
6. shipment_cuba_documents
7. sales_invoice
8. invoice_collection
9. supplier_bill_payment

La configuración de equipo/responsable/prioridad/plazo se administra desde Mis tareas → Configurar handoffs y requiere `tasks.manage`.
