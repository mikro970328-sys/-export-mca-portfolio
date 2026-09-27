(() => {
  'use strict';
  if (window.ExportMcaHelpContent) return;
  window.ExportMcaHelpContent = Object.freeze({
  "version": "2026-09-26",
  "articles": [
    {
      "id": "empezar",
      "category": "Primeros pasos",
      "title": "Tu primer día en el ERP",
      "summary": "Prepara tu cuenta y aprende el orden de trabajo.",
      "section": "accountSection",
      "steps": [
        "Entra con tu usuario personal. Cada integrante del equipo debe tener su propia cuenta.",
        "Revisa Mi cuenta y pide al administrador los permisos correspondientes a tu función. Los módulos visibles dependen de esos permisos.",
        "Antes de crear operaciones, confirma que existen el cliente, proveedor y producto correctos. Evita duplicarlos por diferencias de escritura.",
        "Define el recorrido de la mercancía: por almacén o Direct Ship. Esa decisión cambia la recepción y el despacho.",
        "Abre Mis tareas y revisa los avisos antes de empezar. Después entra al módulo de la operación y comprueba su estado actual."
      ],
      "result": "Puedes identificar dónde trabajar y qué datos necesitas antes de guardar.",
      "note": "Una guía explica una acción, pero no concede permiso para ejecutarla.",
      "related": [
        "recorrido-almacen",
        "recorrido-directo",
        "equipo",
        "guardar"
      ],
      "tags": "inicio bienvenida tutorial aprender usar ERP equipo"
    },
    {
      "id": "recorrido-almacen",
      "category": "Primeros pasos",
      "title": "Recorrido completo: mercancía por almacén",
      "summary": "Desde la compra hasta el despacho y el cobro.",
      "section": "purchasesSection",
      "steps": [
        "Prepara proveedor, producto y almacén activo. Crea la compra con destino a ese almacén y revisa cantidades, pallets, moneda y total.",
        "Emite o confirma la compra según las acciones disponibles. Cuando llegue físicamente la mercancía, registra la recepción desde la compra para conservar su vínculo.",
        "Comprueba el WR y las existencias. Una compra por sí sola no suma inventario.",
        "Crea y confirma la venta. En su origen o abastecimiento, vincula la mercancía del almacén y prepara el cargue correspondiente.",
        "Revisa y reserva el cargue. Despacha únicamente cuando la salida real corresponda; verifica el contenedor y los vínculos generados.",
        "Completa el seguimiento y los documentos. Emite la factura que corresponda y registra el cobro recibido.",
        "Registra la factura y el pago del proveedor, junto con los gastos asociados. Concilia saldos y rentabilidad en Reportes."
      ],
      "result": "La compra, recepción, venta, cargue, documentos y movimientos financieros quedan relacionados.",
      "note": "No crees un segundo WR manual para mercancía que ya recibiste desde la compra.",
      "related": [
        "compras",
        "recepciones",
        "inventario",
        "cargues",
        "facturas",
        "proveedores-pagos"
      ],
      "tags": "flujo completo almacen compra venta recepcion WR despacho cobrar"
    },
    {
      "id": "recorrido-directo",
      "category": "Primeros pasos",
      "title": "Recorrido completo: Direct Ship",
      "summary": "Vende mercancía que no entra a tu almacén.",
      "section": "salesSection",
      "steps": [
        "Crea una compra con destino Direct Ship, sin almacén. Comprueba proveedor, producto, cantidades y costo.",
        "Si la compra ofrece Crear venta, utiliza esa acción para iniciar la venta vinculada. También puedes preparar la venta y configurar su origen directo.",
        "Revisa cliente, precio de venta, moneda y condición de nacionalización. Confirma la venta cuando los datos sean correctos.",
        "Desde Origen / Direct Ship de la venta, vincula la compra y la cantidad que abastece la venta. Verifica los saldos disponibles de ambas líneas.",
        "Prepara el despacho directo y sus datos de contenedor según las acciones habilitadas. No registres una recepción WR para este recorrido.",
        "Completa Tracking y documentos, factura, cobro, proveedor y gastos. Revisa el costo reconocido y el margen después del cumplimiento."
      ],
      "result": "La mercancía queda trazada desde el proveedor al cliente sin inflar existencias propias.",
      "note": "No convertir una compra en Direct Ship cambiando datos después de comprometerla: revisa primero sus vínculos y las restricciones que muestra el ERP.",
      "related": [
        "compras",
        "ventas",
        "tracking",
        "facturas",
        "margen"
      ],
      "tags": "envio directo direct ship origen abastecimiento no almacen"
    },
    {
      "id": "rutina",
      "category": "Primeros pasos",
      "title": "Rutina diaria y cierre de operaciones",
      "summary": "Qué revisar al comenzar y antes de terminar la jornada.",
      "section": "tasksSection",
      "steps": [
        "Revisa Mis tareas: vencimientos, prioridades, bloqueos y responsables. Abre el registro relacionado para conocer la situación.",
        "Revisa Centro de alertas y Notificaciones. Distingue una alerta pendiente de una notificación que ya leíste.",
        "Actualiza únicamente los hechos confirmados: mercancía recibida, salida, llegada, descarga, liberación, entrega y dinero recibido o pagado.",
        "Antes de cerrar, comprueba cobros pendientes, documentos faltantes y operaciones con costo incompleto.",
        "Deja asignado el próximo paso con responsable y fecha. Completa una tarea solo cuando el trabajo se haya realizado."
      ],
      "result": "Cada operación tiene un estado y un siguiente responsable claros.",
      "note": "Leer o descartar un aviso no completa por sí mismo el trabajo que lo originó.",
      "related": [
        "tareas",
        "avisos",
        "reportes"
      ],
      "tags": "diario jornada cierre pendientes"
    },
    {
      "id": "guardar",
      "category": "Primeros pasos",
      "title": "Guardar, corregir y evitar duplicados",
      "summary": "Cómo saber si una operación realmente quedó registrada.",
      "section": "",
      "steps": [
        "Completa los campos requeridos y revisa unidades, moneda, contraparte y fecha antes de confirmar.",
        "Pulsa Guardar una vez y espera el resultado. Conserva el formulario si aparece un error de validación.",
        "Comprueba el mensaje final y abre el registro guardado. Verifica su número, estado, líneas e importe.",
        "Si hubo una desconexión o un tiempo de espera, busca primero la operación por su referencia: pudo haberse guardado aunque no recibieras la respuesta.",
        "Si el registro existe, continúa desde él. Si no aparece, conserva tus datos y utiliza la recuperación o el reintento del mismo formulario cuando esté disponible."
      ],
      "result": "Existe un único registro comprobado; no dependes solo de haber pulsado un botón.",
      "note": "La recuperación de borrador no significa que una operación esté guardada. No cierres ni borres los datos del navegador mientras recuperas un formulario.",
      "related": [
        "error-guardar",
        "duplicados"
      ],
      "tags": "autosave autoguardado borrador guardar recuperar recargar duplicado"
    },
    {
      "id": "clientes",
      "category": "Ventas y clientes",
      "title": "Crear y mantener clientes e importadoras",
      "summary": "Prepara el cliente con su NIT y evita crear registros repetidos.",
      "section": "clientsSection",
      "steps": [
        "Abre Comercial → Clientes y busca por nombre, empresa, contacto o NIT antes de crear otro registro.",
        "Pulsa Nuevo cliente para abrir la ventana de registro. Al guardar, la ventana se cierra y el cliente aparece en el directorio. Cerrar sin guardar conserva lo escrito para continuar. El campo Empresa o MIPYME guarda el nombre comercial en un solo lugar; añade el NIT si está disponible.",
        "El ERP avisa si el NIT ya está asociado a otro cliente, incluso cuando cambian espacios, puntos, guiones o barras. Abre el registro existente si es la misma empresa.",
        "Abre la ficha y revisa las importadoras asociadas al cliente cuando correspondan a la operación.",
        "Si cambió un dato, edita el cliente existente y verifica después su ficha. No crees un cliente nuevo para corregir un teléfono.",
        "La bienvenida por WhatsApp es una acción independiente: revisa el destinatario antes de enviarla o reenviarla."
      ],
      "result": "El cliente queda disponible en ventas y el NIT ayuda a reconocer duplicados.",
      "note": "Guardar un cliente no envía automáticamente una bienvenida. Enviar o reenviar sí contacta al destinatario.",
      "related": [
        "ventas",
        "whatsapp"
      ],
      "tags": "cliente NIT empresa MIPYME importador importadora contacto bienvenida duplicado"
    },
    {
      "id": "ventas",
      "category": "Ventas y clientes",
      "title": "Crear y confirmar una venta",
      "summary": "Registra el compromiso con el cliente, aunque todavía no hayas comprado la mercancía.",
      "section": "salesSection",
      "steps": [
        "En Comercial → Ventas, abre Nueva venta. La lista separa las ventas En marcha del Historial; abre una venta para continuar trabajando dentro de su espacio.",
        "Selecciona al cliente. Si aún no existe, pulsa + Nuevo cliente desde la venta; si ya abriste la lista, la misma opción está dentro del selector. Al guardar queda seleccionado sin perder los datos de la venta; el NIT también detecta duplicados. Esta opción requiere permiso para gestionar clientes.",
        "Añade la mercancía y la cantidad. Si trabajarás por encargo y todavía no existe en el catálogo, usa Agregar mercancía: se registra en el catálogo, pero no crea existencias ni exige comprar antes. Después registra la compra real y vincúlala desde Origen / abastecimiento.",
        "Escribe el t