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
      "summary": "Prepara el destinatario comercial antes de vender.",
      "section": "clientsSection",
      "steps": [
        "Abre Comercial → Clientes y busca por nombre, empresa o contacto antes de crear otro registro.",
        "Utiliza Nuevo cliente para registrar sus datos. Revisa teléfono, correo y empresa antes de guardar.",
        "Abre la ficha y revisa las importadoras asociadas al cliente cuando correspondan a la operación.",
        "Si cambió un dato, edita el cliente existente y verifica después su ficha. No crees un cliente nuevo para corregir un teléfono.",
        "La bienvenida por WhatsApp es una acción independiente: revisa el destinatario antes de enviarla o reenviarla."
      ],
      "result": "El cliente queda disponible para ventas y seguimiento con sus datos correctos.",
      "note": "Guardar un cliente no envía automáticamente una bienvenida. Enviar o reenviar sí contacta al destinatario.",
      "related": [
        "ventas",
        "whatsapp"
      ],
      "tags": "cliente importador importadora contacto bienvenida"
    },
    {
      "id": "ventas",
      "category": "Ventas y clientes",
      "title": "Crear y confirmar una venta",
      "summary": "Registra qué vendes, a quién y cómo se abastecerá.",
      "section": "salesSection",
      "steps": [
        "En Comercial → Ventas, inicia una venta y selecciona el cliente correcto.",
        "Añade productos, cantidades, unidad, pallets si corresponden y precio o total comercial. Comprueba la moneda y la condición de nacionalización.",
        "Guarda y revisa el resumen antes de confirmar. Una venta confirmada puede tener restricciones para cambiar lo ya comprometido.",
        "En Origen / abastecimiento, decide entre existencias, compra destinada a almacén o Direct Ship. Vincula únicamente la cantidad disponible.",
        "Sigue las acciones habilitadas para preparar el cumplimiento y la facturación. Revisa los documentos y saldos relacionados desde el detalle."
      ],
      "result": "La venta tiene líneas coherentes y una ruta de abastecimiento identificada.",
      "note": "Confirmar una venta no equivale a recibir el dinero ni a despachar la mercancía.",
      "related": [
        "recorrido-almacen",
        "recorrido-directo",
        "facturas",
        "anticipos",
        "editar-cancelar"
      ],
      "tags": "venta confirmar nacionalizado nacionalizacion origen abastecimiento"
    },
    {
      "id": "publicaciones",
      "category": "Ventas y clientes",
      "title": "Preparar publicaciones comerciales",
      "summary": "Crea y revisa una oferta antes de hacerla visible.",
      "section": "publicationsSection",
      "steps": [
        "En Comercial → Publicaciones comerciales, prepara el título, descripción, precio y los datos que ofrece el formulario.",
        "Añade una imagen propia de la oferta y verifica que se vea correctamente.",
        "Revisa contenido, disponibilidad y condiciones comerciales. Conserva el borrador si todavía necesita aprobación.",
        "Utiliza la acción de publicación cuando corresponda. Comprueba el estado y su presentación pública.",
        "Si cambia la oferta, edita o retira la publicación mediante sus acciones disponibles."
      ],
      "result": "La oferta publicada coincide con lo que el equipo puede vender.",
      "note": "Una publicación no crea por sí sola una venta, una reserva ni una factura.",
      "related": [
        "ventas"
      ],
      "tags": "publicar catalogo oferta imagen anuncio"
    },
    {
      "id": "proveedores",
      "category": "Compras y almacén",
      "title": "Registrar proveedores",
      "summary": "Mantén el origen comercial de compras y cuentas por pagar.",
      "section": "suppliersSection",
      "steps": [
        "Abre Compras → Proveedores y busca si el proveedor ya existe.",
        "Crea su ficha con nombre y los datos de contacto y fiscales disponibles. Comprueba que no se trate de una sucursal o contraparte distinta.",
        "Guarda y revisa la ficha antes de seleccionarla en una compra.",
        "Utiliza los estados activo/inactivo según corresponda. Conserva el historial de proveedores con operaciones previas."
      ],
      "result": "El proveedor correcto aparece disponible en compras y finanzas.",
      "note": "Un proveedor inactivo puede impedir nuevas operaciones; pide al responsable revisar su estado en lugar de crear un duplicado.",
      "related": [
        "compras",
        "proveedores-pagos"
      ],
      "tags": "proveedor suplidor supplier alta inactivo"
    },
    {
      "id": "productos",
      "category": "Compras y almacén",
      "title": "Productos, unidades y pallets",
      "summary": "Evita diferencias entre unidades físicas y cantidades comerciales.",
      "section": "productsSection",
      "steps": [
        "Abre Almacén → Productos y busca por SKU o nombre.",
        "Registra o revisa la unidad base: por ejemplo, cajas, paneles, sacos o unidades. La unidad debe representar la mercancía real.",
        "Configura las unidades por pallet cuando corresponda y comprueba las medidas que usarás en compras y recepción.",
        "Antes de guardar una operación, verifica que pallets × unidades por pallet coincida con la cantidad cuando el formulario exige esa relación.",
        "Corrige el catálogo antes de usarlo en nuevas operaciones; los registros comprometidos pueden conservar medidas históricas."
      ],
      "result": "Compras, recepción, existencias y ventas describen la misma cantidad física.",
      "note": "No cambies de cajas a unidades sin convertir y comprobar las cantidades afectadas.",
      "related": [
        "cantidades",
        "compras",
        "recepciones"
      ],
      "tags": "producto SKU unidad medida pallet paleta cajas paneles"
    },
    {
      "id": "almacenes",
      "category": "Compras y almacén",
      "title": "Configurar un almacén",
      "summary": "Requisito para recibir y controlar existencias propias.",
      "section": "warehouseSection",
      "steps": [
        "En Almacén → Recepciones (WR), abre la pestaña Almacenes.",
        "Registra el código, nombre y ubicación del almacén real. Verifica que su estado sea activo.",
        "Guarda y comprueba que pueda seleccionarse como destino de una compra o una recepción.",
        "Si no puedes crear o activar almacenes, solicita al administrador el permiso correspondiente.",
        "Para mercancía que nunca entra a tu almacén, utiliza el recorrido Direct Ship."
      ],
      "result": "El almacén está disponible para el circuito de recepción e inventario.",
      "note": "No crees almacenes ficticios para completar un formulario de envío directo.",
      "related": [
        "recepciones",
        "recorrido-directo"
      ],
      "tags": "almacen configurar vacio no aparece destino"
    },
    {
      "id": "compras",
      "category": "Compras y almacén",
      "title": "Crear, confirmar y recibir una compra",
      "summary": "Orden de compra, destino y seguimiento de lo recibido.",
      "section": "purchasesSection",
      "steps": [
        "Abre Compras → Compras y crea la orden con proveedor y moneda correctos.",
        "Define el destino: almacén activo o Direct Ship. Añade productos, cantidades, pallets y costo total de cada línea.",
        "Guarda y revisa la orden. Utiliza Emitir y Confirmar según las acciones que permita su estado.",
        "Si el destino es almacén, utiliza Recibir cuando llegue mercancía. Introduce solo lo recibido realmente, aunque sea una entrega parcial.",
        "Comprueba los WR y saldos pendientes desde la compra. Registra la factura del proveedor en su circuito financiero.",
        "Si el destino es Direct Ship, continúa con Crear venta o el origen de la venta; no intentes crear un WR."
      ],
      "result": "La orden conserva su destino, cantidades comprometidas y relaciones posteriores.",
      "note": "Recibir más de lo ordenado exige una comprobación y confirmación explícita; no lo utilices para corregir un error de captura sin revisarlo.",
      "related": [
        "recepciones",
        "recorrido-directo",
        "editar-cancelar",
        "proveedores-pagos"
      ],
      "tags": "PO orden compra emitir confirmar recibir costo total"
    },
    {
      "id": "recepciones",
      "category": "Compras y almacén",
      "title": "Registrar una recepción WR",
      "summary": "Registra la entrada física y conserva lotes y referencias.",
      "section": "warehouseSection",
      "steps": [
        "Si recibes una compra existente, inicia la recepción desde esa compra para conservar la relación. Para una entrada independiente utiliza Registrar entrada WR.",
        "Selecciona el almacén y proveedor cuando corresponda. Revisa fecha, referencias, productos y lotes.",
        "Introduce cantidades, unidades y pallets realmente recibidos. Verifica pesos y las relaciones que exige el formulario.",
        "Guarda una sola vez y comprueba el número WR asignado. Revisa sus líneas y el saldo pendiente de la compra si está vinculada.",
        "Consulta Existencias para confirmar el movimiento. Si el envío fue parcial, registra la próxima entrega cuando llegue, no antes."
      ],
      "result": "El WR representa una entrada física trazable y suma mercancía a las existencias.",
      "note": "Un WR con reservas, cargues o historial comprometido puede impedir su anulación. Primero revisa esos vínculos.",
      "related": [
        "inventario",
        "cantidades",
        "editar-cancelar",
        "error-guardar"
      ],
      "tags": "WR warehouse receipt recepcion entrada lote recibido parcial"
    },
    {
      "id": "inventario",
      "category": "Compras y almacén",
      "title": "Leer existencias y reservas",
      "summary": "Diferencia lo físico, lo reservado y lo disponible.",
      "section": "inventorySection",
      "steps": [
        "Abre Almacén → Existencias y filtra por almacén y producto.",
        "Comprueba el origen WR o lote de cada saldo. Una compra sin recepción no crea existencias.",
        "Distingue existencia física, cantidad reservada y disponibilidad: reservar compromete mercancía sin representar todavía una salida física.",
        "Antes de preparar otro cargue, revisa la cantidad disponible del origen que vas a usar.",
        "Si hay una diferencia, consulta los movimientos y el cargue relacionado antes de alterar la recepción."
      ],
      "result": "Puedes identificar qué mercancía hay y cuál sigue disponible para otra operación.",
      "note": "Direct Ship no produce existencias propias. No añadas un WR para hacer aparecer ese envío en inventario.",
      "related": [
        "cargues",
        "stock-no-aparece"
      ],
      "tags": "stock inventario disponible reservado reserva existencias saldo"
    },
    {
      "id": "cargues",
      "category": "Logística y documentos",
      "title": "Preparar, reservar y despachar un cargue",
      "summary": "Asigna mercancía del almacén a una salida.",
      "section": "loadsSection",
      "steps": [
        "En Logística → Cargues, prepara el cargue desde la venta o con las referencias correspondientes.",
        "Selecciona el almacén y los orígenes WR que abastecen la salida. Verifica que exista disponibilidad y que las cantidades correspondan a la venta.",
        "Revisa el plan y utiliza la reserva cuando esté habilitada. Confirma que el estado y los saldos reflejen el compromiso.",
        "Comprueba los datos del contenedor y la documentación necesaria antes de despachar.",
        "Ejecuta el despacho cuando la salida física corresponda y verifica los vínculos en Tracking. Si no puede continuar, revisa la razón que muestra el ERP."
      ],
      "result": "La salida queda vinculada a sus orígenes, venta y contenedor.",
      "note": "No despaches para probar el botón: la acción puede afectar inventario y cumplimiento.",
      "related": [
        "inventario",
        "tracking",
        "documentos",
        "editar-cancelar"
      ],
      "tags": "cargue carga reservar despachar reserva contenedor"
    },
    {
      "id": "tracking",
      "category": "Logística y documentos",
      "title": "Registrar contenedores y actualizar Tracking",
      "summary": "Conserva hechos, fechas y responsables del seguimiento.",
      "section": "containersSection",
      "steps": [
        "Busca el contenedor en Tracking antes de registrarlo de nuevo. Revisa también los filtros de activos, entregados y todos.",
        "Si viene de un cargue o despacho directo, continúa desde su relación existente. Usa Registrar contenedor para el caso independiente que corresponda.",
        "Comprueba cliente, importadora, número de contenedor, booking, B/L y demás datos de la operación.",
        "Actualiza el evento real de seguimiento y su fecha: carga, salida, llegada, descarga, liberación o entrega, según las acciones disponibles.",
        "Revisa el historial y los documentos. Antes de liberar o entregar, comprueba los requisitos y el estado que exige el sistema."
      ],
      "result": "El historial refleja la situación conocida de la mercancía.",
      "note": "El seguimiento se actualiza en el ERP a partir de información confirmada. Los hitos de salida y liberación pueden generar WhatsApp.",
      "related": [
        "documentos",
        "whatsapp",
        "avisos"
      ],
      "tags": "tracking seguimiento contenedor booking BL BOL zarpe llegada liberacion entregar"
    },
    {
      "id": "documentos",
      "category": "Logística y documentos",
      "title": "Documentos, factura comercial y packing list",
      "summary": "Reúne los archivos en la operación que les corresponde.",
      "section": "containersSection",
      "steps": [
        "Abre el contenedor u operación relacionada y entra a sus documentos.",
        "Selecciona el tipo correcto y comprueba que el archivo corresponde al cliente, contenedor y B/L indicados.",
        "Carga el documento o utiliza la generación comercial disponible desde la venta, factura o cargue relacionado.",
        "Abre o descarga el resultado y verifica nombre, contenido, cantidades y referencias. No basta con que aparezca un archivo adjunto.",
        "Revisa los requisitos pendientes de documentación antes de continuar con liberación u otras acciones restringidas."
      ],
      "result": "Los documentos están ligados a su operación y pueden revisarse antes del siguiente paso.",
      "note": "Una factura comercial generada o una proforma no equivalen por sí solas a un cobro registrado.",
      "related": [
        "archivo-error",
        "proformas",
        "facturas"
      ],
      "tags": "documento archivo PDF packing list factura comercial Cuba BL BOL adjuntar subir descargar"
    },
    {
      "id": "facturas",
      "category": "Finanzas",
      "title": "Emitir facturas y registrar cobros",
      "summary": "Diferencia facturación, saldo pendiente y dinero recibido.",
      "section": "invoicesSection",
      "steps": [
        "Abre Finanzas → Facturación y prepara la factura desde la venta que corresponda.",
        "Revisa cliente, moneda, fecha, vencimiento y cantidades disponibles para facturar. Comprueba el total antes de emitir.",
        "Emite la factura cuando sea correcta. Una factura emitida conserva restricciones para proteger su historial.",
        "Registra un cobro solo después de recibir el dinero. Comprueba importe, fecha, método y referencia; puede ser parcial.",
        "Abre la factura y revisa cobros y saldo. Si utilizas un anticipo, aplícalo mediante su acción correspondiente para no duplicar caja."
      ],
      "result": "La factura muestra lo emitido, lo cobrado y el saldo que queda pendiente.",
      "note": "Una factura emitida no significa que esté pagada. No repitas el cobro cuando una respuesta se demore sin consultar antes su historial.",
      "related": [
        "anticipos",
        "reversos",
        "reportes",
        "duplicados"
      ],
      "tags": "factura factura vencida cobro cobrar pago cliente saldo parcial emitir crear guardar nueva"
    },
    {
      "id": "anticipos",
      "category": "Finanzas",
      "title": "Anticipos, aplicaciones y devoluciones",
      "summary": "Gestiona dinero recibido antes de completar la facturación.",
      "section": "salesSection",
      "steps": [
        "Abre las acciones financieras del cliente o la venta y registra el anticipo recibido con la moneda y la referencia correctas.",
        "Comprueba su saldo disponible antes de aplicarlo a una factura compatible.",
        "Aplica únicamente el importe permitido. La aplicación reduce saldos; no representa una nueva entrada de dinero.",
        "Si devuelves dinero al cliente, registra la devolución real desde el anticipo y comprueba su saldo restante.",
        "Para corregir un movimiento, utiliza el reverso habilitado con su motivo y revisa el historial."
      ],
      "result": "El dinero recibido se cuenta una vez y sus aplicaciones y devoluciones quedan trazadas.",
      "note": "No mezcles clientes, ventas o monedas para forzar una aplicación.",
      "related": [
        "facturas",
        "reversos",
        "reportes"
      ],
      "tags": "anticipo adelanto saldo aplicar aplicacion reembolso devolucion"
    },
    {
      "id": "proformas",
      "category": "Finanzas",
      "title": "Proformas y documentos previos",
      "summary": "Prepara una propuesta sin confundirla con una factura cobrada.",
      "section": "salesSection",
      "steps": [
        "Abre la venta y utiliza la opción de proforma disponible.",
        "Revisa cliente, productos, cantidades, precios y condiciones antes de emitir el documento.",
        "Comprueba el archivo generado y su referencia. Conserva la versión que corresponda a la propuesta.",
        "Cuando llegue el momento de facturar o cobrar, utiliza las acciones de factura o anticipo correspondientes."
      ],
      "result": "Tienes un documento de propuesta revisado sin registrar cobros inexistentes.",
      "note": "La proforma no crea por sí misma una cuenta por cobrar ni una entrada de caja.",
      "related": [
        "ventas",
        "facturas",
        "anticipos"
      ],
      "tags": "proforma cotizacion propuesta presupuesto"
    },
    {
      "id": "proveedores-pagos",
      "category": "Finanzas",
      "title": "Facturas y pagos a proveedores",
      "summary": "Controla lo que debes y lo que ya pagaste.",
      "section": "payablesSection",
      "steps": [
        "Abre Finanzas → Cuentas por pagar y registra la factura del proveedor, vinculada a la compra cuando corresponda.",
        "Comprueba proveedor, moneda, fecha, vencimiento, número de factura e importe total. Revisa las líneas antes de contabilizar.",
        "Registra el pago real y sus referencias. Puede ser parcial o quedar sin aplicar, según el flujo disponible.",
        "Si el pago está sin aplicar, distribúyelo entre facturas compatibles y verifica que no exceda los saldos.",
        "Revisa el saldo de la factura, las aplicaciones y el historial. Corrige con las acciones de reverso autorizadas, conservando el motivo."
      ],
      "result": "La deuda y los pagos del proveedor quedan conciliados y relacionados con su compra.",
      "note": "Cancelar una compra no elimina automáticamente su historial financiero ni devuelve dinero.",
      "related": [
        "compras",
        "reversos",
        "reportes"
      ],
      "tags": "AP cuentas por pagar factura proveedor pago aplicar contabilizar"
    },
    {
      "id": "gastos",
      "category": "Finanzas",
      "title": "Registrar y distribuir gastos",
      "summary": "Asigna los costos a las operaciones correctas.",
      "section": "costsSection",
      "steps": [
        "Abre Finanzas → Costos y rentabilidad y prepara el gasto con categoría, etapa, fecha, moneda e importe.",
        "Selecciona el proveedor y referencia cuando corresponda. Distingue este gasto del costo de la mercancía para no contabilizarlo dos veces.",
        "Distribuye el importe entre las compras, ventas, cargues o contenedores relacionados que permita el formulario.",
        "Verifica que la suma distribuida coincida con el total antes de contabilizar.",
        "Después de guardar, revisa estado, asignaciones y su efecto en el reporte correspondiente. Para corregir, utiliza la revisión o anulación disponible."
      ],
      "result": "El gasto queda asignado y puede incorporarse al análisis de la operación.",
      "note": "Un importe sin distribuir completamente puede impedir contabilizar. No cambies la moneda solo para hacer coincidir un margen.",
      "related": [
        "margen",
        "reportes",
        "reversos"
      ],
      "tags": "gasto costo flete distribucion asignacion rentabilidad contabilizar"
    },
    {
      "id": "margen",
      "category": "Finanzas",
      "title": "Entender un margen vacío o un costo incompleto",
      "summary": "Qué revisar antes de tomar una cifra como ganancia definitiva.",
      "section": "reportsSection",
      "steps": [
        "Revisa el estado del cumplimiento: vender o emitir una factura no siempre significa que la mercancía ya fue despachada.",
        "Comprueba que el origen de la mercancía esté vinculado a la venta y que sus cantidades correspondan a lo cumplido.",
        "Revisa el costo de compra o de la factura del proveedor y los gastos contabilizados y asignados.",
        "Comprueba las monedas. El ERP no debe presentar una comparación automática como si existiera un tipo de cambio que no fue definido.",
        "Si aparece costo incompleto o sin cumplimiento, completa el paso real pendiente o solicita revisión al responsable financiero."
      ],
      "result": "Puedes distinguir un dato pendiente de una pérdida o una ganancia confirmada.",
      "note": "No introduzcas un costo ficticio ni cambies estados físicos para hacer desaparecer una advertencia.",
      "related": [
        "gastos",
        "proveedores-pagos",
        "recorrido-directo"
      ],
      "tags": "COGS incomplete_cogs margen vacio cero ganancia utilidad costo incompleto rentabilidad"
    },
    {
      "id": "reportes",
      "category": "Finanzas",
      "title": "Consultar y conciliar reportes",
      "summary": "Lee saldos, caja y rentabilidad con los filtros correctos.",
      "section": "reportsSection",
      "steps": [
        "Abre Finanzas → Reportes y elige el conjunto de información que necesitas.",
        "Revisa filtros de fecha, moneda, cliente, proveedor y producto antes de interpretar el resultado.",
        "Distingue caja por fecha de movimiento de saldos actuales por cobrar o pagar. Un saldo actual puede proceder de una operación anterior al período consultado.",
        "Comprueba si el reporte advierte costos incompletos o monedas no comparables. Consulta el documento de origen antes de sacar una conclusión.",
        "Exporta con los filtros revisados y contrasta cobros, pagos, anticipos y devoluciones. Aplicar un anticipo no debe sumarse como dinero nuevo."
      ],
      "result": "El resultado tiene un período y alcance claros y puede contrastarse con sus documentos.",
      "note": "Las cifras del ERP dependen de que todas las operaciones reales se registren correctamente.",
      "related": [
        "facturas",
        "proveedores-pagos",
        "margen"
      ],
      "tags": "reportes exportar CSV caja saldo dashboard filtros moneda"
    },
    {
      "id": "reversos",
      "category": "Finanzas",
      "title": "Corregir cobros, pagos y notas de crédito",
      "summary": "Mantén el historial al corregir un movimiento financiero.",
      "section": "invoicesSection",
      "steps": [
        "Abre el movimiento original y confirma importe, moneda, contraparte y motivo del error.",
        "Comprueba sus aplicaciones y documentos relacionados antes de intentar revertirlo.",
        "Utiliza la acción de reverso, devolución o nota de crédito que corresponda al caso y esté habilitada. Lee su efecto antes de confirmar.",
        "Indica el motivo real y comprueba después el saldo y el historial.",
        "Si existen dependencias o un estado que impide la acción, detente y solicita revisión del administrador o responsable financiero."
      ],
      "result": "La corrección conserva el movimiento original y deja una explicación verificable.",
      "note": "No registres un segundo cobro o pago contrario como sustituto improvisado de una corrección. Cancelar una venta no equivale a reembolsar dinero.",
      "related": [
        "editar-cancelar",
        "facturas",
        "anticipos",
        "proveedores-pagos"
      ],
      "tags": "revertir reverso nota credito anular reembolso corregir pago"
    },
    {
      "id": "equipo",
      "category": "Equipo y avisos",
      "title": "Crear usuarios y asignar permisos",
      "summary": "Cada integrante trabaja con una cuenta y un alcance definidos.",
      "section": "adminsSection",
      "steps": [
        "Con una cuenta autorizada, abre Administración → Usuarios y acceso.",
        "Prepara el rol con los permisos de consulta y gestión que necesita esa función. Distingue ver información de modificarla.",
        "Crea la cuenta de la persona y asígnale el rol. Entrega sus credenciales por un canal privado.",
        "Configura equipos y miembros si repartirás trabajo por equipos. Un registro en Trabajadores no sustituye una cuenta de acceso.",
        "Comprueba con esa persona que ve los módulos necesarios y que no puede ejecutar acciones fuera de su responsabilidad.",
        "Cuando cambie de función o salga del equipo, ajusta permisos, desactiva la cuenta o revoca su sesión mediante las acciones disponibles."
      ],
      "result": "Cada usuario puede trabajar con permisos identificables y trazabilidad individual.",
      "note": "No compartas la cuenta maestra. Esta guía no permite saltarse permisos ni recuperar contraseñas de otros usuarios.",
      "related": [
        "cuenta",
        "tareas",
        "rutas",
        "permisos"
      ],
      "tags": "usuarios acceso equipo crear usuario rol permiso administrador cuatro personas"
    },
    {
      "id": "cuenta",
      "category": "Equipo y avisos",
      "title": "Mi cuenta, contraseña y sesión",
      "summary": "Mantén tu acceso personal y reconoce una sesión revocada.",
      "section": "accountSection",
      "steps": [
        "Abre Administración → Mi cuenta y comprueba tus datos personales.",
        "Para cambiar la contraseña, utiliza el formulario de tu cuenta y los requisitos que muestra. El mínimo al establecerla es de diez caracteres.",
        "Después de un cambio de contraseña o de una revocación puede ser necesario iniciar sesión de nuevo.",
        "Cierra la sesión al terminar en un equipo compartido.",
        "Si olvidaste la contraseña o tu cuenta está inactiva, pide ayuda a un administrador autorizado."
      ],
      "result": "Tu acceso personal queda protegido y puedes reconocer cuándo debes volver a entrar.",
      "note": "Nunca envíes contraseñas, códigos ni tokens junto con una captura de un problema.",
      "related": [
        "no-entro",
        "equipo"
      ],
      "tags": "contrasena contraseña login iniciar sesion cuenta bloqueada"
    },
    {
      "id": "trabajadores",
      "category": "Equipo y avisos",
      "title": "Directorio de trabajadores",
      "summary": "Mantén el registro de personal separado de las cuentas de acceso.",
      "section": "workersSection",
      "steps": [
        "Abre Administración → Trabajadores y busca a la persona antes de crearla.",
        "Registra sus datos y puesto según los campos disponibles.",
        "Revisa su estado y datos de contacto. Si deja de trabajar, utiliza la desactivación con el motivo correspondiente.",
        "Si necesita entrar al ERP, gestiona además su cuenta y rol en Usuarios y acceso."
      ],
      "result": "El directorio conserva los datos y estados del personal sin duplicar identidades.",
      "note": "Crear un trabajador no le concede automáticamente una cuenta ni permisos en el ERP.",
      "related": [
        "equipo"
      ],
      "tags": "trabajador empleado personal puesto desactivar"
    },
    {
      "id": "tareas",
      "category": "Equipo y avisos",
      "title": "Gestionar Mis tareas",
      "summary": "Asigna, ejecuta y documenta el próximo paso de una operación.",
      "section": "tasksSection",
      "steps": [
        "Abre Mis tareas y filtra por estado, responsable o prioridad según necesites.",
        "Abre la tarea y el registro relacionado. Revisa fecha límite, instrucciones y dependencias.",
        "Empieza el trabajo cuando corresponda. Si no puede continuar, registra el bloqueo y su motivo mediante la acción disponible.",
        "Añade comentarios útiles y confirma el responsable del siguiente paso.",
        "Completa la tarea cuando el trabajo esté hecho. Si ya no aplica, utiliza la cancelación con un motivo en lugar de marcarla como realizada."
      ],
      "result": "El equipo conoce qué falta, quién debe hacerlo y por qué algo está detenido.",
      "note": "Cambiar el estado de una tarea no reemplaza guardar el documento, cobro o despacho al que se refiere.",
      "related": [
        "rutas",
        "avisos",
        "rutina"
      ],
      "tags": "mis tareas asignar completar bloquear prioridad vencida comentario"
    },
    {
      "id": "rutas",
      "category": "Equipo y avisos",
      "title": "Asignaciones automáticas y supervisión",
      "summary": "Configura a quién llega cada tipo de trabajo.",
      "section": "tasksSection",
      "steps": [
        "Con permiso de gestión de tareas, abre la configuración de asignaciones o rutas desde el área de tareas.",
        "Revisa cada tipo de flujo, su activación, responsable, prioridad y plazo.",
        "Asigna una persona o equipo real con los permisos necesarios para actuar sobre la operación.",
        "Consulta la supervisión para identificar trabajo sin responsable, bloqueado o vencido.",
        "Si reasignas una tarea manualmente, verifica que la nueva persona pueda abrir su registro relacionado."
      ],
      "result": "Las nuevas tareas tienen un destino operativo y pueden supervisarse.",
      "note": "Asignar una tarea no concede permisos sobre facturas, compras o contenedores. Configura el rol por separado.",
      "related": [
        "equipo",
        "tareas",
        "permisos"
      ],
      "tags": "workflow ruta asignacion automatica supervisor responsables equipo"
    },
    {
      "id": "avisos",
      "category": "Equipo y avisos",
      "title": "Alertas y notificaciones",
      "summary": "Distingue la situación del negocio del aviso que recibiste.",
      "section": "notificationsSection",
      "steps": [
        "Abre Centro de alertas o Notificaciones y revisa prioridad, fecha y registro relacionado.",
        "Entra a la operación y comprueba qué falta: documentos, seguimiento, cobro, responsable o un estado pendiente.",
        "Realiza la acción real que resuelve la situación. Leer una notificación solo marca el aviso como leído.",
        "Utiliza resolver, posponer o descartar únicamente cuando la acción disponible corresponda a lo ocurrido.",
        "Revisa tus preferencias de avisos y, si otro usuario no recibe el trabajo correcto, pide revisar permisos y asignaciones."
      ],
      "result": "Las alertas reflejan pendientes reales y la bandeja permite saber qué has revisado.",
      "note": "No cierres alertas masivamente para ocultar trabajo pendiente.",
      "related": [
        "tareas",
        "tracking",
        "whatsapp"
      ],
      "tags": "alerta notificacion campana critico leido resolver posponer bandeja"
    },
    {
      "id": "whatsapp",
      "category": "Equipo y avisos",
      "title": "Cuándo se envía WhatsApp",
      "summary": "Comprende qué acciones pueden contactar al cliente.",
      "section": "clientsSection",
      "steps": [
        "Comprueba el teléfono del cliente antes de ejecutar una acción de envío.",
        "La bienvenida se envía o reenvía manualmente desde Clientes; guardar la ficha no la dispara.",
        "Los hitos de salida y liberación pueden generar sus avisos automáticos cuando corresponden al estado de la operación.",
        "Después de una incidencia, comprueba si el cambio de seguimiento quedó guardado aunque el aviso haya fallado.",
        "Si falta confirmación de entrega, solicita revisar el estado al responsable de la integración. Evita repetir el evento o reenviar por suposición."
      ],
      "result": "Puedes distinguir el registro operativo de la entrega de su mensaje.",
      "note": "La guía no envía mensajes. Una operación guardada y un mensaje entregado son resultados diferentes.",
      "related": [
        "tracking",
        "clientes",
        "error-aviso"
      ],
      "tags": "whatsapp mensaje bienvenida salida liberacion entrega twilio"
    },
    {
      "id": "editar-cancelar",
      "category": "Solución de problemas",
      "title": "No puedo editar o cancelar una operación",
      "summary": "Comprueba estados, permisos y documentos relacionados.",
      "section": "",
      "steps": [
        "Lee el motivo que aparece junto a la acción. Comprueba si tu usuario tiene permiso para modificar ese módulo.",
        "Revisa el estado: borrador, confirmado, recibido, despachado, contabilizado, cerrado o anulado pueden permitir acciones distintas.",
        "Abre las relaciones: recepciones, reservas, cargues, facturas, cobros, pagos y vínculos directos pueden proteger la operación.",
        "Corrige o libera dependencias mediante sus propias acciones autorizadas, solo si corresponde a la realidad. No elimines documentos para forzar una edición.",
        "Si la restricción no se entiende o existe dinero o mercancía comprometida, registra el problema y pide revisión al responsable."
      ],
      "result": "Identificas la dependencia o autorización que impide la acción.",
      "note": "Cancelar una compra o venta no borra de forma automática su historial ni revierte dinero o mercancía ya registrados.",
      "related": [
        "reversos",
        "permisos",
        "reportar"
      ],
      "tags": "no puedo editar cancelar bloqueado boton deshabilitado revision anular"
    },
    {
      "id": "error-guardar",
      "category": "Solución de problemas",
      "title": "No puedo guardar o aparece un error",
      "summary": "Revisa la entrada y confirma si el registro existe antes de reintentar.",
      "section": "",
      "steps": [
        "Lee el mensaje completo y corrige los campos señalados: obligatorios, cantidades, moneda, fechas o selección de registros activos.",
        "Si dice que cambió el estado o el saldo, consulta el registro actual: otro usuario pudo haber trabajado sobre él.",
        "Si hubo una desconexión, comprueba primero si el registro fue creado. No pulses Guardar repetidamente.",
        "Conserva el formulario o su borrador mientras verificas. Si debes actualizar la página, asegúrate antes de poder recuperar los datos.",
        "Si persiste, anota módulo, acción, mensaje exacto, hora y referencia de la operación y entrega el reporte al administrador."
      ],
      "result": "Puedes corregir errores de entrada o escalar el problema sin duplicar operaciones.",
      "note": "No borres datos del navegador ni crees una operación nueva para ocultar un error sin comprobar el registro original.",
      "related": [
        "guardar",
        "duplicados",
        "reportar"
      ],
      "tags": "error fallo no guarda guardar timeout desconexion conexion 500 503"
    },
    {
      "id": "no-entro",
      "category": "Solución de problemas",
      "title": "No puedo iniciar sesión",
      "summary": "Usuario, bloqueo temporal, cuenta inactiva o sesión revocada.",
      "section": "",
      "steps": [
        "Revisa que estés en la dirección habitual del ERP y que el usuario esté escrito correctamente.",
        "Comprueba mayúsculas y teclado de la contraseña. No compartas tus credenciales para que otra persona pruebe.",
        "Si aparece bloqueo temporal, espera el plazo indicado; los intentos fallidos pueden bloquear la cuenta durante 15 minutos.",
        "Si la sesión expiró o fue revocada, vuelve a iniciar sesión. Un cambio de contraseña o permisos puede requerir revisión del administrador.",
        "Si la cuenta está desactivada o no recuerdas la contraseña, solicita asistencia al administrador autorizado."
      ],
      "result": "Puedes distinguir una credencial incorrecta de un bloqueo o un cambio de acceso.",
      "note": "No intentes usar la cuenta de otra persona para eludir una restricción.",
      "related": [
        "cuenta",
        "equipo",
        "reportar"
      ],
      "tags": "no entra acceso bloqueado login contraseña olvidada 401 403"
    },
    {
      "id": "permisos",
      "category": "Solución de problemas",
      "title": "No veo un módulo o no puedo usar un botón",
      "summary": "La visibilidad y las acciones dependen de tu rol.",
      "section": "accountSection",
      "steps": [
        "Limpia la búsqueda del menú y abre el grupo correspondiente. Un filtro puede ocultar una sección visible para ti.",
        "Comprueba con qué usuario iniciaste sesión y qué función debes realizar.",
        "Si puedes consultar pero no guardar, puede que tengas permiso de lectura sin permiso de gestión.",
        "Solicita al administrador revisar el rol y la acción concreta. Las asignaciones de tareas no añaden esos permisos.",
        "Después del ajuste, comprueba de nuevo el módulo. Si sigue faltando, reporta la sección y la acción esperada."
      ],
      "result": "El administrador puede identificar el permiso necesario sin dar acceso general a todo.",
      "note": "La ayuda puede describir módulos que tu rol no autoriza. Sus accesos directos respetan esos permisos.",
      "related": [
        "equipo",
        "rutas",
        "reportar"
      ],
      "tags": "no veo modulo boton no aparece permiso lectura acceso denegado"
    },
    {
      "id": "stock-no-aparece",
      "category": "Solución de problemas",
      "title": "La compra no aparece en Existencias",
      "summary": "Revisa el destino y la recepción física.",
      "section": "inventorySection",
      "steps": [
        "Comprueba si la compra es Direct Ship. En ese caso no debe aparecer como stock propio.",
        "Si va a almacén, revisa si existe un WR recibido y vinculado a la compra.",
        "Limpia los filtros de producto y almacén y comprueba la unidad de medida.",
        "Consulta si hay reservas, despachos o una anulación que expliquen el saldo disponible.",
        "Si falta un movimiento esperado, conserva las referencias de compra, WR y cargue para revisión."
      ],
      "result": "Puedes explicar el saldo por su origen y sus movimientos.",
      "note": "No registres otra recepción hasta confirmar que la entrada original no existe.",
      "related": [
        "inventario",
        "recepciones",
        "recorrido-directo"
      ],
      "tags": "stock falta no aparece compra existencias recepcion inventario cero"
    },
    {
      "id": "cantidades",
      "category": "Solución de problemas",
      "title": "Las cantidades, pallets o importes no coinciden",
      "summary": "Revisa unidades, compromisos y moneda antes de corregir.",
      "section": "",
      "steps": [
        "Comprueba qué unidad usa cada línea: unidades, cajas, paneles o sacos. Verifica la relación con pallets.",
        "Revisa cantidades ya recibidas, reservadas, vendidas o facturadas; no siempre puedes reducir por debajo de lo comprometido.",
        "Comprueba el total de línea y la moneda. Distingue un total comercial de un precio unitario redondeado.",
        "Si hay un exceso real de recepción, usa la confirmación de exceso disponible después de verificarlo.",
        "Si el problema afecta operaciones anteriores, pide revisión con sus referencias y cantidades esperadas."
      ],
      "result": "Identificas si la diferencia procede de una medida, un compromiso o un importe.",
      "note": "No ajustes cantidades al azar hasta que el formulario acepte la operación.",
      "related": [
        "productos",
        "compras",
        "recepciones",
        "reportar"
      ],
      "tags": "pallet cantidad total precio redondeo unidades no coincide exceso"
    },
    {
      "id": "archivo-error",
      "category": "Solución de problemas",
      "title": "No puedo subir, abrir o descargar un documento",
      "summary": "Comprueba archivo, permisos y operación de destino.",
      "section": "containersSection",
      "steps": [
        "Revisa el mensaje del formulario sobre formato o tamaño permitido y comprueba que el archivo abra en tu computadora.",
        "Confirma que estás en la operación correcta y que tienes permiso para documentos.",
        "Si la carga se interrumpió, revisa la lista antes de repetirla. Puede que el archivo ya esté registrado.",
        "Si un enlace dejó de funcionar, vuelve a abrir el documento desde el ERP con tu sesión actual.",
        "Si persiste, reporta tipo de documento, referencia, hora y mensaje, sin adjuntar datos sensibles a canales no autorizados."
      ],
      "result": "Puedes identificar si el problema está en el archivo, el acceso o la carga.",
      "note": "No compartas enlaces privados de documentos como solución permanente de acceso.",
      "related": [
        "documentos",
        "reportar"
      ],
      "tags": "PDF archivo subir descargar adjunto error documento"
    },
    {
      "id": "duplicados",
      "category": "Solución de problemas",
      "title": "Parece que guardé o cobré dos veces",
      "summary": "Confirma registros y movimientos antes de corregir.",
      "section": "",
      "steps": [
        "Distingue dos filas o avisos del mismo registro de dos registros con identificadores diferentes.",
        "Busca por referencia y abre el historial. Comprueba importes, fecha, contraparte y vínculos.",
        "Si hubo un reintento, confirma el saldo y el movimiento realmente registrado antes de volver a guardar.",
        "Si existe un duplicado real, solicita la corrección autorizada: no borres registros financieros ni alteres el otro para disimularlo.",
        "Reporta las dos referencias y qué acción se repitió. No incluyas contraseñas ni información bancaria completa."
      ],
      "result": "Puedes demostrar si hubo una repetición visual o un duplicado que requiere corrección.",
      "note": "Los controles de reintento ayudan a evitar duplicados; comprobar el resultado sigue siendo necesario.",
      "related": [
        "guardar",
        "reversos",
        "reportar"
      ],
      "tags": "duplicado doble pago doble cobro reintento repetir"
    },
    {
      "id": "error-aviso",
      "category": "Solución de problemas",
      "title": "Se guardó el seguimiento pero falló el aviso",
      "summary": "No repitas un evento operativo solo para reenviar un mensaje.",
      "section": "containersSection",
      "steps": [
        "Abre el contenedor y confirma en el historial si el evento quedó guardado.",
        "Comprueba teléfono y destinatario antes de considerar cualquier reenvío.",
        "Revisa el estado visible del aviso y distingue pendiente, fallo y entrega confirmada.",
        "Solicita al responsable de la integración revisar el fallo y decidir el reintento apropiado.",
        "Mantén el evento real y su fecha; no retrocedas o avances estados para provocar otro mensaje."
      ],
      "result": "El seguimiento permanece correcto mientras se resuelve la mensajería.",
      "note": "Un error de WhatsApp no implica por sí mismo que se haya perdido el cambio operativo.",
      "related": [
        "whatsapp",
        "tracking",
        "reportar"
      ],
      "tags": "fallo mensaje aviso no llega whatsapp entrega notificacion"
    },
    {
      "id": "reportar",
      "category": "Solución de problemas",
      "title": "Pedir ayuda y reportar un problema",
      "summary": "Reúne información útil para que el administrador pueda resolverlo.",
      "section": "",
      "steps": [
        "Indica el módulo y la acción: por ejemplo, Compras → recibir una entrega parcial.",
        "Describe qué esperabas y qué ocurrió. Copia el mensaje de error tal como aparece.",
        "Añade fecha y hora, navegador, usuario afectado y referencia de la operación. Evita incluir datos que no sean necesarios.",
        "Prepara una captura con información personal o financiera sensible oculta. Nunca incluyas contraseña, token ni claves.",
        "Indica si afecta solo a tu usuario o a varios, y si el registro quedó guardado. Envía el reporte al administrador del ERP por el canal acordado."
      ],
      "result": "El administrador recibe un caso reproducible y puede decidir la corrección adecuada.",
      "note": "La ayuda orienta sobre situaciones habituales. Los fallos nuevos, recuperaciones de datos e integraciones requieren intervención del responsable; la guía no los repara automáticamente.",
      "related": [
        "error-guardar",
        "permisos",
        "no-entro"
      ],
      "tags": "soporte problema ayuda incidencia reportar contacto administrador"
    },
    {
      "id": "glosario",
      "category": "Primeros pasos",
      "title": "Glosario: PO, WR, Direct Ship y saldos",
      "summary": "Los términos que encontrarás en los módulos.",
      "section": "",
      "steps": [
        "PO: orden de compra al proveedor. Su confirmación no representa una entrada física ni un pago.",
        "WR: recepción de mercancía en almacén. Identifica el origen del inventario recibido.",
        "Direct Ship: mercancía que se entrega sin pasar por tu almacén; conserva vínculos de compra, venta y despacho.",
        "Reserva: compromiso de mercancía disponible para una salida. Despacho: ejecución de la salida según el circuito.",
        "Por cobrar: saldo de clientes. Por pagar: saldo con proveedores. Anticipo: dinero recibido que aún puede aplicarse o devolverse.",
        "Costo de mercancía (COGS): costo reconocido de lo cumplido. Margen bruto y contribución dependen de costos completos y monedas comparables.",
        "B/L o BOL: conocimiento de embarque. Booking: referencia de reserva de transporte. Proforma: propuesta documental que no registra por sí sola un cobro."
      ],
      "result": "Puedes interpretar las referencias y estados sin confundir documentos, mercancía y dinero.",
      "note": "",
      "related": [],
      "tags": "siglas PO WR AP AR COGS BL BOL glosario significado"
    }
  ]
});
})();
