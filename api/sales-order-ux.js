import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';

const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const rpcRow = value => Array.isArray(value) ? (value[0] || null) : (value || null);
const int = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

function clientLabel(row) {
  return row?.company || row?.mipyme_name || row?.name || 'Cliente';
}

function safeSearch(value) {
  return text(value, 120).replace(/[*,()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('Agrega al menos una línea a la Sales Order');
  return lines.map((line, index) => {
    const productId = text(line.product_id, 80);
    const quantity = text(line.ordered_quantity, 80);
    const pallets = text(line.ordered_pallets, 80);
    const upp = text(line.units_per_pallet, 80);
    const unitPrice = text(line.unit_price, 80);
    const lineTotal = text(line.line_total, 80);
    if (!productId) throw new Error(`Selecciona el producto de la línea ${index + 1}`);
    if (lineTotal !== '' && (!Number.isFinite(Number(lineTotal)) || Number(lineTotal) < 0)) throw new Error(`El total de venta de la línea ${index + 1} no es válido`);
    if (lineTotal === '' && unitPrice !== '' && (!Number.isFinite(Number(unitPrice)) || Number(unitPrice) < 0)) throw new Error(`El precio unitario de la línea ${index + 1} no es válido`);
    return {
      product_id:productId,
      ordered_quantity:quantity,
      ordered_pallets:pallets,
      units_per_pallet:upp,
      unit_price:unitPrice,
      line_total:lineTotal,
      notes:text(line.notes,1000)
    };
  });
}

async function listClients(req) {
  const page = int(req.query?.page, 1, 1, 100000);
  const pageSize = int(req.query?.page_size, 25, 10, 100);
  const q = safeSearch(req.query?.q);
  const offset = (page - 1) * pageSize;
  let query = '?select=id,name,company,mipyme_name,active&active=eq.true&order=name.asc';
  if (q) {
    const pattern = encodeURIComponent(`*${q}*`);
    query += `&or=(name.ilike.${pattern},company.ilike.${pattern},mipyme_name.ilike.${pattern})`;
  }
  query += `&limit=${pageSize + 1}&offset=${offset}`;
  const rows = await supabase('clients', { query });
  const list = Array.isArray(rows) ? rows : [];
  const hasMore = list.length > pageSize;
  return {
    clients:list.slice(0,pageSize).map(row => ({ ...row, display_name:clientLabel(row) })),
    page,
    page_size:pageSize,
    has_more:hasMore
  };
}

async function clientContext(clientId) {
  const clients = await supabase('clients', { query:`?select=id,name,company,mipyme_name,active&id=eq.${clientId}&limit=1` });
  const client = Array.isArray(clients) ? clients[0] : null;
  if (!client || client.active !== true) throw new Error('Cliente no encontrado o inactivo');
  const links = await supabase('client_importers', { query:`?select=importer_id&client_id=eq.${clientId}&limit=1000` });
  const ids = [...new Set((links || []).map(row => row.importer_id).filter(Boolean))];
  let importers = [];
  if (ids.length) {
    importers = await supabase('importers', { query:`?select=id,name,active&id=in.(${ids.join(',')})&active=eq.true&order=name.asc&limit=1000` });
  }
  return { client:{...client,display_name:clientLabel(client)}, importers:importers || [] };
}

async function inventoryForProduct(productId) {
  const rows = await supabase('inventory_summary', { query:`?select=warehouse_id,warehouse_code,warehouse_name,product_id,sku,product_name,unit,physical_quantity,physical_pallets,reserved_quantity,reserved_pallets,available_quantity,available_pallets&product_id=eq.${productId}&order=warehouse_name.asc&limit=1000` });
  const inventory = Array.isArray(rows) ? rows : [];
  const sum = key => inventory.reduce((total,row) => total + Number(row?.[key] || 0), 0);
  return {
    inventory,
    totals:{
      physical_quantity:sum('physical_quantity'),
      physical_pallets:sum('physical_pallets'),
      reserved_quantity:sum('reserved_quantity'),
      reserved_pallets:sum('reserved_pallets'),
      available_quantity:sum('available_quantity'),
      available_pallets:sum('available_pallets')
    }
  };
}

async function pricingForOrder(orderId) {
  const rows = await supabase('sales_order_items', { query:`?select=id,sales_order_id,product_id,ordered_quantity,unit_price,entered_line_total,created_at&sales_order_id=eq.${orderId}&order=created_at.asc&limit=500` });
  return { items:rows || [] };
}

async function saveOrder(body, admin) {
  const action = text(body.action,60).toLowerCase();
  if (!['create_plan','replace_plan'].includes(action)) throw new Error('Acción de Sales Order inválida');
  const lines = cleanLines(body.lines);
  const common = {
    p_client_id:text(body.client_id,80) || null,
    p_lines:lines,
    p_importer_id:text(body.importer_id,80) || null,
    p_order_date:text(body.order_date,40) || null,
    p_requested_at:text(body.requested_at,80) || null,
    p_currency:text(body.currency,10).toUpperCase() || 'USD',
    p_customer_reference:text(body.customer_reference,250) || null,
    p_notes:text(body.notes,2000) || null
  };
  let result;
  let orderId = text(body.sales_order_id,80);
  if (action === 'create_plan') {
    result = await supabase('rpc/create_sales_order_plan', { method:'POST', body:{ ...common, p_actor:admin.admin_id || null } });
  } else {
    if (!orderId) throw new Error('Falta la Sales Order');
    result = await supabase('rpc/replace_sales_order_plan', { method:'POST', body:{ p_sales_order_id:orderId, ...common } });
  }
  const order = rpcRow(result);
  if (!order?.id) throw new Error('No se pudo guardar la Sales Order');
  orderId = order.id;
  await writeAudit(admin, action === 'create_plan' ? 'sales_order_created' : 'sales_order_updated', 'sales_order', orderId, {
    so_number:order.so_number || null,
    client_id:order.client_id || common.p_client_id,
    pricing_entry:'unit_or_total'
  });
  return { order };
}

function translatedError(raw) {
  const pairs = [
    ['SO_CLIENT_REQUIRED','Selecciona un cliente.'],
    ['SO_CLIENT_NOT_FOUND','Cliente no encontrado.'],
    ['SO_CLIENT_INACTIVE','El cliente está inactivo.'],
    ['SO_IMPORTER_NOT_FOUND','Importador no encontrado.'],
    ['SO_IMPORTER_INACTIVE','El importador está inactivo.'],
    ['SO_CLIENT_IMPORTER_MISMATCH','Ese importador no está asociado al cliente seleccionado.'],
    ['SO_CURRENCY_INVALID','La moneda debe tener un código de 3 letras.'],
    ['SO_HAS_NO_ITEMS','Agrega al menos una línea a la Sales Order.'],
    ['SO_PRODUCT_NOT_FOUND','Uno de los productos no existe.'],
    ['SO_PRODUCT_INACTIVE','Uno de los productos está inactivo.'],
    ['SO_QUANTITY_INVALID','La cantidad de la venta es inválida.'],
    ['SO_QUANTITY_REQUIRED','Indica una cantidad mayor que cero.'],
    ['SO_UNITS_PER_PALLET_INVALID','Las unidades por pallet son inválidas.'],
    ['SO_UNIT_PRICE_INVALID','El precio unitario es inválido.'],
    ['SO_LINE_TOTAL_INVALID','El total de venta es inválido.'],
    ['SO_NOT_DRAFT','Solo una Sales Order en borrador puede editarse.']
  ];
  return pairs.find(([key]) => raw.includes(key))?.[1] || raw;
}

export default async function handler(req,res) {
  const admin = await authorizeAdmin(req,res,req.method === 'GET' ? 'sales.read' : 'sales.write');
  if (!admin) return;
  try {
    if (req.method === 'GET') {
      const mode = text(req.query?.mode,40).toLowerCase();
      if (mode === 'clients') return ok(res, await listClients(req));
      if (mode === 'client_context') {
        const id = text(req.query?.client_id,80);
        if (!id) return fail(res,400,'Falta el cliente');
        return ok(res, await clientContext(id));
      }
      if (mode === 'inventory') {
        const id = text(req.query?.product_id,80);
        if (!id) return fail(res,400,'Falta el producto');
        return ok(res, await inventoryForProduct(id));
      }
      if (mode === 'pricing') {
        const id = text(req.query?.sales_order_id,80);
        if (!id) return fail(res,400,'Falta la Sales Order');
        return ok(res, await pricingForOrder(id));
      }
      return fail(res,400,'Consulta no válida');
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      return ok(res, await saveOrder(body,admin));
    }
    return fail(res,405,'Método no permitido');
  } catch (error) {
    const raw = String(error.message || 'No se pudo procesar Ventas');
    console.error('[sales-order-ux]',error);
    return fail(res,400,translatedError(raw));
  }
}
