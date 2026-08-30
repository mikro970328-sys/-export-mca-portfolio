import { authorizeAdmin, fail, ok, supabase } from './_lib.js';
import { loadExecutiveDashboard, parseExecutiveFilters } from './_executive-dashboard.js';

const DATASETS = Object.freeze({
  sales:{
    label:'Ventas', dimensions:['period','currency','client','product'],
    columns:[
      ['order_date','Fecha'],['so_number','Sales Order'],['client_name','Cliente'],['client_company','Empresa'],['importer_name','Importadora'],
      ['status','Estado'],['currency','Moneda'],['order_total','Valor SO'],['fulfillment_status','Cumplimiento'],
      ['attributed_sales_revenue','Venta atribuida'],['unattributed_order_value','Valor no atribuido'],
      ['recognized_merchandise_cogs','COGS reconocido'],['merchandise_cost_coverage','Cobertura COGS'],
      ['gross_margin','Margen bruto'],['gross_margin_pct','Margen bruto %'],['profitability_status','Estado rentabilidad'],
      ['direct_cost_amount','Costos directos'],['contribution_margin','Contribución'],['contribution_margin_pct','Contribución %'],['contribution_status','Estado contribución']
    ]
  },
  purchases:{
    label:'Compras', dimensions:['period','currency','supplier','product'],
    columns:[
      ['order_date','Fecha'],['po_number','Purchase Order'],['supplier_name','Proveedor'],['supplier_legal_name','Razón social'],
      ['warehouse_code','Almacén'],['warehouse_name','Nombre almacén'],['status','Estado'],['receipt_status','Recepción'],
      ['currency','Moneda'],['order_total','Valor PO'],['order_value_coverage','Cobertura valor'],['item_count','Líneas'],['costed_item_count','Líneas con costo'],['has_excess','Exceso de recepción']
    ]
  },
  invoices:{
    label:'Facturas / AR', dimensions:['period','currency','client','product'],
    columns:[
      ['issue_date','Fecha emisión'],['invoice_number','Factura'],['client_name','Cliente'],['client_company','Empresa'],['due_date','Vence'],
      ['currency','Moneda'],['invoice_total','Total'],['paid_amount','Cobrado aplicado'],['balance_due','AR actual'],['payment_status','Estado cobro'],['overdue','Vencida'],
      ['recognized_merchandise_cogs','COGS reconocido'],['merchandise_cost_coverage','Cobertura COGS'],['gross_margin','Margen bruto'],['gross_margin_pct','Margen bruto %'],['profitability_status','Estado rentabilidad']
    ]
  },
  supplier_bills:{
    label:'Supplier Bills / AP', dimensions:['period','currency','supplier','product'],
    columns:[
      ['bill_date','Fecha'],['bill_number','Bill'],['supplier_invoice_number','Factura proveedor'],['supplier_name','Proveedor'],['supplier_legal_name','Razón social'],
      ['po_number','Purchase Order'],['due_date','Vence'],['currency','Moneda'],['bill_total','Total'],['paid_amount','Pagado aplicado'],['balance_due','AP actual'],['payment_status','Estado pago'],['overdue','Vencida']
    ]
  },
  cash:{
    label:'Flujo de caja', dimensions:['period','currency','client','supplier','product'],
    columns:[
      ['payment_date','Fecha'],['event_type','Tipo'],['direction','Dirección'],['party_name','Contraparte'],['party_detail','Detalle'],
      ['document_number','Documento'],['currency','Moneda'],['amount','Monto'],['method','Método'],['reference_number','Referencia']
    ]
  },
  inventory:{
    label:'Inventario actual', dimensions:['supplier','product'], basis:'current_snapshot',
    columns:[
      ['warehouse_code','Almacén'],['warehouse_name','Nombre almacén'],['receipt_number','WR'],['received_at','Recibido'],['supplier_name','Proveedor'],
      ['product_sku','SKU'],['product_name','Producto'],['unit','Unidad'],['lot_number','Lote'],
      ['physical_quantity','Cantidad física'],['reserved_quantity','Cantidad reservada'],['available_quantity','Cantidad disponible'],
      ['physical_pallets','Pallets físicos'],['reserved_pallets','Pallets reservados'],['available_pallets','Pallets disponibles']
    ]
  }
});

const csvCell = value => `"${String(value ?? '').replaceAll('"','""')}"`;
const dateStamp = () => new Date().toISOString().slice(0,10);

function cleanDataset(value) {
  const dataset=String(value || 'sales').trim().toLowerCase();
  if (!DATASETS[dataset]) throw new Error('Reporte inválido.');
  return dataset;
}

function cleanLimit(value) {
  if (value === undefined || value === null || value === '') return 1000;
  const parsed=Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5000) throw new Error('Límite inválido. Usa un valor entre 1 y 5000.');
  return parsed;
}

function assertApplicableFilters(dataset,filters) {
  const dims=new Set(DATASETS[dataset].dimensions);
  const checks=[['period',Boolean(filters.start_date || filters.end_date)],['currency',Boolean(filters.currency)],['client',Boolean(filters.client_id)],['supplier',Boolean(filters.supplier_id)],['product',Boolean(filters.product_id)]];
  const invalid=checks.find(([dimension,active])=>active && !dims.has(dimension));
  if (invalid) throw new Error(`El filtro ${invalid[0]} no aplica al reporte ${DATASETS[dataset].label}.`);
}

async function reportOptions() {
  const [clients,suppliers,products,executive]=await Promise.all([
    supabase('clients',{query:'?select=id,name,company,active&active=eq.true&order=name.asc'}),
    supabase('suppliers',{query:'?select=id,name,legal_name,active&active=eq.true&order=name.asc'}),
    supabase('products',{query:'?select=id,sku,name,brand,active&active=eq.true&order=name.asc'}),
    loadExecutiveDashboard({})
  ]);
  const currencies=[...new Set([
    ...(executive.activity_by_currency || []).map(row=>String(row.currency || '').toUpperCase()),
    ...(executive.balances_by_currency || []).map(row=>String(row.currency || '').toUpperCase())
  ].filter(Boolean))].sort();
  return { clients:clients || [], suppliers:suppliers || [], products:products || [], currencies };
}

async function loadDataset(dataset,filters,limit) {
  const result=await supabase('rpc/executive_report_dataset',{
    method:'POST',
    body:{
      p_dataset:dataset,
      p_start_date:filters.start_date,
      p_end_date:filters.end_date,
      p_currency:filters.currency,
      p_client_id:filters.client_id,
      p_supplier_id:filters.supplier_id,
      p_product_id:filters.product_id,
      p_limit:limit
    }
  });
  const payload=Array.isArray(result)?(result[0] || {}):(result || {});
  return payload;
}

function sendCsv(res,dataset,payload) {
  const config=DATASETS[dataset];
  const rows=Array.isArray(payload.rows)?payload.rows:[];
  const headers=config.columns.map(([,label])=>label);
  const lines=[headers.map(csvCell).join(',')];
  for(const row of rows) lines.push(config.columns.map(([key])=>csvCell(row?.[key])).join(','));
  const currency=payload.filters?.currency?`-${String(payload.filters.currency).toLowerCase()}`:'';
  res.statusCode=200;
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Disposition',`attachment; filename="export-mca-${dataset}${currency}-${dateStamp()}.csv"`);
  res.end('\ufeff'+lines.join('\n'));
}

export default async function handler(req,res) {
  const admin=await authorizeAdmin(req,res,'reports.read');
  if(!admin)return;
  if(req.method!=='GET')return fail(res,405,'Método no permitido');

  try{
    const dataset=cleanDataset(req.query?.dataset);
    const filters=parseExecutiveFilters(req.query || {});
    const limit=cleanLimit(req.query?.limit);
    assertApplicableFilters(dataset,filters);
    const payload=await loadDataset(dataset,filters,limit);
    if(String(req.query?.format || '').toLowerCase()==='csv') return sendCsv(res,dataset,payload);
    const includeOptions=String(req.query?.include_options ?? '1')!=='0';
    const options=includeOptions?await reportOptions():null;
    return ok(res,{
      owner:'api/reports.js',
      generated_at:new Date().toISOString(),
      report:{ key:dataset,label:DATASETS[dataset].label,columns:DATASETS[dataset].columns.map(([key,label])=>({key,label})),dimensions:DATASETS[dataset].dimensions,basis:payload.basis || DATASETS[dataset].basis || 'period_activity' },
      filters:payload.filters || filters,
      currency_policy:payload.currency_policy || 'separate_no_fx',
      row_count:Number(payload.row_count || 0),
      limit:Number(payload.limit || limit),
      rows:Array.isArray(payload.rows)?payload.rows:[],
      datasets:Object.entries(DATASETS).map(([key,value])=>({key,label:value.label,dimensions:value.dimensions,basis:value.basis || 'period_activity'})),
      filter_options:options
    });
  }catch(error){
    console.error('[reports]',error);
    return fail(res,400,error.message || 'No se pudo generar el reporte');
  }
}
