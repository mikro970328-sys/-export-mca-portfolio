const $=id=>document.getElementById(id);
const token=localStorage.getItem('export_mca_token')||'';
if(!token)location.href='/admin/index.html';

let warehouses=[];
let products=[];
let receipts=[];
let suppliers=[];
let lineSeq=0;
let receiptView='active';
let quickProductTarget=null;
let warehouseWriteAccess=false;

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
const actionAllowed=(receipt,action)=>receipt?.capabilities?.actions?.[action]?.allowed===true;

async function api(path,opt={}){
  const r=await fetch(path,{...opt,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...(opt.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(r.status===401){
    localStorage.removeItem('export_mca_token');
    location.href='/admin/index.html';
    throw new Error('Sesión vencida');
  }
  if(!r.ok)throw new Error(d.error||'Error');
  return d;
}

function note(id,text,ok=false){
  $(id).textContent=text;
  $(id).className='msg '+(ok?'ok':'bad');
}
function fmtNum(v){const n=Number(v);return Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:3}):'-';}
function fmtDate(v){return v?new Date(v).toLocaleString('es-US'):'-';}
function displayUnit(item){const raw=String(item.unit||'').trim();return raw&&!/^\d+(\.\d+)?$/.test(raw)?raw:(item.product?.unit||'unidades');}
function entryLabel(item){const pallets=Number(item.pallets||0),quantity=Number(item.quantity||0);if(pallets>0)return quantity>0?`${fmtNum(pallets)} pallets · ${fmtNum(quantity)} ${esc(displayUnit(item))}`:`${fmtNum(pallets)} pallets`;return `${fmtNum(quantity)} ${esc(displayUnit(item))}`;}

function showNotice(message){
  let notice=$('warehouseNotice');
  if(!notice){
    notice=document.createElement('div');
    notice.id='warehouseNotice';
    notice.style.cssText='position:fixed;right:18px;bottom:18px;z-index:80;max-width:420px;background:#06204a;color:#fff;padding:12px 14px;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.22);font-size:13px;font-weight:700';
    document.body.appendChild(notice);
  }
  notice.textContent=message;
  notice.classList.remove('hidden');
  clearTimeout(showNotice.timer);
  showNotice.timer=setTimeout(()=>notice.classList.add('hidden'),3200);
}

function decision({title,message,word='ANULAR',confirmLabel='Anular recepción'}){
  return new Promise(resolve=>{
    let modal=$('warehouseDecision');
    if(!modal){
      modal=document.createElement('div');
      modal.id='warehouseDecision';
      modal.className='modal hidden';
      modal.innerHTML='<div class="modalbox compact"><div class="toolbar"><div><h2 id="warehouseDecisionTitle" style="margin:0"></h2><div id="warehouseDecisionMessage" class="muted" style="margin-top:6px"></div></div><button id="warehouseDecisionClose" class="alt icon-btn" type="button" aria-label="Cerrar">×</button></div><label id="warehouseDecisionLabel" style="margin-top:16px"></label><input id="warehouseDecisionInput" autocomplete="off"><div class="actions" style="margin-top:14px"><button id="warehouseDecisionCancel" class="alt" type="button">Cancelar</button><button id="warehouseDecisionConfirm" class="danger" type="button" disabled></button></div></div>';
      document.body.appendChild(modal);
    }
    const input=$('warehouseDecisionInput');
    const confirm=$('warehouseDecisionConfirm');
    $('warehouseDecisionTitle').textContent=title;
    $('warehouseDecisionMessage').textContent=message;
    $('warehouseDecisionLabel').textContent=`Escribe ${word} para confirmar`;
    input.value='';
    confirm.textContent=confirmLabel;
    confirm.disabled=true;
    modal.classList.remove('hidden');
    const finish=value=>{
      modal.classList.add('hidden');
      input.oninput=null;
      $('warehouseDecisionClose').onclick=null;
      $('warehouseDecisionCancel').onclick=null;
      confirm.onclick=null;
      modal.onclick=null;
      resolve(value);
    };
    input.oninput=()=>{confirm.disabled=input.value.trim().toUpperCase()!==word;};
    $('warehouseDecisionClose').onclick=()=>finish(false);
    $('warehouseDecisionCancel').onclick=()=>finish(false);
    confirm.onclick=()=>finish(true);
    modal.onclick=event=>{if(event.target===modal)finish(false);};
    setTimeout(()=>input.focus(),0);
  });
}

function cancelReason(receipt){
  const reason=receipt?.capabilities?.actions?.cancel?.reason;
  if(reason==='WR_HAS_INVENTORY_HISTORY')return 'Esta recepción ya tiene movimientos de inventario y no puede anularse.';
  if(reason==='WR_ASSIGNED_TO_LOAD')return 'Mercancía de esta recepción ya está asignada a un Cargue activo.';
  if(reason==='WR_NOT_RECEIVED')return 'Esta recepción ya no está disponible para anular.';
  if(reason==='PERMISSION_REQUIRED')return 'No tienes permiso para anular recepciones.';
  return 'La recepción ya no admite esta acción.';
}

async function load(){
  const d=await api('/api/warehouse');
  warehouses=d.warehouses||[];
  products=d.products||[];
  receipts=d.receipts||[];
  suppliers=d.suppliers||[];
  warehouseWriteAccess=d.write_access===true;
  renderAll();
}

function syncWriteControls(){
  for(const id of ['newReceipt','saveWarehouse','saveReceipt']){
    const node=$(id);
    if(!node)continue;
    node.disabled=!warehouseWriteAccess;
    node.setAttribute('aria-disabled',String(!warehouseWriteAccess));
  }
  if($('newReceipt'))$('newReceipt').title=warehouseWriteAccess?'Registrar una nueva recepción física':'No tienes permiso para registrar recepciones';
}

function renderAll(){renderStats();renderWarehouses();renderProducts();renderReceipts();fillWarehouseSelect();fillSupplierSelect();refreshProductOptions();syncWriteControls();}
function renderStats(){const activeWh=warehouses.filter(x=>x.active).length,activeProducts=products.filter(x=>x.active).length,valid=receipts.filter(x=>x.status==='received'),pallets=valid.flatMap(x=>x.items||[]).reduce((s,x)=>s+Number(x.pallets||0),0);$('stats').innerHTML=`<div class="stat"><span>Almacenes activos</span><b>${activeWh}</b></div><div class="stat"><span>Productos activos</span><b>${activeProducts}</b></div><div class="stat"><span>Recepciones WR</span><b>${valid.length}</b></div><div class="stat"><span>Pallets recibidos</span><b>${fmtNum(pallets)}</b></div>`;}
function renderWarehouses(){$('warehouseList').innerHTML=warehouses.length?`<table><thead><tr><th>Código</th><th>Almacén</th><th>Ubicación</th><th>Estado</th><th></th></tr></thead><tbody>${warehouses.map(x=>`<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.name)}</td><td>${esc([x.city,x.country].filter(Boolean).join(', '))}</td><td><span class="pill ${x.active?'':'off'}">${x.active?'Activo':'Inactivo'}</span></td><td>${warehouseWriteAccess?`<button class="alt" onclick="toggleWarehouse('${x.id}',${!x.active})">${x.active?'Desactivar':'Reactivar'}</button>`:''}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">Todavía no hay almacenes.</div>';}
function filteredProducts(){const q=$('productSearch').value.trim().toLowerCase();return products.filter(x=>!q||[x.sku,x.name,x.brand,x.category].some(v=>String(v||'').toLowerCase().includes(q)));}
function renderProducts(){const list=filteredProducts();$('productList').innerHTML=list.length?`<table><thead><tr><th>SKU</th><th>Producto</th><th>Presentación</th><th>Unidad</th><th>Estado</th><th></th></tr></thead><tbody>${list.map(x=>`<tr><td><b>${esc(x.sku||'-')}</b></td><td>${esc(x.name)}${x.brand?`<br><span class="muted">${esc(x.brand)}</span>`:''}</td><td>${esc(x.package_format||'-')}${x.default_units_per_pallet?`<br><span class="muted">${fmtNum(x.default_units_per_pallet)} / pallet</span>`:''}</td><td>${esc(x.unit||'-')}</td><td><span class="pill ${x.active?'':'off'}">${x.active?'Activo':'Inactivo'}</span></td><td><button class="alt" onclick="toggleProduct('${x.id}',${!x.active})">${x.active?'Desactivar':'Reactivar'}</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">No hay productos que coincidan.</div>';}
function receiptText(r){return [r.receipt_number,r.warehouse?.code,r.warehouse?.name,r.supplier_name,r.supplier?.name,r.truck_reference,r.reference_number,...(r.items||[]).flatMap(i=>[i.product?.sku,i.product?.name,i.product?.brand,i.lot_number])].join(' ').toLowerCase();}
function renderReceipts(){
  const q=$('receiptSearch').value.trim().toLowerCase(),status=receiptView==='cancelled'?'cancelled':'received',list=receipts.filter(r=>r.status===status&&(!q||receiptText(r).includes(q)));
  if(!list.length){$('receiptList').innerHTML=`<div class="empty">${receiptView==='cancelled'?'No hay recepciones anuladas.':'No hay recepciones activas.'}</div>`;return;}
  const rows=list.map(r=>{
    const pallets=(r.items||[]).reduce((s,x)=>s+Number(x.pallets||0),0),items=(r.items||[]).map(i=>`${esc(i.product?.name||'Producto')} · ${entryLabel(i)}`).join('<br>');
    const cancel=actionAllowed(r,'cancel')?`<button class="danger" onclick="cancelReceipt('${r.id}','${esc(r.receipt_number)}')">Anular</button>`:'';
    return `<tr><td><b>${esc(r.receipt_number)}</b></td><td>${fmtDate(r.received_at)}</td><td>${esc(r.warehouse?.name||'-')}</td><td>${esc(r.supplier_name||r.supplier?.name||'-')}</td><td>${items}</td><td>${pallets?fmtNum(pallets):'-'}</td><td><span class="pill ${r.status==='cancelled'?'cancel':''}">${r.status==='cancelled'?'Anulado':'Recibido'}</span></td><td><div class="actions"><button class="alt" onclick="showReceipt('${r.id}')">Ver</button>${cancel}</div></td></tr>`;
  }).join('');
  const cards=list.map(r=>{
    const cancel=actionAllowed(r,'cancel')?`<button class="danger" onclick="cancelReceipt('${r.id}','${esc(r.receipt_number)}')">Anular</button>`:'';
    return `<article class="receipt-card"><div class="receipt-card-top"><div><h3>${esc(r.receipt_number)}</h3><div class="receipt-card-meta">${fmtDate(r.received_at)}<br>${esc(r.warehouse?.name||'-')} · ${esc(r.supplier_name||r.supplier?.name||'Sin proveedor')}</div></div><span class="pill ${r.status==='cancelled'?'cancel':''}">${r.status==='cancelled'?'Anulado':'Recibido'}</span></div><div class="receipt-card-items">${(r.items||[]).map(i=>`<div><b>${esc(i.product?.name||'Producto')}</b><br>${entryLabel(i)}</div>`).join('<br>')}</div><div class="receipt-card-actions"><button class="alt" onclick="showReceipt('${r.id}')">Ver</button>${cancel}</div></article>`;
  }).join('');
  $('receiptList').innerHTML=`<div class="desktop-table"><table><thead><tr><th>WR</th><th>Fecha</th><th>Almacén</th><th>Proveedor</th><th>Mercancía</th><th>Pallets</th><th>Estado</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><div class="mobile-receipts">${cards}</div>`;
}
function fillWarehouseSelect(){const current=$('rWarehouse').value;$('rWarehouse').innerHTML='<option value="">Seleccionar almacén</option>'+warehouses.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}${x.city?' · '+esc(x.city):''}</option>`).join('');$('rWarehouse').value=current;}
function fillSupplierSelect(){const current=$('rSupplier').value;$('rSupplier').innerHTML='<option value="">Sin proveedor / recepción directa</option>'+suppliers.filter(x=>x.active!==false).map(x=>`<option value="${x.id}">${esc(x.name)}${x.country?' · '+esc(x.country):''}</option>`).join('');$('rSupplier').value=suppliers.some(x=>x.id===current&&x.active!==false)?current:'';}
function productOptions(selected=''){return '<option value="">Seleccionar producto</option>'+products.filter(x=>x.active).map(x=>`<option value="${x.id}" ${x.id===selected?'selected':''}>${esc(x.sku?x.sku+' · ':'')}${esc(x.name)}</option>`).join('');}
function refreshProductOptions(){document.querySelectorAll('.line-product').forEach(s=>{const v=s.value;s.innerHTML=productOptions(v);s.value=v;});}
function productSummary(p){if(!p)return 'Selecciona un producto. Sus datos maestros se reutilizan automáticamente.';const parts=[p.unit||'unidades'];if(p.default_units_per_pallet)parts.push(`${fmtNum(p.default_units_per_pallet)} por pallet`);if(p.package_format)parts.push(p.package_format);if(p.brand)parts.push(p.brand);return parts.map(esc).join(' · ');}
function applyProductToLine(div){const p=products.find(x=>x.id===div.querySelector('.line-product').value);div.querySelector('.product-summary').innerHTML=productSummary(p);if(p&&div.dataset.entryMode==='pallets'&&!div.querySelector('.line-upp').value)div.querySelector('.line-upp').value=p.default_units_per_pallet||'';updateLineTotal(div);}
function setLineMode(div,mode){div.dataset.entryMode=mode;div.querySelectorAll('.entry-mode button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));div.querySelector('.pallet-fields').classList.toggle('hidden',mode!=='pallets');div.querySelector('.unit-fields').classList.toggle('hidden',mode!=='units');updateLineTotal(div);}
function updateLineTotal(div){const mode=div.dataset.entryMode||'pallets',pallets=Number(div.querySelector('.line-pallets')?.value||0),upp=Number(div.querySelector('.line-upp')?.value||0),quantity=Number(div.querySelector('.line-quantity')?.value||0),p=products.find(x=>x.id===div.querySelector('.line-product').value),unit=p?.unit||'unidades',total=mode==='pallets'&&upp>0?pallets*upp:mode==='units'?quantity:0;const el=div.querySelector('.line-total');if(mode==='pallets'&&pallets>0&&upp<=0)el.value=`${fmtNum(pallets)} pallets`;else el.value=total>0?`${fmtNum(total)} ${unit}`:'';}
function addLine(seed={}){lineSeq++;const id=lineSeq,div=document.createElement('div');div.className='line';div.dataset.line=id;div.dataset.entryMode=seed.entry_mode||'pallets';div.innerHTML=`<div class="line-head"><b>Línea ${document.querySelectorAll('#receiptLines .line').length+1}</b><button class="danger" type="button" onclick="removeLine(${id})">Quitar</button></div><div class="grid"><div><label>Producto *</label><div class="product-picker"><select class="line-product">${productOptions(seed.product_id||'')}</select><button class="alt" type="button" onclick="openQuickProduct(${id})">+ Nuevo</button></div><div class="product-summary"></div></div><div><label>Recibir por</label><div class="entry-mode"><button type="button" data-mode="pallets">Pallets</button><button type="button" data-mode="units">Unidades</button></div></div></div><div class="pallet-fields grid"><div><label>Cantidad de pallets *</label><input class="line-pallets" type="number" min="0" step="1" value="${esc(seed.pallets||'')}"></div><div><label>Unidades por pallet (opcional)</label><input class="line-upp" type="number" min="0" step="0.001" value="${esc(seed.units_per_pallet||'')}" placeholder="Solo si deseas controlar unidades"></div></div><div class="unit-fields hidden"><label>Cantidad de unidades *</label><input class="line-quantity" type="number" min="0" step="0.001" value="${esc(seed.quantity||'')}"></div><div class="grid"><div><label>Total recibido</label><input class="line-total calculated" readonly placeholder="Se calcula cuando aplica"></div><div><label>Lote de esta recepción</label><input class="line-lot" value="${esc(seed.lot_number||'')}"></div></div><div class="grid3"><div><label>Peso neto recibido (kg)</label><input class="line-net" type="number" min="0" step="0.001" value="${esc(seed.net_weight_kg||'')}"></div><div><label>Peso bruto recibido (kg)</label><input class="line-gross" type="number" min="0" step="0.001" value="${esc(seed.gross_weight_kg||'')}"></div><div><label>Costo unitario de esta recepción</label><input class="line-cost" type="number" min="0" step="0.0001" value="${esc(seed.unit_cost||'')}"></div></div><label>Notas de esta recepción</label><input class="line-notes" value="${esc(seed.notes||'')}">`;div.querySelectorAll('.entry-mode button').forEach(b=>b.onclick=()=>setLineMode(div,b.dataset.mode));div.querySelector('.line-product').onchange=()=>applyProductToLine(div);['.line-pallets','.line-upp','.line-quantity'].forEach(sel=>div.querySelector(sel).oninput=()=>updateLineTotal(div));$('receiptLines').appendChild(div);setLineMode(div,div.dataset.entryMode);applyProductToLine(div);}
function removeLine(id){document.querySelector(`[data-line="${id}"]`)?.remove();if(!$('receiptLines').children.length)addLine();}
function collectLines(){return [...document.querySelectorAll('#receiptLines .line')].map(div=>{const mode=div.dataset.entryMode||'pallets';return {product_id:div.querySelector('.line-product').value,entry_mode:mode,pallets:mode==='pallets'?div.querySelector('.line-pallets').value:'',quantity:mode==='units'?div.querySelector('.line-quantity').value:'',units_per_pallet:mode==='pallets'?div.querySelector('.line-upp').value:'',lot_number:div.querySelector('.line-lot').value,net_weight_kg:div.querySelector('.line-net').value,gross_weight_kg:div.querySelector('.line-gross').value,unit_cost:div.querySelector('.line-cost').value,currency:'USD',notes:div.querySelector('.line-notes').value};});}
function openReceipt(){if(!warehouseWriteAccess)return showNotice('No tienes permiso para registrar recepciones.');if(!warehouses.some(x=>x.active))return showNotice('Primero crea al menos un almacén activo.');$('receiptLines').innerHTML='';addLine();const now=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);$('rReceivedAt').value=now;['rReference','rTruck','rDriver','rNotes'].forEach(id=>$(id).value='');$('rWarehouse').value='';$('rSupplier').value='';$('rMsg').textContent='';$('receiptModal').classList.remove('hidden');}
function closeReceipt(){$('receiptModal').classList.add('hidden');}
function openQuickProduct(lineId){quickProductTarget=lineId;['qpName','qpSku','qpUnit','qpBrand','qpUnitsPallet','qpFormat'].forEach(id=>$(id).value='');$('qpUnit').value='unidades';$('qpMsg').textContent='';$('quickProductModal').classList.remove('hidden');}
function closeQuickProduct(){$('quickProductModal').classList.add('hidden');quickProductTarget=null;}
function showReceipt(id){const r=receipts.find(x=>x.id===id);if(!r)return;const itemCards=(r.items||[]).map(i=>{const pallets=Number(i.pallets||0),quantity=Number(i.quantity||0);return `<div class="receipt-item"><div class="receipt-item-head"><div><div class="receipt-item-title">${esc(i.product?.name||'-')}</div><div class="muted">${esc(i.product?.sku||'Sin SKU')}</div></div><b>${entryLabel(i)}</b></div><div class="receipt-item-meta">${pallets>0?`<span><b>Pallets:</b> ${fmtNum(i.pallets)}</span>`:''}${pallets>0&&Number(i.units_per_pallet||0)>0?`<span><b>Unid./pallet:</b> ${fmtNum(i.units_per_pallet)}</span>`:''}${quantity>0?`<span><b>Total unidades:</b> ${fmtNum(i.quantity)} ${esc(displayUnit(i))}</span>`:''}${i.lot_number?`<span><b>Lote:</b> ${esc(i.lot_number)}</span>`:''}${i.gross_weight_kg?`<span><b>Peso bruto:</b> ${fmtNum(i.gross_weight_kg)} kg</span>`:''}</div></div>`;}).join('');$('detailTitle').textContent=r.receipt_number;$('detailBody').innerHTML=`<div class="detail-grid"><div class="detail-field"><b>Almacén</b>${esc(r.warehouse?.code||'')} · ${esc(r.warehouse?.name||'')}</div><div class="detail-field"><b>Recepción</b>${fmtDate(r.received_at)}</div><div class="detail-field"><b>Proveedor</b>${esc(r.supplier_name||r.supplier?.name||'-')}</div><div class="detail-field"><b>Camión / referencia</b>${esc(r.truck_reference||'-')}</div><div class="detail-field"><b>Chofer</b>${esc(r.driver_name||'-')}</div><div class="detail-field"><b>Referencia</b>${esc(r.reference_number||'-')}</div></div>${r.notes?`<div class="detail-field"><b>Notas</b>${esc(r.notes)}</div>`:''}<div style="margin-top:14px"><b>Mercancía recibida</b>${itemCards}</div>`;$('detailModal').classList.remove('hidden');}
async function toggleWarehouse(id,active){if(!warehouseWriteAccess)return;await api('/api/warehouse',{method:'PATCH',body:JSON.stringify({action:'set_warehouse_active',id,active})});await load();}
async function toggleProduct(id,active){await api('/api/warehouse',{method:'PATCH',body:JSON.stringify({action:'set_product_active',id,active})});await load();}
async function cancelReceipt(id,number){
  const receipt=receipts.find(row=>String(row.id)===String(id));
  if(!receipt||!actionAllowed(receipt,'cancel'))return showNotice(cancelReason(receipt));
  const approved=await decision({title:`Anular ${number}`,message:'La recepción dejará de aportar disponibilidad física. Esta acción solo está permitida mientras el WR no tenga historial de inventario ni asignaciones activas.',word:'ANULAR',confirmLabel:'Anular recepción'});
  if(!approved)return;
  try{
    await api('/api/warehouse',{method:'PATCH',body:JSON.stringify({action:'cancel_receipt',id})});
    await load();
  }catch(error){showNotice(error.message);await load().catch(()=>{});}
}

$('saveWarehouse').onclick=async()=>{try{if(!warehouseWriteAccess)return;await api('/api/warehouse',{method:'POST',body:JSON.stringify({action:'create_warehouse',code:$('whCode').value,name:$('whName').value,country:$('whCountry').value,city:$('whCity').value,address:$('whAddress').value,notes:$('whNotes').value})});note('whMsg','Almacén creado.',true);['whCode','whName','whCountry','whCity','whAddress','whNotes'].forEach(id=>$(id).value='');await load();}catch(e){note('whMsg',e.message);}};
$('saveProduct').onclick=async()=>{try{await api('/api/warehouse',{method:'POST',body:JSON.stringify({action:'create_product',sku:$('pSku').value,name:$('pName').value,brand:$('pBrand').value,category:$('pCategory').value,unit:$('pUnit').value,package_format:$('pFormat').value,default_units_per_pallet:$('pUnitsPallet').value,unit_weight_kg:$('pWeight').value,country_of_origin:$('pOrigin').value,hs_code:$('pHs').value,description:$('pDescription').value,notes:$('pNotes').value})});note('pMsg','Producto creado.',true);['pSku','pName','pBrand','pCategory','pUnit','pFormat','pUnitsPallet','pWeight','pOrigin','pHs','pDescription','pNotes'].forEach(id=>$(id).value='');await load();}catch(e){note('pMsg',e.message);}};
$('saveQuickProduct').onclick=async()=>{const btn=$('saveQuickProduct');try{btn.disabled=true;const d=await api('/api/warehouse',{method:'POST',body:JSON.stringify({action:'create_product',name:$('qpName').value,sku:$('qpSku').value,unit:$('qpUnit').value,brand:$('qpBrand').value,default_units_per_pallet:$('qpUnitsPallet').value,package_format:$('qpFormat').value})});const product=d.product;if(!product?.id)throw new Error('No se pudo crear el producto');products=[{...product,active:product.active!==false},...products.filter(x=>x.id!==product.id)];renderProducts();refreshProductOptions();const div=document.querySelector(`[data-line="${quickProductTarget}"]`);if(div){div.querySelector('.line-product').value=product.id;applyProductToLine(div);}note('qpMsg','Producto creado.',true);setTimeout(closeQuickProduct,250);}catch(e){note('qpMsg',e.message);}finally{btn.disabled=false;}};
$('saveReceipt').onclick=async()=>{const btn=$('saveReceipt');try{if(!warehouseWriteAccess)return;btn.disabled=true;const d=await api('/api/warehouse',{method:'POST',body:JSON.stringify({action:'create_receipt',warehouse_id:$('rWarehouse').value,received_at:$('rReceivedAt').value,supplier_id:$('rSupplier').value,reference_number:$('rReference').value,truck_reference:$('rTruck').value,driver_name:$('rDriver').value,notes:$('rNotes').value,items:collectLines()})});note('rMsg',`${d.receipt.receipt_number} registrada correctamente.`,true);await load();setTimeout(closeReceipt,450);}catch(e){note('rMsg',e.message);}finally{btn.disabled=!warehouseWriteAccess;}};

$('newReceipt').onclick=openReceipt;
$('closeReceipt').onclick=closeReceipt;
$('addLine').onclick=()=>addLine();
$('closeDetail').onclick=()=>$('detailModal').classList.add('hidden');
$('closeQuickProduct').onclick=closeQuickProduct;
$('receiptSearch').oninput=renderReceipts;
$('productSearch').oninput=renderProducts;
document.querySelectorAll('[data-receipt-view]').forEach(b=>b.onclick=()=>{receiptView=b.dataset.receiptView;document.querySelectorAll('[data-receipt-view]').forEach(x=>x.classList.toggle('active',x===b));renderReceipts();});
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));['receipts','warehouses','products'].forEach(name=>$(name+'Pane').classList.toggle('hidden',name!==b.dataset.tab));});
$('receiptModal').onclick=e=>{if(e.target===$('receiptModal'))closeReceipt();};
$('detailModal').onclick=e=>{if(e.target===$('detailModal'))$('detailModal').classList.add('hidden');};
$('quickProductModal').onclick=e=>{if(e.target===$('quickProductModal'))closeQuickProduct();};

load().catch(e=>document.body.innerHTML=`<div class="wrap"><div class="card bad">${esc(e.message)}</div></div>`);
