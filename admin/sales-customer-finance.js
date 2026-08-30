(() => {
  if(window.__salesCustomerFinanceInstalled)return;
  window.__salesCustomerFinanceInstalled=true;

  const byId=id=>document.getElementById(id);
  const token=()=>localStorage.getItem('export_mca_token')||'';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money=(value,currency='USD')=>{const n=Number(value);if(!Number.isFinite(n))return '—';try{return new Intl.NumberFormat('en-US',{style:'currency',currency:String(currency||'USD').toUpperCase(),maximumFractionDigits:2}).format(n);}catch{return `${currency||'USD'} ${n.toFixed(2)}`;}};
  const date=value=>value?new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString('es-US'):'—';
  const today=()=>new Date().toISOString().slice(0,10);
  const state={salesOrderId:null,finance:null,proformas:[],busy:false};
  const nativeWorkspace=window.SalesWorkspace||null;

  async function request(path,options={}){
    const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(token()?{Authorization:`Bearer ${token()}`}:{}) ,...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(response.status===401){localStorage.removeItem('export_mca_token');location.href='/admin/';throw new Error('Sesión vencida');}
    if(!response.ok)throw new Error(data.error||'No se pudo procesar la operación.');
    return data;
  }

  function setBusy(value){state.busy=Boolean(value);document.querySelectorAll('[data-cf-busy]').forEach(button=>button.disabled=state.busy);}
  function showMessage(value,ok=false){const node=byId('salesFinanceMsg');if(!node)return;node.textContent=value||'';node.className='msg '+(ok?'ok':'bad');}
  function status(value){return `<span class="sales-finance-status ${value==='posted'||value==='issued'?'ok':value==='reversed'||value==='void'?'bad':'warn'}">${esc(({posted:'Activo',reversed:'Revertido',draft:'Borrador',issued:'Emitida',void:'Anulada'})[value]||value||'—')}</span>`;}

  function ensureModals(){
    if(!byId('salesFinanceModal')){
      const modal=document.createElement('div');modal.id='salesFinanceModal';modal.className='modal hidden sales-finance-modal';
      modal.innerHTML=`<div class="dialog"><div class="dialog-head"><div><h2 id="salesFinanceTitle">Anticipos y Proformas</h2><div id="salesFinanceSubtitle" class="muted"></div></div><button type="button" class="btn" data-cf-close-main>Cerrar</button></div><div id="salesFinanceBody" class="sales-finance-body"></div><div id="salesFinanceMsg" class="msg" style="margin:0 18px 14px"></div></div>`;
      document.body.appendChild(modal);modal.querySelector('[data-cf-close-main]').onclick=()=>modal.classList.add('hidden');modal.addEventListener('click',event=>{if(event.target===modal)modal.classList.add('hidden');});
    }
    if(!byId('salesFinanceFormModal')){
      const modal=document.createElement('div');modal.id='salesFinanceFormModal';modal.className='modal hidden sales-finance-modal';
      modal.innerHTML=`<div class="dialog" style="width:min(650px,95vw)"><div class="dialog-head"><div><h2 id="salesFinanceFormTitle"></h2><div id="salesFinanceFormSubtitle" class="muted"></div></div><button type="button" class="btn" data-cf-form-close>Cerrar</button></div><div class="sales-finance-body"><div id="salesFinanceFormBody"></div><div class="sales-finance-form-actions"><button type="button" class="btn" data-cf-form-close>Cancelar</button><button type="button" id="salesFinanceFormSave" class="btn orange" data-cf-busy>Guardar</button></div><div id="salesFinanceFormMsg" class="msg"></div></div></div>`;
      document.body.appendChild(modal);modal.querySelectorAll('[data-cf-form-close]').forEach(button=>button.onclick=()=>modal.classList.add('hidden'));modal.addEventListener('click',event=>{if(event.target===modal)modal.classList.add('hidden');});
    }
    if(!byId('salesFinanceDecisionModal')){
      const modal=document.createElement('div');modal.id='salesFinanceDecisionModal';modal.className='modal hidden sales-finance-modal';
      modal.innerHTML=`<div class="dialog" style="width:min(520px,94vw)"><div class="dialog-head"><div><h2 id="salesFinanceDecisionTitle"></h2></div><button type="button" class="btn" data-cf-decision-close>Cerrar</button></div><div class="sales-finance-body"><div id="salesFinanceDecisionCopy" class="sales-finance-meta" style="font-size:12px"></div><div class="sales-finance-form-actions"><button type="button" class="btn" data-cf-decision-close>Cancelar</button><button type="button" id="salesFinanceDecisionAccept" class="btn orange" data-cf-busy>Continuar</button></div><div id="salesFinanceDecisionMsg" class="msg"></div></div></div>`;
      document.body.appendChild(modal);modal.querySelectorAll('[data-cf-decision-close]').forEach(button=>button.onclick=()=>modal.classList.add('hidden'));modal.addEventListener('click',event=>{if(event.target===modal)modal.classList.add('hidden');});
    }
  }

  function openForm({title,subtitle='',html,onOpen,onSave,saveLabel='Guardar'}){
    ensureModals();byId('salesFinanceFormTitle').textContent=title;byId('salesFinanceFormSubtitle').textContent=subtitle;byId('salesFinanceFormBody').innerHTML=html;byId('salesFinanceFormMsg').textContent='';byId('salesFinanceFormSave').textContent=saveLabel;
    byId('salesFinanceFormSave').onclick=async()=>{if(state.busy)return;setBusy(true);byId('salesFinanceFormMsg').textContent='';try{await onSave();byId('salesFinanceFormModal').classList.add('hidden');await refreshAll({refreshNative:true});}catch(error){byId('salesFinanceFormMsg').textContent=error.message;}finally{setBusy(false);}};
    byId('salesFinanceFormModal').classList.remove('hidden');onOpen?.();
  }

  function askAction({title,message,acceptLabel='Continuar',onAccept}){
    ensureModals();byId('salesFinanceDecisionTitle').textContent=title;byId('salesFinanceDecisionCopy').textContent=message;byId('salesFinanceDecisionAccept').textContent=acceptLabel;byId('salesFinanceDecisionMsg').textContent='';
    byId('salesFinanceDecisionAccept').onclick=async()=>{if(state.busy)return;setBusy(true);try{await onAccept();byId('salesFinanceDecisionModal').classList.add('hidden');await refreshAll({refreshNative:true});}catch(error){byId('salesFinanceDecisionMsg').textContent=error.message;}finally{setBusy(false);}};
    byId('salesFinanceDecisionModal').classList.remove('hidden');
  }

  async function fetchData(){
    if(!state.salesOrderId)return;
    const [finance,proformas]=await Promise.all([
      request(`/api/customer-advances?sales_order_id=${encodeURIComponent(state.salesOrderId)}`),
      request(`/api/proformas?sales_order_id=${encodeURIComponent(state.salesOrderId)}`)
    ]);
    state.finance=finance;state.proformas=proformas.proformas||[];
  }

  function metric(label,value){return `<div class="sales-finance-metric"><span>${esc(label)}</span><b title="${esc(value)}">${esc(value)}</b></div>`;}

  function render(){
    ensureModals();const p=state.finance?.progress;if(!p){byId('salesFinanceBody').innerHTML='<div class="sales-finance-empty">No se pudo cargar el estado financiero de esta venta.</div>';return;}
    const currency=p.currency||'USD',advances=state.finance?.advances||[],invoices=state.finance?.invoices||[];
    byId('salesFinanceTitle').textContent=`${p.so_number||'Venta'} · Anticipos y Proformas`;
    byId('salesFinanceSubtitle').textContent='El anticipo es dinero recibido antes de la factura. Aplicarlo a una factura no vuelve a contar caja.';
    byId('salesFinanceBody').innerHTML=`
      <div class="sales-finance-metrics">
        ${metric('Venta',money(p.sales_order_total,currency))}${metric('Anticipos recibidos',money(p.advance_cash_received,currency))}${metric('Anticipo disponible',money(p.advance_available_amount,currency))}${metric('Facturado',money(p.issued_invoice_total,currency))}${metric('Cash recibido neto',money(p.cash_received_net,currency))}${metric('Saldo facturas',money(p.invoice_balance_due,currency))}
      </div>
      <section class="sales-finance-section"><div class="sales-finance-section-head"><div><h3>Anticipos del cliente</h3><p>Cash recibido vinculado a esta venta. No requiere inventario ni factura.</p></div><button type="button" class="btn orange" data-cf-register>Registrar anticipo</button></div>
        <div class="sales-finance-list">${advances.length?advances.map(renderAdvance).join(''):'<div class="sales-finance-empty">Todavía no hay anticipos registrados para esta venta.</div>'}</div>
      </section>
      <section class="sales-finance-section"><div class="sales-finance-section-head"><div><h3>Proformas</h3><p>Solicitud comercial de pago. No crea AR, revenue, inventario ni fulfillment.</p></div><button type="button" class="btn" data-cf-new-proforma>Nueva Proforma</button></div>
        <div class="sales-finance-list">${state.proformas.length?state.proformas.map(renderProforma).join(''):'<div class="sales-finance-empty">Todavía no hay Proformas para esta venta.</div>'}</div>
      </section>
      <section class="sales-finance-section"><div class="sales-finance-section-head"><div><h3>Facturas emitidas</h3><p>Las aplicaciones de anticipos liquidan factura pero no representan una nueva entrada de caja.</p></div></div>
        <div class="sales-finance-list">${invoices.length?invoices.map(row=>`<div class="sales-finance-row"><div class="sales-finance-row-head"><div><div class="sales-finance-title">${esc(row.invoice_number||'Factura')}</div><div class="sales-finance-meta">${date(row.issue_date)} · ${status(row.payment_status)}</div></div><b>${money(row.total,row.currency)}</b></div><div class="sales-finance-values"><span>Cash posterior: <b>${money(row.cash_payment_amount,row.currency)}</b></span><span>Anticipo aplicado: <b>${money(row.advance_applied_amount,row.currency)}</b></span><span>Saldo: <b>${money(row.balance_due,row.currency)}</b></span></div></div>`).join(''):'<div class="sales-finance-empty">No hay facturas emitidas.</div>'}</div>
      </section>`;
    bindMainEvents();
  }

  function renderAdvance(row){
    const currency=row.currency||state.finance?.progress?.currency||'USD',active=row.status==='posted',hasActiveApplications=(row.applications||[]).some(item=>item.status==='posted'),hasActiveRefunds=(row.refunds||[]).some(item=>item.status==='posted');
    const history=[...(row.applications||[]).map(item=>`Aplicado ${money(item.amount,currency)} a ${item.invoice?.invoice_number||'factura'} · ${status(item.status)}`),...(row.refunds||[]).map(item=>`Reembolso ${item.refund_number||''} ${money(item.amount,currency)} · ${status(item.status)}`)];
    return `<div class="sales-finance-row"><div class="sales-finance-row-head"><div><div class="sales-finance-title">${esc(row.advance_number)}</div><div class="sales-finance-meta">${date(row.received_date)}${row.method?` · ${esc(row.method)}`:''}${row.reference?` · ${esc(row.reference)}`:''}</div></div>${status(row.status)}</div><div class="sales-finance-values"><span>Recibido: <b>${money(row.amount,currency)}</b></span><span>Aplicado: <b>${money(row.applied_amount,currency)}</b></span><span>Reembolsado: <b>${money(row.refunded_amount,currency)}</b></span><span>Disponible: <b>${money(row.available_amount,currency)}</b></span></div>${history.length?`<div class="sales-finance-meta">${history.map(esc).join('<br>')}</div>`:''}<div class="sales-finance-actions">${active&&Number(row.available_amount)>0?`<button class="btn" data-cf-apply="${esc(row.customer_advance_id)}">Aplicar a factura</button><button class="btn" data-cf-refund="${esc(row.customer_advance_id)}">Reembolsar</button>`:''}${active&&!hasActiveApplications&&!hasActiveRefunds?`<button class="btn" data-cf-reverse="${esc(row.customer_advance_id)}">Reversar registro</button>`:''}${(row.applications||[]).filter(item=>item.status==='posted').map(item=>`<button class="btn" data-cf-reverse-app="${esc(item.id)}">Reversar aplicación</button>`).join('')}${(row.refunds||[]).filter(item=>item.status==='posted').map(item=>`<button class="btn" data-cf-reverse-refund="${esc(item.id)}">Reversar reembolso</button>`).join('')}</div></div>`;
  }

  function renderProforma(row){
    return `<div class="sales-finance-row"><div class="sales-finance-row-head"><div><div class="sales-finance-title">${esc(row.proforma_number)}</div><div class="sales-finance-meta">${date(row.issue_date)}${row.valid_until?` · Válida hasta ${date(row.valid_until)}`:''}</div></div><div>${status(row.status)}</div></div><div class="sales-finance-values"><span>Total: <b>${money(row.financial?.total,row.currency)}</b></span><span>Líneas: <b>${esc(row.financial?.item_count??row.items?.length??0)}</b></span></div><div class="sales-finance-actions">${row.status==='draft'?`<button class="btn orange" data-cf-issue-proforma="${esc(row.id)}">Emitir</button>`:''}${row.status!=='void'?`<button class="btn" data-cf-print-proforma="${esc(row.id)}">Ver / imprimir</button>`:''}${['draft','issued'].includes(row.status)?`<button class="btn" data-cf-void-proforma="${esc(row.id)}">Anular</button>`:''}</div></div>`;
  }

  function bindMainEvents(){
    byId('salesFinanceBody').querySelector('[data-cf-register]')?.addEventListener('click',openRegisterAdvance);
    byId('salesFinanceBody').querySelector('[data-cf-new-proforma]')?.addEventListener('click',openNewProforma);
    byId('salesFinanceBody').querySelectorAll('[data-cf-apply]').forEach(button=>button.onclick=()=>openApply(button.dataset.cfApply));
    byId('salesFinanceBody').querySelectorAll('[data-cf-refund]').forEach(button=>button.onclick=()=>openRefund(button.dataset.cfRefund));
    byId('salesFinanceBody').querySelectorAll('[data-cf-reverse]').forEach(button=>button.onclick=()=>openReasonAction('Reversar anticipo','Este reverso corrige un registro erróneo; no representa un reembolso al cliente.',reason=>postAdvance({action:'reverse',customer_advance_id:button.dataset.cfReverse,reason})));
    byId('salesFinanceBody').querySelectorAll('[data-cf-reverse-app]').forEach(button=>button.onclick=()=>openReasonAction('Reversar aplicación','La factura recuperará ese saldo y el anticipo volverá a estar disponible.',reason=>postAdvance({action:'reverse_application',application_id:button.dataset.cfReverseApp,reason})));
    byId('salesFinanceBody').querySelectorAll('[data-cf-reverse-refund]').forEach(button=>button.onclick=()=>openReasonAction('Reversar reembolso','Corrige el registro del reembolso y restaura el saldo disponible del anticipo.',reason=>postAdvance({action:'reverse_refund',refund_id:button.dataset.cfReverseRefund,reason})));
    byId('salesFinanceBody').querySelectorAll('[data-cf-issue-proforma]').forEach(button=>button.onclick=()=>askAction({title:'Emitir Proforma',message:'La Proforma quedará emitida como snapshot comercial de la venta. No crea una factura financiera.',acceptLabel:'Emitir',onAccept:()=>postProforma({action:'issue',proforma_id:button.dataset.cfIssueProforma})}));
    byId('salesFinanceBody').querySelectorAll('[data-cf-void-proforma]').forEach(button=>button.onclick=()=>openReasonAction('Anular Proforma','La Proforma se conservará en historial como anulada.',reason=>postProforma({action:'void',proforma_id:button.dataset.cfVoidProforma,reason})));
    byId('salesFinanceBody').querySelectorAll('[data-cf-print-proforma]').forEach(button=>button.onclick=()=>printProforma(button.dataset.cfPrintProforma));
  }

  function openRegisterAdvance(){
    const currency=state.finance?.progress?.currency||'USD';
    openForm({title:'Registrar anticipo',subtitle:'Dinero recibido del cliente antes o independientemente de la factura.',html:`<div class="sales-finance-form"><div><label>Monto (${esc(currency)}) *</label><input id="cfAdvanceAmount" type="number" min="0" step="0.01"></div><div><label>Fecha recibida</label><input id="cfAdvanceDate" type="date" value="${today()}"></div><div><label>Método</label><input id="cfAdvanceMethod" placeholder="Wire, ACH, efectivo..."></div><div><label>Referencia</label><input id="cfAdvanceReference"></div><div class="full"><label>Nota</label><textarea id="cfAdvanceNotes"></textarea></div></div>`,onSave:()=>postAdvance({action:'register',sales_order_id:state.salesOrderId,amount:byId('cfAdvanceAmount').value,received_date:byId('cfAdvanceDate').value,method:byId('cfAdvanceMethod').value,reference:byId('cfAdvanceReference').value,notes:byId('cfAdvanceNotes').value})});
  }

  function openApply(advanceId){
    const advance=(state.finance?.advances||[]).find(row=>row.customer_advance_id===advanceId),invoices=(state.finance?.invoices||[]).filter(row=>Number(row.balance_due)>0);
    if(!advance||!invoices.length){showMessage('No hay una factura emitida con saldo pendiente para aplicar este anticipo.');return;}
    openForm({title:`Aplicar ${advance.advance_number}`,subtitle:`Disponible: ${money(advance.available_amount,advance.currency)}. La aplicación no mueve caja.`,html:`<div class="sales-finance-form"><div class="full"><label>Factura *</label><select id="cfApplyInvoice">${invoices.map(row=>`<option value="${esc(row.invoice_id)}">${esc(row.invoice_number)} · saldo ${esc(money(row.balance_due,row.currency))}</option>`).join('')}</select></div><div><label>Monto *</label><input id="cfApplyAmount" type="number" min="0" step="0.01"></div><div><label>Disponible anticipo</label><input value="${esc(money(advance.available_amount,advance.currency))}" disabled></div><div class="full"><label>Nota</label><textarea id="cfApplyNotes"></textarea></div></div>`,onSave:()=>postAdvance({action:'apply',customer_advance_id:advanceId,invoice_id:byId('cfApplyInvoice').value,amount:byId('cfApplyAmount').value,notes:byId('cfApplyNotes').value})});
  }

  function openRefund(advanceId){
    const advance=(state.finance?.advances||[]).find(row=>row.customer_advance_id===advanceId);if(!advance)return;
    openForm({title:`Reembolsar ${advance.advance_number}`,subtitle:`Disponible para reembolso: ${money(advance.available_amount,advance.currency)}. Esto representa una salida real de dinero.`,html:`<div class="sales-finance-form"><div><label>Monto *</label><input id="cfRefundAmount" type="number" min="0" step="0.01"></div><div><label>Fecha</label><input id="cfRefundDate" type="date" value="${today()}"></div><div><label>Método</label><input id="cfRefundMethod"></div><div><label>Referencia</label><input id="cfRefundReference"></div><div class="full"><label>Nota</label><textarea id="cfRefundNotes"></textarea></div></div>`,onSave:()=>postAdvance({action:'refund',customer_advance_id:advanceId,amount:byId('cfRefundAmount').value,refund_date:byId('cfRefundDate').value,method:byId('cfRefundMethod').value,reference:byId('cfRefundReference').value,notes:byId('cfRefundNotes').value})});
  }

  function openReasonAction(title,subtitle,onSubmit){
    openForm({title,subtitle,saveLabel:'Confirmar',html:'<div class="sales-finance-form"><div class="full"><label>Motivo *</label><textarea id="cfReason" required></textarea></div></div>',onSave:()=>{const reason=String(byId('cfReason').value||'').trim();if(!reason)throw new Error('Indica el motivo.');return onSubmit(reason);}});
  }

  function openNewProforma(){
    const inSeven=new Date();inSeven.setDate(inSeven.getDate()+7);const valid=inSeven.toISOString().slice(0,10);
    openForm({title:'Nueva Proforma',subtitle:'Se crea desde la mercancía y precios actuales de la Sales Order como snapshot comercial.',html:`<div class="sales-finance-form"><div><label>Fecha</label><input id="cfProformaDate" type="date" value="${today()}"></div><div><label>Válida hasta</label><input id="cfProformaValid" type="date" value="${valid}"></div><div class="full"><label>Nota / condiciones</label><textarea id="cfProformaNotes"></textarea></div></div>`,onSave:()=>postProforma({action:'create',sales_order_id:state.salesOrderId,issue_date:byId('cfProformaDate').value,valid_until:byId('cfProformaValid').value,notes:byId('cfProformaNotes').value})});
  }

  async function postAdvance(payload){await request('/api/customer-advances',{method:'POST',body:JSON.stringify(payload)});}
  async function postProforma(payload){await request('/api/proformas',{method:'POST',body:JSON.stringify(payload)});}

  function printProforma(id){
    const row=state.proformas.find(item=>item.id===id);if(!row)return;
    const w=window.open('','_blank','noopener,noreferrer');if(!w){showMessage('El navegador bloqueó la ventana de impresión.');return;}
    const items=(row.items||[]).map(item=>`<tr><td>${esc(item.sku||'')}</td><td>${esc(item.description)}</td><td class="num">${esc(item.quantity)}</td><td>${esc(item.unit)}</td><td class="num">${esc(money(item.unit_price,row.currency))}</td><td class="num">${esc(money(item.line_total,row.currency))}</td></tr>`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(row.proforma_number)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#172033;margin:0;background:#fff}.page{max-width:850px;margin:0 auto;padding:42px}.top{display:flex;justify-content:space-between;gap:30px;border-bottom:3px solid #f58220;padding-bottom:16px}.brand{font-size:22px;font-weight:800;color:#06204a}.doc{text-align:right}.doc h1{margin:0;color:#06204a;font-size:24px}.meta{margin-top:4px;color:#667085;font-size:12px}.notice{margin:18px 0;padding:10px 12px;background:#f7f9fc;border:1px solid #dfe5ec;font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:20px 0}.label{font-size:10px;text-transform:uppercase;color:#667085;font-weight:700}.value{margin-top:4px;font-weight:600}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:9px 7px;border-bottom:1px solid #e5e8ed;text-align:left;font-size:12px}th{font-size:10px;text-transform:uppercase;color:#667085;background:#f7f9fc}.num{text-align:right}.total{margin-top:18px;text-align:right;font-size:18px;font-weight:800;color:#06204a}.notes{margin-top:24px;font-size:12px;color:#475467}.footer{margin-top:40px;border-top:1px solid #e5e8ed;padding-top:12px;font-size:10px;color:#667085}@media print{.page{padding:24px}.no-print{display:none}}</style></head><body><div class="page"><div class="top"><div><div class="brand">EXPORT MCA LLC</div><div class="meta">Miami, Florida, USA<br>info@exportmca.com · +1 (786) 800-0735</div></div><div class="doc"><h1>PROFORMA INVOICE</h1><div class="meta">${esc(row.proforma_number)}<br>${esc(date(row.issue_date))}${row.valid_until?` · Valid until ${esc(date(row.valid_until))}`:''}</div></div></div><div class="notice">Commercial quotation / payment request. This document is not the final financial invoice and does not by itself create accounts receivable.</div><div class="grid"><div><div class="label">Sales Order</div><div class="value">${esc(state.finance?.progress?.so_number||'—')}</div></div><div><div class="label">Currency</div><div class="value">${esc(row.currency)}</div></div></div><table><thead><tr><th>SKU</th><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>${items}</tbody></table><div class="total">Total ${esc(money(row.financial?.total,row.currency))}</div>${row.notes?`<div class="notes"><b>Notes / terms</b><br>${esc(row.notes)}</div>`:''}<div class="footer">Generated from immutable Proforma snapshot ${esc(row.proforma_number)}.</div><div class="no-print" style="margin-top:20px;text-align:right"><button onclick="window.print()">Print / Save PDF</button></div></div></body></html>`);w.document.close();
  }

  async function refreshAll({refreshNative=false}={}){await fetchData();render();augmentBillingTab();if(refreshNative)await nativeWorkspace?.reload?.({keepTab:true});updateHeaderButton();}
  async function open(salesOrderId){state.salesOrderId=String(salesOrderId||'')||null;if(!state.salesOrderId)return;ensureModals();byId('salesFinanceBody').innerHTML='<div class="sales-finance-empty">Cargando…</div>';byId('salesFinanceModal').classList.remove('hidden');try{await fetchData();render();}catch(error){byId('salesFinanceBody').innerHTML=`<div class="sales-finance-empty">${esc(error.message)}</div>`;}}

  function augmentBillingTab(){
    const content=byId('detailBody')?.querySelector('.sales-workspace-content');if(!content||byId('salesFinanceInline'))return;const p=state.finance?.progress;if(!p)return;
    const box=document.createElement('div');box.id='salesFinanceInline';box.className='sales-finance-inline-summary';box.innerHTML=`<div class="sales-ws-row-head"><div><div class="sales-ws-row-title">Anticipos del cliente</div><div class="sales-ws-meta">Cash previo a factura y aplicaciones sin doble conteo.</div></div><button type="button" class="btn" data-cf-open-inline>Administrar</button></div><div class="sales-finance-values"><span>Recibido: <b>${esc(money(p.advance_cash_received,p.currency))}</b></span><span>Disponible: <b>${esc(money(p.advance_available_amount,p.currency))}</b></span><span>Cash neto venta: <b>${esc(money(p.cash_received_net,p.currency))}</b></span></div>`;content.appendChild(box);box.querySelector('[data-cf-open-inline]').onclick=()=>open(state.salesOrderId);
  }

  function updateHeaderButton(){const button=byId('openCustomerFinance');if(!button)return;button.classList.toggle('hidden',!state.salesOrderId);button.onclick=()=>open(state.salesOrderId);}

  if(nativeWorkspace){
    window.SalesWorkspace=Object.freeze({...nativeWorkspace,
      open:async salesOrderId=>{state.salesOrderId=String(salesOrderId||'')||null;const result=await nativeWorkspace.open(salesOrderId);updateHeaderButton();fetchData().then(()=>{const active=byId('detailBody')?.querySelector('[data-ws-tab].active')?.dataset.wsTab;if(active==='billing')augmentBillingTab();}).catch(()=>{});return result;},
      reload:async options=>{const result=await nativeWorkspace.reload(options);updateHeaderButton();fetchData().then(()=>{const active=byId('detailBody')?.querySelector('[data-ws-tab].active')?.dataset.wsTab;if(active==='billing')augmentBillingTab();}).catch(()=>{});return result;},
      openCustomerFinance:open,
      owner:'sales-customer-finance.js'
    });
  }

  document.addEventListener('click',event=>{const tab=event.target.closest('#detailBody [data-ws-tab]');if(tab?.dataset.wsTab==='billing')queueMicrotask(()=>{fetchData().then(augmentBillingTab).catch(()=>{});});});
  updateHeaderButton();
  window.SalesCustomerFinance=Object.freeze({open,refresh:refreshAll,owner:'sales-customer-finance.js'});
})();
