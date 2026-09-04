import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const migration=read('supabase/migrations/20260904011201_purchase_line_total_measurement_consistency.sql');
const purchaseApi=read('api/purchases.js');
const loadApis=[read('api/loads.js'),read('api/sales-loads.js')];
const warehouseApi=read('api/warehouse.js');
const ui=read('admin/purchases.js');
const html=read('admin/purchases.html');
const failures=[];
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};

for(const text of [
  'add column if not exists entered_line_total numeric',
  'purchase_order_items_entered_line_total_nonnegative',
  'v_line_total numeric',
  "v_line_total := nullif(btrim(v_line->>'line_total'),'')::numeric",
  'v_unit_cost := v_line_total / v_quantity',
  'unit_cost,entered_line_total,currency,notes',
  'PO_QUANTITY_PALLET_MISMATCH',
  'WR_QUANTITY_PALLET_MISMATCH',
  'LOAD_QUANTITY_PALLET_MISMATCH',
  'purchase_order_items_measurement_consistency',
  'warehouse_receipt_items_measurement_consistency',
  "po.po_number = 'PO-0008'",
  "wr.receipt_number = 'WR-0007'",
  "l.load_number = 'CG-0009'",
  'poi.ordered_quantity = 840',
  'poi.ordered_pallets = 28',
  'wri.units_per_pallet = 30',
  "set search_path to 'public','pg_temp'",
  'revoke execute on function public.populate_purchase_order_items(uuid,jsonb) from public,anon,authenticated',
  'grant execute on function public.populate_purchase_order_items(uuid,jsonb) to service_role'
])requireText(migration,text,`migración ${text}`);

for(const text of [
  'entered_line_total,currency',
  'line_total:text(line.line_total,80)',
  'PO_LINE_TOTAL_INVALID',
  'PO_LINE_TOTAL_REQUIRES_QUANTITY',
  'PO_QUANTITY_PALLET_MISMATCH',
  'WR_QUANTITY_PALLET_MISMATCH'
])requireText(purchaseApi,text,`API Compras ${text}`);

for(const source of loadApis)requireText(source,'LOAD_QUANTITY_PALLET_MISMATCH','traducción de medida en API de Cargues');
requireText(warehouseApi,'WR_QUANTITY_PALLET_MISMATCH','traducción de medida en API de Almacén');

for(const text of [
  'function hasEnteredLineTotal(item)',
  'function lineTotal(item)',
  'function setLinePricingMode(div,mode,convert=false)',
  'function updateLineSummary(div)',
  '<option value="unit">Costo unitario</option>',
  '<option value="total">Valor total</option>',
  "unit_cost:mode==='unit'?price:''",
  "line_total:mode==='total'?price:''",
  'pallets × unidades por pallet',
  'entered_line_total'
])requireText(ui,text,`UI Compras ${text}`);

for(const text of [
  '/admin/purchases.css?v=20260904-directflow1',
  '/admin/purchases.js?v=20260904-safeedit1',
  '/admin/embedded-auto-refresh.js?v=20260904-live2'
])requireText(html,text,`cache de Compras ${text}`);

if(failures.length){
  console.error('Purchase total and measurement consistency gate failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}

console.log('Purchase total and measurement consistency gate passed.');
