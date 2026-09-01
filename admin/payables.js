(() => {
  const $ = id => document.getElementById(id);
  const state = { bills:[], purchaseOrders:[], payments:[], postedBills:[], paymentPOs:[], writeAccess:false, entity:'bills', view:'open', search:'', editingBillId:null, allocationPaymentId:null, reversePaymentId:null };
  const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const num = value => Number(value || 0);
  const money = (value, currency='USD') => `${currency} ${num(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const inputNumber = (value, decimals=8) => { const parsed = Number(value); if (!Number.isFinite(parsed)) return ''; return String(Number(parsed.toFixed(decimals))); };
  const date = value => value ? new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString() : '—';
  const supplierName = row => row?.supplier?.legal_name || row?.supplier?.name || 'Proveedor';
  const token = () => localStorage.getItem('export_mca_token') || '';
  const actionAllowed = (row,action) => row?.capabilities?.actions?.[action]?.allowed === true;

  async function request(url, options={}) {
    const response = await fetch(url, { ...options, headers:{ 'Content-Type':'application/json', ...(token() ? { Authorization:`Bearer ${token()}` } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo procesar Cuentas por pagar');
    return data;
  }

  async function refresh() {
    const [ap, payments] = await Promise.all([request('/api/payables'), request('/api/supplier-payments')]);
    state.bills = Array.isArray(ap.bills) ? ap.bills : [];
    state.purchaseOrders = Array.isArray(ap.purchase_orders) ? ap.purchase_orders : [];
    state.payments = Array.isArray(payments.payments) ? payments.payments : [];
    state.postedBills = Array.isArray(payments.bills) ? payments.bills : [];
    state.paymentPOs = Array.isArray(payments.purchase_orders) ? payments.purchase_orders : [];
    state.writeAccess = ap.write_access === true && payments.write_access === true;
    if ($('newBill')) { $('newBill').disabled=!state.writeAccess; $('newBill').setAttribute('aria-disabled',String(!state.writeAccess)); }
    render();
    parent?.dispatchEvent?.(new CustomEvent('export-mca:data-loaded'));
  }

  function billPill(bill) {
    if (bill.status === 'void') return '<span class="pill off">Anulada</span>';
    if (bill.status === 'draft') return '<span class="pill warn">Borrador</span>';
    const f = bill.financial || {};
    if (f.payment_status === 'paid') return '<span class="pill ok">Pagada</span>';
    if (f.overdue) return '<span class="pill bad">Vencida</span>';
    if (f.payment_status === 'partial') return '<span class="pill warn">Parcial</span>';
    return '<span class="pill">Por pagar</span>';
  }

  function paymentPill(payment) {
    if (payment.status === 'reversed') return '<span class="pill off">Revertido</span>';
    const s = payment.progress?.application_status;
    if (s === 'applied') return '<span class="pill ok">Aplicado</span>';
    if (s === 'partial') return '<span class="pill warn">Parcial</span>';
    return '<span class="pill">Sin aplicar</span>';
  }

  function renderMetrics() {
    const postedBills = state.bills.filter(b => b.status === 'posted');
    const balance = postedBills.reduce((sum,b) => sum + num(b.financial?.balance_due),0);
    const overdue = postedBills.filter(b => b.financial?.overdue).length;
    const postedPayments = state.payments.filter(p => p.status === 'posted');
    const cashPaid = postedPayments.reduce((sum,p) => sum + num(p.amount),0);
    const unapplied = postedPayments.reduce((sum,p) => sum + num(p.progress?.unapplied_amount),0);
    $('metrics').innerHTML = [
      ['Facturas',state.bills.filter(b => b.status !== 'void').length],['Por pagar',money(balance)],['Vencidas',overdue],['Pagado',money(cashPaid)],['Anticipos sin aplicar',money(unapplied)]
    ].map(([label,value]) => `<div class="metric"><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join('');
  }

  function renderViewTabs() {
    const views = state.entity === 'bills' ? [['open','Abiertas'],['draft','Borradores'],['paid','Pagadas'],['all','Todas']] : [['active','Activos'],['unapplied','Sin aplicar'],['reversed','Revertidos'],['all','Todos']];
    if (!views.some(([id]) => id === state.view)) state.view = views[0][0];
    $('viewTabs').innerHTML = views.map(([id,label]) => `<button class="btn ${state.view===id?'active':''}" data-view="${id}">${label}</button>`).join('');
  }

  function billMatches(bill) {
    if (state.view === 'draft' && bill.status !== 'draft') return false;
    if (state.view === 'paid' && !(bill.status === 'posted' && bill.financial?.payment_status === 'paid')) return false;
    if (state.view === 'open' && (bill.status === 'void' || (bill.status === 'posted' && bill.financial?.payment_status === 'paid'))) return false;
    const q = state.search.toLowerCase(); if (!q) return true;
    return [bill.bill_number,bill.supplier_invoice_number,bill.purchase_order?.po_number,bill.purchase_order?.supplier_reference,supplierName(bill),bill.status,bill.financial?.payment_status].join(' ').toLowerCase().includes(q);
  }

  function paymentMatches(payment) {
    if (state.view === 'active' && payment.status !== 'posted') return false;
    if (state.view === 'unapplied' && !(payment.status === 'posted' && num(payment.progress?.unapplied_amount) > 0)) return false;
    if (state.view === 'reversed' && payment.status !== 'reversed') return false;
    const q = state.search.toLowerCase(); if (!q) return true;
    return [payment.payment_number,payment.purchase_order?.po_number,payment.purchase_order?.supplier_reference,supplierName(payment),payment.reference,payment.method,payment.status,payment.progress?.application_status].join(' ').toLowerCase().includes(q);
  }

  function renderBills() {
    const rows = state.bills.filter(billMatches);
    if (!rows.length) return '<div class="empty">No hay facturas de proveedor para esta vista.</div>';
    return rows.map(bill => {
      const f = bill.financial || {};
      const actions = [`<button class="btn" data-bill-detail="${esc(bill.id)}">Ver</button>`];
      if (actionAllowed(bill,'edit')) actions.push(`<button class="btn" data-bill-edit="${esc(bill.id)}">Editar</button>`);
      if (actionAllowed(bill,'post')) actions.push(`<button class="btn primary" data-bill-post="${esc(bill.id)}">Contabilizar</button>`);
      if (actionAllowed(bill,'void')) actions.push(`<button class="btn danger" data-bill-void="${esc(bill.id)}">Anular</button>`);
      return `<div class="row"><div><div class="po">${esc(bill.bill_number)}</div><div class="small">${esc(bill.supplier_invoice_number || 'Sin nº proveedor')}</div></div><div><b>${esc(supplierName(bill))}</b></div><div><b>${esc(bill.purchase_order?.po_number || '—')}</b><div class="small">${date(bill.bill_date)}</div></div><div>${billPill(bill)}</div><div><b>${esc(money(f.bill_total,bill.currency))}</b></div><div><b>${esc(money(f.balance_due,bill.currency))}</b><div class="small">Saldo</div></div><div class="actions">${actions.join('')}</div></div>`;
    }).join('');
  }

  function renderPayments() {
    const rows = state.payments.filter(paymentMatches);
    if (!rows.length) return '<div class="empty">No hay pagos de proveedor para esta vista.</div>';
    return rows.map(payment => {
      const p = payment.progress || {};
      const actions = [`<button class="btn" data-payment-detail="${esc(payment.id)}">Ver</button>`];
      if (actionAllowed(payment,'allocate')) actions.push(`<button class="btn orange" data-allocate="${esc(payment.id)}">Aplicar</button>`);
      if (actionAllowed(payment,'reverse')) actions.push(`<button class="btn danger" data-reverse="${esc(payment.id)}">Revertir</button>`);
      return `<div class="row"><div><div class="po">${esc(payment.payment_number)}</div><div class="small">${date(payment.payment_date)}</div></div><div><b>${esc(supplierName(payment))}</b></div><div><b>${esc(payment.purchase_order?.po_number || '—')}</b><div class="small">${esc(payment.reference || '')}</div></div><div>${paymentPill(payment)}</div><div><b>${esc(money(payment.amount,payment.currency))}</b></div><div><b>${esc(money(p.unapplied_amount,payment.currency))}</b><div class="small">Sin aplicar</div></div><div class="actions">${actions.join('')}</div></div>`;
    }).join('');
  }

  function render() {
    renderMetrics(); renderViewTabs();
    document.querySelectorAll('[data-entity]').forEach(btn => btn.classList.toggle('active',btn.dataset.entity===state.entity));
    $('list').innerHTML = state.entity === 'bills' ? renderBills() : renderPayments();
  }

  function setModal(id,open) { $(id)?.classList.toggle('hidden',!open); }
  function message(id,value,good=false) { const n=$(id); if (!n) return; n.textContent=value || ''; n.classList.toggle('ok',Boolean(good)); }

  function eligiblePOs(editingBill=null) {
    return state.purchaseOrders.filter(po => po.items?.some(item => { const own = editingBill?.items?.find(line => line.purchase_order_item_id === item.id); return num(item.ap_progress?.available_to_bill_quantity) + num(own?.billed_quantity) > 0; }));
  }
  function fillBillPOs(editingBill=null) { $('bPO').innerHTML = '<option value="">Selecciona una Purchase Order</option>' + eligiblePOs(editingBill).map(po => `<option value="${esc(po.id)}">${esc(po.po_number)} · ${esc(supplierName(po))}</option>`).join(''); }

  function updateBillPreview() {
    const po = state.purchaseOrders.find(row => String(row.id) === String($('bPO').value)); const preview = $('billCalculatedTotal'); if (!preview) return;
    const total = [...document.querySelectorAll('[data-bill-line]')].reduce((sum,node) => { const qty=num(node.querySelector('[data-qty]')?.value); if (!(qty>0)) return sum; return sum + (node.dataset.pricingMode==='total' ? num(node.querySelector('[data-total]')?.value) : qty*num(node.querySelector('[data-cost]')?.value)); },0);
    preview.textContent = `Total factura: ${money(total,po?.currency || 'USD')}`;
  }

  function syncBillLine(node, source='qty') {
    if (!node) return; const qtyInput=node.querySelector('[data-qty]'), costInput=node.querySelector('[data-cost]'), totalInput=node.querySelector('[data-total]'), hint=node.querySelector('[data-price-hint]'), qty=num(qtyInput?.value);
    if (source==='total') node.dataset.pricingMode='total'; if (source==='cost') node.dataset.pricingMode='unit';
    if (node.dataset.pricingMode==='total') { const total=num(totalInput?.value); if(costInput)costInput.value=qty>0&&totalInput?.value!==''?inputNumber(total/qty):''; if(hint)hint.textContent='Importe exacto: Total facturado'; }
    else { const cost=num(costInput?.value); if(totalInput)totalInput.value=qty>0&&costInput?.value!==''?inputNumber(qty*cost,6):''; if(hint)hint.textContent='Importe calculado: Cantidad × costo unitario'; }
    updateBillPreview();
  }

  function renderBillLines(editingBill=null) {
    const po=state.purchaseOrders.find(row=>String(row.id)===String($('bPO').value)); if(!po){$('billLines').innerHTML='<div class="empty">Selecciona una Purchase Order.</div>';updateBillPreview();return;}
    const rows=(po.items||[]).map(item=>{const own=editingBill?.items?.find(line=>line.purchase_order_item_id===item.id);const available=num(item.ap_progress?.available_to_bill_quantity)+num(own?.billed_quantity);if(available<=0&&!own)return'';const product=item.product||{};const label=product.sku?`${product.sku} · ${product.name||''}`:(product.name||'Producto');const qty=own?num(own.billed_quantity):available;const cost=own?num(own.unit_cost):num(item.unit_cost);const pricingMode=own?.pricing_mode==='total'?'total':'unit';const lineTotal=own?num(own.line_total):qty*cost;const hint=pricingMode==='total'?'Importe exacto: Total facturado':'Importe calculado: Cantidad × costo unitario';return `<div class="line" data-bill-line="${esc(item.id)}" data-pricing-mode="${pricingMode}"><div class="line-head"><div><div class="line-title">${esc(label)}</div><div class="small">Ordenado ${esc(item.ordered_quantity)} ${esc(item.unit)} · Disponible ${esc(available)} · Costo PO ${esc(money(item.unit_cost,po.currency))}</div><div class="small" data-price-hint>${esc(hint)}</div></div></div><div class="grid4"><div><label>Cantidad</label><input data-qty type="number" min="0" max="${esc(available)}" step="any" value="${esc(qty)}"></div><div><label>Costo unitario</label><input data-cost type="number" min="0" step="any" value="${esc(inputNumber(cost))}"></div><div><label>Total facturado</label><input data-total type="number" min="0" step="0.01" value="${esc(inputNumber(lineTotal,6))}"></div><div><label>Nota</label><input data-note value="${esc(own?.notes||'')}"></div></div></div>`;}).filter(Boolean);
    $('billLines').innerHTML=rows.length?rows.join(''):'<div class="empty">Esta PO no tiene saldo disponible para facturar.</div>';updateBillPreview();
  }

  function openBillCreate() { if(!state.writeAccess)return; state.editingBillId=null;$('billTitle').textContent='Nueva factura de proveedor';fillBillPOs();$('bPO').disabled=false;$('bPO').value='';$('bSupplierInvoice').value='';$('bDate').value=new Date().toISOString().slice(0,10);$('bDue').value='';$('bNotes').value='';$('billLines').innerHTML='<div class="empty">Selecciona una Purchase Order.</div>';message('billMsg','');updateBillPreview();setModal('billModal',true); }
  function openBillEdit(id) { const bill=state.bills.find(row=>String(row.id)===String(id));if(!bill||!actionAllowed(bill,'edit'))return;state.editingBillId=bill.id;$('billTitle').textContent=`Editar ${bill.bill_number}`;fillBillPOs(bill);$('bPO').value=bill.purchase_order_id;$('bPO').disabled=false;$('bSupplierInvoice').value=bill.supplier_invoice_number||'';$('bDate').value=String(bill.bill_date||'').slice(0,10);$('bDue').value=String(bill.due_date||'').slice(0,10);$('bNotes').value=bill.notes||'';renderBillLines(bill);message('billMsg','');setModal('billModal',true); }

  function collectBillLines() { return [...document.querySelectorAll('[data-bill-line]')].map(node=>{const mode=node.dataset.pricingMode==='total'?'total':'unit';return{purchase_order_item_id:node.dataset.billLine,billed_quantity:node.querySelector('[data-qty]')?.value||'',unit_cost:mode==='unit'?(node.querySelector('[data-cost]')?.value||''):'',line_total:mode==='total'?(node.querySelector('[data-total]')?.value||''):'',notes:node.querySelector('[data-note]')?.value||''};}).filter(row=>num(row.billed_quantity)>0); }
  async function saveBill() { const poId=$('bPO').value,lines=collectBillLines();message('billMsg','');if(!state.writeAccess)return message('billMsg','No tienes permiso para guardar facturas.');if(!poId)return message('billMsg','Selecciona una Purchase Order.');if(!lines.length)return message('billMsg','Indica al menos una cantidad a facturar.');if(lines.find(row=>row.unit_cost===''&&row.line_total===''))return message('billMsg','Indica costo unitario o total facturado para cada producto.');$('saveBill').disabled=true;try{await request('/api/payables',{method:'POST',body:JSON.stringify({action:state.editingBillId?'replace_plan':'create_plan',supplier_bill_id:state.editingBillId,purchase_order_id:poId,supplier_invoice_number:$('bSupplierInvoice').value||null,bill_date:$('bDate').value||null,due_date:$('bDue').value||null,notes:$('bNotes').value||null,lines})});setModal('billModal',false);await refresh();}catch(error){message('billMsg',error.message);}finally{$('saveBill').disabled=false;} }

  function fillPaymentPOs() { $('pPO').innerHTML='<option value="">Selecciona una Purchase Order</option>'+state.paymentPOs.map(po=>`<option value="${esc(po.id)}">${esc(po.po_number)} · ${esc(supplierName(po))}</option>`).join(''); }
  function openPaymentCreate() { if(!state.writeAccess)return;fillPaymentPOs();$('pPO').value='';$('pAmount').value='';$('pDate').value=new Date().toISOString().slice(0,10);$('pMethod').value='wire';$('pReference').value='';$('pNotes').value='';message('paymentMsg','');setModal('paymentModal',true); }
  async function savePayment() { const poId=$('pPO').value,amount=num($('pAmount').value);message('paymentMsg','');if(!state.writeAccess)return message('paymentMsg','No tienes permiso para registrar pagos.');if(!poId)return message('paymentMsg','Selecciona una Purchase Order.');if(amount<=0)return message('paymentMsg','El monto debe ser mayor que cero.');$('savePayment').disabled=true;try{await request('/api/supplier-payments',{method:'POST',body:JSON.stringify({action:'register',purchase_order_id:poId,amount,payment_date:$('pDate').value||null,method:$('pMethod').value||null,reference:$('pReference').value||null,notes:$('pNotes').value||null})});setModal('paymentModal',false);state.entity='payments';state.view='active';await refresh();}catch(error){message('paymentMsg',error.message);}finally{$('savePayment').disabled=false;} }

  function openAllocation(id) { const payment=state.payments.find(row=>String(row.id)===String(id));if(!payment||!actionAllowed(payment,'allocate'))return;state.allocationPaymentId=payment.id;const own=new Map((payment.applications||[]).map(app=>[app.supplier_bill_id,num(app.amount)]));const bills=state.postedBills.filter(b=>b.purchase_order_id===payment.purchase_order_id);$('allocationTitle').textContent=`Aplicar ${payment.payment_number}`;$('allocationSubtitle').textContent=`${money(payment.amount,payment.currency)} · ${payment.purchase_order?.po_number||''}`;$('allocationBills').innerHTML=bills.length?bills.map(bill=>{const current=own.get(bill.id)||0;const available=num(bill.financial?.balance_due)+current;return `<div class="line" data-allocation-bill="${esc(bill.id)}"><div class="line-head"><div><b>${esc(bill.bill_number)} · ${esc(bill.supplier_invoice_number||'')}</b><div class="small">Saldo disponible para este pago: ${esc(money(available,bill.currency))}</div></div><input data-amount type="number" min="0" max="${esc(available)}" step="0.01" value="${esc(current)}" style="max-width:180px"></div></div>`;}).join(''):'<div class="empty">No hay facturas contabilizadas de esta PO.</div>';message('allocationMsg','');setModal('allocationModal',true); }
  async function saveAllocation() { const payment=state.payments.find(row=>row.id===state.allocationPaymentId);if(!payment||!actionAllowed(payment,'allocate'))return message('allocationMsg','Este pago ya no admite distribución.');const applications=[...document.querySelectorAll('[data-allocation-bill]')].map(node=>({supplier_bill_id:node.dataset.allocationBill,amount:node.querySelector('[data-amount]')?.value||''})).filter(row=>num(row.amount)>0);$('saveAllocation').disabled=true;try{await request('/api/supplier-payments',{method:'POST',body:JSON.stringify({action:'replace_applications',supplier_payment_id:payment.id,applications})});setModal('allocationModal',false);await refresh();}catch(error){message('allocationMsg',error.message);}finally{$('saveAllocation').disabled=false;} }

  function openReverse(id) { const payment=state.payments.find(row=>String(row.id)===String(id));if(!payment||!actionAllowed(payment,'reverse'))return;state.reversePaymentId=payment.id;$('rReason').value='';message('reverseMsg','');setModal('reverseModal',true); }
  async function saveReverse() { const payment=state.payments.find(row=>String(row.id)===String(state.reversePaymentId));const reason=$('rReason').value.trim();if(!payment||!actionAllowed(payment,'reverse'))return message('reverseMsg','Este pago ya no puede revertirse.');if(!reason)return message('reverseMsg','Indica el motivo del reverso.');$('saveReverse').disabled=true;try{await request('/api/supplier-payments',{method:'POST',body:JSON.stringify({action:'reverse',supplier_payment_id:state.reversePaymentId,reason})});setModal('reverseModal',false);await refresh();}catch(error){message('reverseMsg',error.message);}finally{$('saveReverse').disabled=false;} }

  function openBillDetail(id) { const bill=state.bills.find(row=>String(row.id)===String(id));if(!bill)return;const f=bill.financial||{};$('detailTitle').textContent=bill.bill_number;$('detailSubtitle').textContent=`${supplierName(bill)} · ${bill.purchase_order?.po_number||'Sin PO'} · ${date(bill.bill_date)}`;const items=(bill.items||[]).map(item=>`<div class="detail-item"><div class="line-head"><div><b>${esc(item.product?.name||'Producto')}</b><div class="small">${esc(item.billed_quantity)} ${esc(item.unit)} × ${esc(money(item.unit_cost,bill.currency))} · PO ${esc(money(item.po_unit_cost_snapshot,bill.currency))}${item.pricing_mode==='total'?' · Total capturado':''}</div></div><b>${esc(money(item.line_total,bill.currency))}</b></div></div>`).join('');$('detailBody').innerHTML=`<div class="summary"><div><b>Total</b>${esc(money(f.bill_total,bill.currency))}</div><div><b>Pagado</b>${esc(money(f.paid_amount,bill.currency))}</div><div><b>Saldo</b>${esc(money(f.balance_due,bill.currency))}</div><div><b>Estado</b>${billPill(bill)}</div></div><div class="detail-items"><b>Líneas</b>${items||'<div class="empty">Sin líneas.</div>'}</div>${bill.notes?`<div class="line"><b>Notas</b><div class="small">${esc(bill.notes)}</div></div>`:''}`;const actions=[];if(actionAllowed(bill,'edit'))actions.push(`<button class="btn" data-bill-edit="${esc(bill.id)}">Editar</button>`);if(actionAllowed(bill,'post'))actions.push(`<button class="btn primary" data-bill-post="${esc(bill.id)}">Contabilizar</button>`);if(actionAllowed(bill,'void'))actions.push(`<button class="btn danger" data-bill-void="${esc(bill.id)}">Anular</button>`);$('detailActions').innerHTML=actions.join('');message('detailMsg','');setModal('detailModal',true); }

  function openPaymentDetail(id) { const payment=state.payments.find(row=>String(row.id)===String(id));if(!payment)return;const p=payment.progress||{};const apps=(payment.applications||[]).map(app=>{const bill=state.postedBills.find(b=>b.id===app.supplier_bill_id)||state.bills.find(b=>b.id===app.supplier_bill_id);return `<div class="detail-item"><div class="line-head"><div><b>${esc(bill?.bill_number||'Factura')}</b><div class="small">${esc(bill?.supplier_invoice_number||'')}</div></div><b>${esc(money(app.amount,payment.currency))}</b></div></div>`;}).join('');$('detailTitle').textContent=payment.payment_number;$('detailSubtitle').textContent=`${supplierName(payment)} · ${payment.purchase_order?.po_number||'Sin PO'} · ${date(payment.payment_date)}`;$('detailBody').innerHTML=`<div class="summary"><div><b>Monto</b>${esc(money(payment.amount,payment.currency))}</div><div><b>Aplicado</b>${esc(money(p.applied_amount,payment.currency))}</div><div><b>Sin aplicar</b>${esc(money(p.unapplied_amount,payment.currency))}</div><div><b>Estado</b>${paymentPill(payment)}</div></div><div class="detail-items"><b>Aplicaciones</b>${apps||'<div class="empty">Este pago todavía no está aplicado a facturas.</div>'}</div>${payment.reversal_reason?`<div class="line"><b>Motivo reverso</b><div class="small">${esc(payment.reversal_reason)}</div></div>`:''}`;const actions=[];if(actionAllowed(payment,'allocate'))actions.push(`<button class="btn orange" data-allocate="${esc(payment.id)}">Aplicar</button>`);if(actionAllowed(payment,'reverse'))actions.push(`<button class="btn danger" data-reverse="${esc(payment.id)}">Revertir</button>`);$('detailActions').innerHTML=actions.join('');message('detailMsg','');setModal('detailModal',true); }

  async function billAction(id,action) { const bill=state.bills.find(row=>String(row.id)===String(id));if(!bill||!actionAllowed(bill,action))return message('detailMsg','Esta acción ya no está disponible.');try{await request('/api/payables',{method:'POST',body:JSON.stringify({action,supplier_bill_id:id})});setModal('detailModal',false);await refresh();}catch(error){message('detailMsg',error.message);} }

  document.addEventListener('click',event=>{const el=event.target.closest('button');if(!el)return;if(el.dataset.close){setModal(`${el.dataset.close}Modal`,false);return;}if(el.dataset.entity){state.entity=el.dataset.entity;state.view=state.entity==='bills'?'open':'active';render();return;}if(el.dataset.view){state.view=el.dataset.view;render();return;}if(el.dataset.billDetail)return openBillDetail(el.dataset.billDetail);if(el.dataset.paymentDetail)return openPaymentDetail(el.dataset.paymentDetail);if(el.dataset.billEdit){setModal('detailModal',false);return openBillEdit(el.dataset.billEdit);}if(el.dataset.billPost)return billAction(el.dataset.billPost,'post');if(el.dataset.billVoid)return billAction(el.dataset.billVoid,'void');if(el.dataset.allocate){setModal('detailModal',false);return openAllocation(el.dataset.allocate);}if(el.dataset.reverse){setModal('detailModal',false);return openReverse(el.dataset.reverse);}});

  $('newBill').onclick=openBillCreate;$('newPayment').onclick=openPaymentCreate;$('refresh').onclick=refresh;$('saveBill').onclick=saveBill;$('savePayment').onclick=savePayment;$('saveAllocation').onclick=saveAllocation;$('saveReverse').onclick=saveReverse;
  $('bPO').addEventListener('change',()=>renderBillLines(state.editingBillId?state.bills.find(b=>b.id===state.editingBillId):null));
  $('billLines').addEventListener('input',event=>{const line=event.target.closest('[data-bill-line]');if(!line)return;if(event.target.matches('[data-total]'))return syncBillLine(line,'total');if(event.target.matches('[data-cost]'))return syncBillLine(line,'cost');if(event.target.matches('[data-qty]'))return syncBillLine(line,'qty');});
  $('search').addEventListener('input',event=>{state.search=event.target.value||'';render();});
  document.querySelectorAll('.modal').forEach(modal=>modal.addEventListener('click',event=>{if(event.target===modal)modal.classList.add('hidden');}));
  document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden'));});

  window.PayablesModule=Object.freeze({ refresh, openBill:openBillDetail, openPayment:openPaymentDetail });
  refresh().catch(error=>{ $('list').innerHTML=`<div class="empty">${esc(error.message)}</div>`; });
})();