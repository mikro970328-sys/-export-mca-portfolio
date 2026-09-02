(() => {
  const $=id=>document.getElementById(id);
  const state={invoices:[],salesOrders:[],metrics:null,writeAccess:false,view:'open',search:'',editingId:null,paymentInvoiceId:null,decisionAction:null};
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num=value=>Number(value||0);
  const money=(value,currency='USD')=>`${currency} ${num(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const date=value=>value?new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString():'—';
  const clientName=row=>row?.client?.company||row?.client?.mipyme_name||row?.client?.name||'Cliente';
  const token=()=>localStorage.getItem('export_mca_token')||'';
  const capability=(entity,key)=>entity?.capabilities?.actions?.[key]||{allowed:false,reason:'CAPABILITY_UNAVAILABLE'};
  const can=(entity,key)=>capability(entity,key).allowed===true;
  const paymentCapability=(payment,key)=>payment?.capabilities?.actions?.[key]||{allowed:false,reason:'CAPABILITY_UNAVAILABLE'};
  const canPayment=(payment,key)=>paymentCapability(payment,key).allowed===true;
  const PAYMENT_STATUS_LABELS=Object.freeze({posted:'Registrado',reversed:'Revertido'});
  const SAFE_INVOICE_ERROR_PATTERNS=[
    /^(?:No tienes|Esta factura|Factura|La factura|El monto|El cobro|Ese cobro|La cantidad|La operación|La Sales Order|Sales Order|La solicitud|Una línea|Uno de los productos|Solo se|Selecciona|Indica|Agrega|Falta|Revierte|Vincula|Transición|Acción de|Sesión vencida)/i,
    /^No se pudo procesar (?:Facturación|el cobro)(?:\. Intenta nuevamente\.)?$/i
  ];

  function safeInvoiceMessage(error,fallback='No se pudo completar la operación. Intenta nuevamente.'){
    const value=String(error?.message||'').trim();
    return value&&SAFE_INVOICE_ERROR_PATTERNS.some(pattern=>pattern.test(value))?value:fallback;
  }
  function reportInvoiceError(context,error,fallback){console.error('INVOICES_UI_FAILED',{context,error});return safeInvoiceMessage(error,fallback);}
  const paymentStatusLabel=value=>PAYMENT_STATUS_LABELS[value]||'Estado no disponible';

  async function request(url='/api/invoices',options={}){
    const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(token()?{Authorization:`Bearer ${token()}`} : {}),...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(response.status===401){localStorage.removeItem('export_mca_token');location.href='/admin/';throw new Error('Sesión vencida');}
    if(!response.ok)throw new Error(data.error||'No se pudo procesar Facturación');
    return data;
  }

  async function refresh(){
    const data=await request();
    state.invoices=Array.isArray(data.invoices)?data.invoices:[];
    state.salesOrders=Array.isArray(data.sales_orders)?data.sales_orders:[];
    state.metrics=data.metrics||null;
    state.writeAccess=data.write_access===true;
    $('newInvoice').hidden=!state.writeAccess;
    render();
    parent?.dispatchEvent?.(new CustomEvent('export-mca:data-loaded'));
  }

  function statusPill(invoice){
    const f=invoice.financial||{};
    if(invoice.status==='void')return '<span class="pill off">Anulada</span>';
    if(invoice.status==='draft')return '<span class="pill warn">Borrador</span>';
    if(f.payment_status==='paid')return '<span class="pill ok">Pagada</span>';
    if(f.payment_status==='partial')return '<span class="pill warn">Parcial</span>';
    if(f.payment_status==='overdue')return '<span class="pill bad">Vencida</span>';
    return '<span class="pill">Emitida</span>';
  }

  function receivableLabel(){const rows=Array.isArray(state.metrics?.receivable_by_currency)?state.metrics.receivable_by_currency:[];return rows.length?rows.map(row=>money(row.amount,row.currency)).join(' · '):'—';}
  function renderMetrics(){const m=state.metrics||{};$('metrics').innerHTML=[['Facturas',m.invoice_count??'—'],['Borradores',m.draft_count??'—'],['Pagadas',m.paid_count??'—'],['Vencidas',m.overdue_count??'—'],['Por cobrar',receivableLabel()]].map(([label,value])=>`<div class="metric"><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join('');}
  function matchesView(invoice){if(state.view==='all')return true;if(state.view==='draft')return invoice.status==='draft';if(state.view==='paid')return invoice.status==='issued'&&invoice.financial?.payment_status==='paid';return invoice.status!=='void'&&!(invoice.status==='issued'&&invoice.financial?.payment_status==='paid');}
  function filteredInvoices(){const query=state.search.toLowerCase();return state.invoices.filter(invoice=>matchesView(invoice)&&(!query||[invoice.invoice_number,invoice.sales_order?.so_number,invoice.sales_order?.customer_reference,clientName(invoice),invoice.status,invoice.financial?.payment_status].join(' ').toLowerCase().includes(query)));}

  function renderList(){
    const rows=filteredInvoices();
    if(!rows.length){$('invoiceList').innerHTML='<div class="empty">No hay facturas para esta vista.</div><div class="small invoice-count is-empty">0 facturas</div>';return;}
    $('invoiceList').innerHTML=rows.map(invoice=>{
      const f=invoice.financial||{},actions=[`<button class="btn" data-detail="${esc(invoice.id)}">Ver</button>`];
      if(can(invoice,'record_payment'))actions.push(`<button class="btn orange" data-payment="${esc(invoice.id)}">Cobrar</button>`);
      if(can(invoice,'edit'))actions.push(`<button class="btn" data-edit="${esc(invoice.id)}">Editar</button>`);
      if(can(invoice,'issue'))actions.push(`<button class="btn primary" data-issue="${esc(invoice.id)}">Emitir</button>`);
      if(can(invoice,'void'))actions.push(`<button class="btn danger" data-void="${esc(invoice.id)}">Anular</button>`);
      return `<div class="row"><div><div class="po">${esc(invoice.invoice_number)}</div><div class="small">${date(invoice.issue_date)}</div></div><div><b>${esc(clientName(invoice))}</b><div class="small">${esc(invoice.sales_order?.customer_reference||'')}</div></div><div><b>${esc(invoice.sales_order?.so_number||'—')}</b></div><div>${statusPill(invoice)}</div><div><b>${esc(money(f.total,invoice.currency))}</b></div><div><b>${esc(money(f.balance_due,invoice.currency))}</b><div class="small">Saldo</div></div><div class="actions">${actions.join('')}</div></div>`;
    }).join('')+`<div class="small invoice-count">${rows.length} factura${rows.length===1?'':'s'}${rows.length!==state.invoices.length?` visibles · ${state.invoices.length} registradas`:''}</div>`;
  }
  function render(){renderMetrics();renderList();}
  function setModal(id,open){$(id)?.classList.toggle('hidden',!open);}
  function message(id,value,ok=false){const node=$(id);if(!node)return;node.textContent=value||'';node.classList.toggle('ok',Boolean(ok));}

  function eligibleOrders(editingInvoice=null){return state.salesOrders.filter(order=>order.items?.some(item=>{const own=editingInvoice?.items?.find(line=>line.sales_order_item_id===item.id);return num(item.invoice_progress?.available_to_invoice_quantity)+num(own?.quantity)>0;}));}
  function fillSalesOrderOptions(editingInvoice=null){const orders=eligibleOrders(editingInvoice);$('iSalesOrder').innerHTML='<option value="">Selecciona una venta</option>'+orders.map(order=>`<option value="${esc(order.id)}">${esc(order.so_number)} · ${esc(clientName(order))}</option>`).join('');}
  function renderInvoiceLines(editingInvoice=null){
    const order=state.salesOrders.find(row=>String(row.id)===String($('iSalesOrder').value));
    if(!order){$('invoiceLines').innerHTML='<div class="empty">Selecciona una venta.</div>';return;}
    const rows=(order.items||[]).map(item=>{
      const own=editingInvoice?.items?.find(line=>line.sales_order_item_id===item.id),available=num(item.invoice_progress?.available_to_invoice_quantity)+num(own?.quantity);
      if(available<=0&&!own)return '';
      const product=item.product||{},label=product.sku?`${product.sku} · ${product.name||''}`:(product.name||'Producto'),quantity=own?num(own.quantity):available;
      return `<div class="line" data-invoice-line="${esc(item.id)}"><div class="line-head"><div><div class="line-title">${esc(label)}</div><div class="small">Ordenado ${esc(item.ordered_quantity)} ${esc(item.unit)} · Disponible ${esc(available)} · Precio ${esc(money(item.unit_price,order.currency))}</div></div></div><div class="grid"><div><label>Cantidad a facturar</label><input data-qty type="number" min="0" max="${esc(available)}" step="any" value="${esc(quantity)}"></div><div><label>Nota</label><input data-note value="${esc(own?.notes||'')}"></div></div></div>`;
    }).filter(Boolean);
    $('invoiceLines').innerHTML=rows.length?rows.join(''):'<div class="empty">Esta venta no tiene saldo disponible para facturar.</div>';
  }

  function openCreate(){
    if(!state.writeAccess)return;
    state.editingId=null;$('invoiceTitle').textContent='Nueva factura de cobro';fillSalesOrderOptions();$('iSalesOrder').disabled=false;$('iSalesOrder').value='';$('iIssueDate').value=new Date().toISOString().slice(0,10);$('iDueDate').value='';$('iNotes').value='';$('invoiceLines').innerHTML='<div class="empty">Selecciona una venta.</div>';message('invoiceMsg','');setModal('invoiceModal',true);
  }
  function openEdit(id){
    const invoice=state.invoices.find(row=>String(row.id)===String(id));if(!invoice||!can(invoice,'edit'))return;
    state.editingId=invoice.id;$('invoiceTitle').textContent=`Editar ${invoice.invoice_number}`;fillSalesOrderOptions(invoice);$('iSalesOrder').value=invoice.sales_order_id;$('iSalesOrder').disabled=false;$('iIssueDate').value=String(invoice.issue_date||'').slice(0,10);$('iDueDate').value=String(invoice.due_date||'').slice(0,10);$('iNotes').value=invoice.notes||'';renderInvoiceLines(invoice);message('invoiceMsg','');setModal('invoiceModal',true);
  }
  function collectLines(){return [...document.querySelectorAll('[data-invoice-line]')].map(node=>({sales_order_item_id:node.dataset.invoiceLine,quantity:node.querySelector('[data-qty]')?.value||'',notes:node.querySelector('[data-note]')?.value||''})).filter(line=>num(line.quantity)>0);}
  async function saveInvoice(){
    message('invoiceMsg','');
    if(!state.writeAccess)return message('invoiceMsg','No tienes permiso para modificar facturas.');
    const editing=state.editingId?state.invoices.find(row=>row.id===state.editingId):null;
    if(editing&&!can(editing,'edit'))return message('invoiceMsg','Esta factura ya no admite edición.');
    const salesOrderId=$('iSalesOrder').value,lines=collectLines();
    if(!salesOrderId)return message('invoiceMsg','Selecciona una venta.');
    if(!lines.length)return message('invoiceMsg','Indica al menos una cantidad a facturar.');
    $('saveInvoice').disabled=true;
    try{
      await request('/api/invoices',{method:'POST',body:JSON.stringify({action:state.editingId?'replace_plan':'create_plan',invoice_id:state.editingId,sales_order_id:salesOrderId,issue_date:$('iIssueDate').value||null,due_date:$('iDueDate').value||null,notes:$('iNotes').value||null,lines})});
      setModal('invoiceModal',false);await refresh();
    }catch(error){message('invoiceMsg',reportInvoiceError('save_invoice',error));}finally{$('saveInvoice').disabled=false;}
  }

  function paymentRows(invoice){
    return (invoice.payments||[]).map(payment=>`<div class="detail-item"><div class="line-head"><div><b>${esc(date(payment.payment_date))} · ${esc(payment.method||'Cobro')}</b><div class="small">${esc(payment.reference_number||'Sin referencia')} · ${esc(paymentStatusLabel(payment.status))}</div></div><div class="actions"><b>${esc(money(payment.amount,payment.currency))}</b>${canPayment(payment,'reverse')?`<button class="btn danger" data-reverse-payment="${esc(payment.id)}" data-invoice-id="${esc(invoice.id)}">Revertir</button>`:''}</div></div></div>`).join('');
  }
  function openDetail(id){
    const invoice=state.invoices.find(row=>String(row.id)===String(id));if(!invoice)return;const f=invoice.financial||{};
    $('detailTitle').textContent=invoice.invoice_number;$('detailSubtitle').textContent=`${clientName(invoice)} · ${invoice.sales_order?.so_number||'Sin venta'} · ${date(invoice.issue_date)}`;
    const items=(invoice.items||[]).map(item=>`<div class="detail-item"><div class="line-head"><b>${esc(item.description)}</b><b>${esc(money(item.line_total,invoice.currency))}</b></div><div class="small">${esc(item.quantity)} ${esc(item.unit)} × ${esc(money(item.unit_price,invoice.currency))}</div></div>`).join(''),payments=paymentRows(invoice);
    $('detailBody').innerHTML=`<div class="summary"><div><b>Total</b>${esc(money(f.total,invoice.currency))}</div><div><b>Cobrado</b>${esc(money(f.paid_amount,invoice.currency))}</div><div><b>Saldo</b>${esc(money(f.balance_due,invoice.currency))}</div><div><b>Estado</b>${statusPill(invoice)}</div></div><div class="detail-items"><b>Líneas</b>${items||'<div class="empty">Sin líneas.</div>'}</div><div class="detail-items"><b>Cobros</b>${payments||'<div class="empty">Todavía no hay cobros registrados.</div>'}</div>${invoice.notes?`<div class="line"><b>Notas</b><div class="small">${esc(invoice.notes)}</div></div>`:''}`;
    const actions=[];
    if(can(invoice,'record_payment'))actions.push(`<button class="btn orange" data-payment="${esc(invoice.id)}">Registrar cobro</button>`);
    if(can(invoice,'edit'))actions.push(`<button class="btn" data-edit="${esc(invoice.id)}">Editar</button>`);
    if(can(invoice,'issue'))actions.push(`<button class="btn primary" data-issue="${esc(invoice.id)}">Emitir</button>`);
    if(can(invoice,'void'))actions.push(`<button class="btn danger" data-void="${esc(invoice.id)}">Anular</button>`);
    $('detailActions').innerHTML=actions.join('');message('detailMsg','');setModal('detailModal',true);
  }

  function openPayment(id){
    const invoice=state.invoices.find(row=>String(row.id)===String(id));if(!invoice||!can(invoice,'record_payment'))return;
    const balance=num(invoice.financial?.balance_due);state.paymentInvoiceId=invoice.id;$('paymentTitle').textContent=`Registrar cobro · ${invoice.invoice_number}`;$('paymentSubtitle').textContent=`Saldo pendiente: ${money(balance,invoice.currency)}`;$('pAmount').max=String(balance);$('pAmount').value=String(balance);$('pDate').value=new Date().toISOString().slice(0,10);$('pMethod').value='wire';$('pReference').value='';$('pNotes').value='';message('paymentMsg','');setModal('paymentModal',true);
  }
  async function savePayment(){
    const invoice=state.invoices.find(row=>row.id===state.paymentInvoiceId);if(!invoice)return message('paymentMsg','Factura no encontrada.');
    if(!can(invoice,'record_payment'))return message('paymentMsg','Esta factura ya no admite cobros.');
    const amount=num($('pAmount').value);if(amount<=0)return message('paymentMsg','El monto debe ser mayor que cero.');
    $('savePayment').disabled=true;
    try{
      await request('/api/invoice-payments',{method:'POST',body:JSON.stringify({action:'register',invoice_id:invoice.id,amount,payment_date:$('pDate').value||null,method:$('pMethod').value||null,reference_number:$('pReference').value||null,notes:$('pNotes').value||null})});
      setModal('paymentModal',false);await refresh();openDetail(invoice.id);
    }catch(error){message('paymentMsg',reportInvoiceError('save_payment',error));}finally{$('savePayment').disabled=false;}
  }

  function closeDecision(){state.decisionAction=null;setModal('decisionModal',false);message('decisionMsg','');$('decisionReason').value='';}
  function askDecision({title,copy,acceptLabel='Continuar',reason=false,onAccept}){
    state.decisionAction=onAccept;$('decisionTitle').textContent=title;$('decisionCopy').textContent=copy;$('decisionAccept').textContent=acceptLabel;$('decisionReasonWrap').classList.toggle('hidden',!reason);$('decisionReason').value='';message('decisionMsg','');setModal('decisionModal',true);
  }
  async function acceptDecision(){
    if(typeof state.decisionAction!=='function')return;
    const button=$('decisionAccept');button.disabled=true;
    try{await state.decisionAction($('decisionReason').value.trim());closeDecision();}catch(error){message('decisionMsg',reportInvoiceError('decision',error));}finally{button.disabled=false;}
  }
  function transition(id,action){
    const invoice=state.invoices.find(row=>row.id===id);if(!invoice||!can(invoice,action))return;
    const issue=action==='issue';
    askDecision({title:issue?'Emitir factura':'Anular factura',copy:issue?`Se emitirá ${invoice.invoice_number}. Después sus líneas y estructura quedan bloqueadas.`:`Se anulará ${invoice.invoice_number}. Esta acción sólo está disponible sin cobros ni anticipos aplicados.`,acceptLabel:issue?'Emitir':'Anular',onAccept:async()=>{await request('/api/invoices',{method:'POST',body:JSON.stringify({action,invoice_id:id})});setModal('detailModal',false);await refresh();}});
  }
  function reversePayment(paymentId,invoiceId){
    const invoice=state.invoices.find(row=>row.id===invoiceId),payment=invoice?.payments?.find(row=>row.id===paymentId);if(!payment||!canPayment(payment,'reverse'))return;
    askDecision({title:'Revertir cobro',copy:`Se revertirá el cobro de ${money(payment.amount,payment.currency)}. La factura recuperará ese saldo pendiente.`,acceptLabel:'Revertir',reason:true,onAccept:async reason=>{await request('/api/invoice-payments',{method:'POST',body:JSON.stringify({action:'reverse',payment_id:paymentId,reason})});await refresh();openDetail(invoiceId);}});
  }

  function closeByName(name){if(name==='decision')return closeDecision();setModal(name==='invoice'?'invoiceModal':name==='payment'?'paymentModal':'detailModal',false);}
  document.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;if(!target)return;
    const close=target.closest('[data-close]');if(close){closeByName(close.dataset.close);return;}
    const detail=target.closest('[data-detail]');if(detail)return openDetail(detail.dataset.detail);
    const edit=target.closest('[data-edit]');if(edit){setModal('detailModal',false);return openEdit(edit.dataset.edit);}
    const payment=target.closest('[data-payment]');if(payment)return openPayment(payment.dataset.payment);
    const reverse=target.closest('[data-reverse-payment]');if(reverse)return reversePayment(reverse.dataset.reversePayment,reverse.dataset.invoiceId);
    const issue=target.closest('[data-issue]');if(issue)return transition(issue.dataset.issue,'issue');
    const voidButton=target.closest('[data-void]');if(voidButton)return transition(voidButton.dataset.void,'void');
    const tab=target.closest('[data-view]');if(tab){state.view=tab.dataset.view;document.querySelectorAll('[data-view]').forEach(node=>node.classList.toggle('active',node===tab));renderList();}
  });

  $('newInvoice').onclick=openCreate;
  $('refresh').onclick=()=>refresh().catch(error=>{$('invoiceList').innerHTML=`<div class="empty">${esc(reportInvoiceError('refresh',error,'No se pudieron cargar las facturas. Intenta nuevamente.'))}</div>`;});
  $('search').oninput=event=>{state.search=event.target.value||'';renderList();};
  $('iSalesOrder').onchange=()=>renderInvoiceLines(state.editingId?state.invoices.find(row=>row.id===state.editingId):null);
  $('saveInvoice').onclick=saveInvoice;
  $('savePayment').onclick=savePayment;
  $('decisionAccept').onclick=acceptDecision;
  ['invoiceModal','detailModal','paymentModal','decisionModal'].forEach(id=>$(id)?.addEventListener('click',event=>{if(event.target===$(id)){if(id==='decisionModal')closeDecision();else setModal(id,false);}}));
  refresh().catch(error=>{$('invoiceList').innerHTML=`<div class="empty">${esc(reportInvoiceError('bootstrap',error,'No se pudieron cargar las facturas. Intenta nuevamente.'))}</div>`;});
})();
