(() => {
  const $ = id => document.getElementById(id);
  const state = { invoices:[], salesOrders:[], view:'open', search:'', editingId:null, selectedOrderId:null };
  const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const num = value => Number(value || 0);
  const money = (value, currency='USD') => `${currency} ${num(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const date = value => value ? new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString() : '—';
  const clientName = row => row?.client?.company || row?.client?.mipyme_name || row?.client?.name || 'Cliente';
  const token = () => localStorage.getItem('export_mca_token') || '';

  async function request(url='/api/invoices', options={}) {
    const response = await fetch(url, {
      ...options,
      headers:{ 'Content-Type':'application/json', ...(token() ? { Authorization:`Bearer ${token()}` } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo procesar Facturación');
    return data;
  }

  async function refresh() {
    const data = await request();
    state.invoices = Array.isArray(data.invoices) ? data.invoices : [];
    state.salesOrders = Array.isArray(data.sales_orders) ? data.sales_orders : [];
    render();
    parent?.dispatchEvent?.(new CustomEvent('export-mca:data-loaded'));
  }

  function statusPill(invoice) {
    const financial = invoice.financial || {};
    if (invoice.status === 'void') return '<span class="pill off">Anulada</span>';
    if (invoice.status === 'draft') return '<span class="pill warn">Borrador</span>';
    const payment = financial.payment_status || 'unpaid';
    if (payment === 'paid') return '<span class="pill ok">Pagada</span>';
    if (payment === 'partial') return '<span class="pill warn">Parcial</span>';
    if (payment === 'overdue') return '<span class="pill bad">Vencida</span>';
    return '<span class="pill">Emitida</span>';
  }

  function renderMetrics() {
    const active = state.invoices.filter(i => i.status !== 'void');
    const drafts = active.filter(i => i.status === 'draft').length;
    const issued = active.filter(i => i.status === 'issued');
    const paid = issued.filter(i => i.financial?.payment_status === 'paid').length;
    const overdue = issued.filter(i => i.financial?.payment_status === 'overdue').length;
    const receivable = issued.reduce((sum,i) => sum + num(i.financial?.balance_due),0);
    $('metrics').innerHTML = [
      ['Facturas',active.length],['Borradores',drafts],['Pagadas',paid],['Vencidas',overdue],['Por cobrar',money(receivable)]
    ].map(([label,value]) => `<div class="metric"><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join('');
  }

  function matchesView(invoice) {
    if (state.view === 'all') return true;
    if (state.view === 'draft') return invoice.status === 'draft';
    if (state.view === 'paid') return invoice.status === 'issued' && invoice.financial?.payment_status === 'paid';
    return invoice.status !== 'void' && !(invoice.status === 'issued' && invoice.financial?.payment_status === 'paid');
  }

  function filteredInvoices() {
    const query = state.search.toLowerCase();
    return state.invoices.filter(invoice => {
      if (!matchesView(invoice)) return false;
      if (!query) return true;
      const haystack = [invoice.invoice_number, invoice.sales_order?.so_number, invoice.sales_order?.customer_reference, clientName(invoice), invoice.status, invoice.financial?.payment_status].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  function renderList() {
    const rows = filteredInvoices();
    if (!rows.length) {
      $('invoiceList').innerHTML = '<div class="empty">No hay facturas para esta vista.</div>';
      return;
    }
    $('invoiceList').innerHTML = rows.map(invoice => {
      const f = invoice.financial || {};
      const actions = [`<button class="btn" data-detail="${esc(invoice.id)}">Ver</button>`];
      if (invoice.status === 'draft') actions.push(`<button class="btn" data-edit="${esc(invoice.id)}">Editar</button>`,`<button class="btn primary" data-issue="${esc(invoice.id)}">Emitir</button>`);
      if (invoice.status === 'draft' || invoice.status === 'issued') actions.push(`<button class="btn danger" data-void="${esc(invoice.id)}">Anular</button>`);
      return `<div class="row">
        <div><div class="po">${esc(invoice.invoice_number)}</div><div class="small">${date(invoice.issue_date)}</div></div>
        <div><b>${esc(clientName(invoice))}</b><div class="small">${esc(invoice.sales_order?.customer_reference || '')}</div></div>
        <div><b>${esc(invoice.sales_order?.so_number || '—')}</b></div>
        <div>${statusPill(invoice)}</div>
        <div><b>${esc(money(f.total,invoice.currency))}</b></div>
        <div><b>${esc(money(f.balance_due,invoice.currency))}</b><div class="small">Saldo</div></div>
        <div class="actions">${actions.join('')}</div>
      </div>`;
    }).join('');
  }

  function render() { renderMetrics(); renderList(); }

  function setModal(id, open) { $(id)?.classList.toggle('hidden', !open); }
  function message(id, value, ok=false) { const node=$(id); if (!node) return; node.textContent=value || ''; node.classList.toggle('ok',Boolean(ok)); }

  function eligibleOrders(editingInvoice=null) {
    return state.salesOrders.filter(order => order.items?.some(item => {
      const own = editingInvoice?.items?.find(line => line.sales_order_item_id === item.id);
      return num(item.invoice_progress?.available_to_invoice_quantity) + num(own?.quantity) > 0;
    }));
  }

  function fillSalesOrderOptions(editingInvoice=null) {
    const orders = eligibleOrders(editingInvoice);
    $('iSalesOrder').innerHTML = '<option value="">Selecciona una Sales Order</option>' + orders.map(order => `<option value="${esc(order.id)}">${esc(order.so_number)} · ${esc(clientName(order))}</option>`).join('');
  }

  function renderInvoiceLines(editingInvoice=null) {
    const order = state.salesOrders.find(row => String(row.id) === String($('iSalesOrder').value));
    if (!order) { $('invoiceLines').innerHTML = '<div class="empty">Selecciona una Sales Order.</div>'; return; }
    const rows = (order.items || []).map(item => {
      const own = editingInvoice?.items?.find(line => line.sales_order_item_id === item.id);
      const available = num(item.invoice_progress?.available_to_invoice_quantity) + num(own?.quantity);
      if (available <= 0 && !own) return '';
      const product = item.product || {};
      const label = product.sku ? `${product.sku} · ${product.name || ''}` : (product.name || 'Producto');
      const quantity = own ? num(own.quantity) : available;
      return `<div class="line" data-invoice-line="${esc(item.id)}"><div class="line-head"><div><div class="line-title">${esc(label)}</div><div class="small">Ordenado ${esc(item.ordered_quantity)} ${esc(item.unit)} · Disponible ${esc(available)} · Precio ${esc(money(item.unit_price,order.currency))}</div></div></div><div class="grid"><div><label>Cantidad a facturar</label><input data-qty type="number" min="0" max="${esc(available)}" step="any" value="${esc(quantity)}"></div><div><label>Nota</label><input data-note value="${esc(own?.notes || '')}"></div></div></div>`;
    }).filter(Boolean);
    $('invoiceLines').innerHTML = rows.length ? rows.join('') : '<div class="empty">Esta Sales Order no tiene saldo disponible para facturar.</div>';
  }

  function openCreate() {
    state.editingId = null;
    $('invoiceTitle').textContent = 'Nueva factura';
    fillSalesOrderOptions();
    $('iSalesOrder').disabled = false;
    $('iIssueDate').value = new Date().toISOString().slice(0,10);
    $('iDueDate').value = '';
    $('iNotes').value = '';
    $('invoiceLines').innerHTML = '<div class="empty">Selecciona una Sales Order.</div>';
    message('invoiceMsg','');
    setModal('invoiceModal',true);
  }

  function openEdit(id) {
    const invoice = state.invoices.find(row => String(row.id) === String(id));
    if (!invoice || invoice.status !== 'draft') return;
    state.editingId = invoice.id;
    $('invoiceTitle').textContent = `Editar ${invoice.invoice_number}`;
    fillSalesOrderOptions(invoice);
    $('iSalesOrder').value = invoice.sales_order_id;
    $('iSalesOrder').disabled = false;
    $('iIssueDate').value = String(invoice.issue_date || '').slice(0,10);
    $('iDueDate').value = String(invoice.due_date || '').slice(0,10);
    $('iNotes').value = invoice.notes || '';
    renderInvoiceLines(invoice);
    message('invoiceMsg','');
    setModal('invoiceModal',true);
  }

  function collectLines() {
    return [...document.querySelectorAll('[data-invoice-line]')].map(node => ({
      sales_order_item_id:node.dataset.invoiceLine,
      quantity:node.querySelector('[data-qty]')?.value || '',
      notes:node.querySelector('[data-note]')?.value || ''
    })).filter(line => num(line.quantity) > 0);
  }

  async function saveInvoice() {
    message('invoiceMsg','');
    const salesOrderId = $('iSalesOrder').value;
    const lines = collectLines();
    if (!salesOrderId) return message('invoiceMsg','Selecciona una Sales Order.');
    if (!lines.length) return message('invoiceMsg','Indica al menos una cantidad a facturar.');
    $('saveInvoice').disabled = true;
    try {
      await request('/api/invoices',{ method:'POST', body:JSON.stringify({
        action:state.editingId ? 'replace_plan' : 'create_plan',
        invoice_id:state.editingId,
        sales_order_id:salesOrderId,
        issue_date:$('iIssueDate').value || null,
        due_date:$('iDueDate').value || null,
        notes:$('iNotes').value || null,
        lines
      })});
      setModal('invoiceModal',false);
      await refresh();
    } catch (error) { message('invoiceMsg',error.message); }
    finally { $('saveInvoice').disabled = false; }
  }

  function openDetail(id) {
    const invoice = state.invoices.find(row => String(row.id) === String(id));
    if (!invoice) return;
    const f = invoice.financial || {};
    $('detailTitle').textContent = invoice.invoice_number;
    $('detailSubtitle').textContent = `${clientName(invoice)} · ${invoice.sales_order?.so_number || 'Sin SO'} · ${date(invoice.issue_date)}`;
    const items = (invoice.items || []).map(item => `<div class="detail-item"><div class="line-head"><b>${esc(item.description)}</b><b>${esc(money(item.line_total,invoice.currency))}</b></div><div class="small">${esc(item.quantity)} ${esc(item.unit)} × ${esc(money(item.unit_price,invoice.currency))}</div></div>`).join('');
    const payments = (invoice.payments || []).map(payment => `<div class="detail-item"><div class="line-head"><b>${esc(date(payment.payment_date))} · ${esc(payment.method || 'Cobro')}</b><b>${esc(money(payment.amount,payment.currency))}</b></div><div class="small">${esc(payment.reference_number || '')} · ${esc(payment.status)}</div></div>`).join('');
    $('detailBody').innerHTML = `<div class="summary"><div><b>Total</b>${esc(money(f.total,invoice.currency))}</div><div><b>Cobrado</b>${esc(money(f.paid_amount,invoice.currency))}</div><div><b>Saldo</b>${esc(money(f.balance_due,invoice.currency))}</div><div><b>Estado</b>${statusPill(invoice)}</div></div><div class="detail-items"><b>Líneas</b>${items || '<div class="empty">Sin líneas.</div>'}</div><div class="detail-items"><b>Cobros</b>${payments || '<div class="empty">Todavía no hay cobros registrados.</div>'}</div>${invoice.notes ? `<div class="line"><b>Notas</b><div class="small">${esc(invoice.notes)}</div></div>` : ''}`;
    const actions = [];
    if (invoice.status === 'draft') actions.push(`<button class="btn" data-edit="${esc(invoice.id)}">Editar</button>`,`<button class="btn primary" data-issue="${esc(invoice.id)}">Emitir</button>`);
    if (invoice.status === 'draft' || invoice.status === 'issued') actions.push(`<button class="btn danger" data-void="${esc(invoice.id)}">Anular</button>`);
    $('detailActions').innerHTML = actions.join('');
    message('detailMsg','');
    setModal('detailModal',true);
  }

  async function transition(id, action) {
    const verb = action === 'issue' ? 'emitir' : 'anular';
    if (!confirm(`¿Confirmas ${verb} esta factura?`)) return;
    try {
      await request('/api/invoices',{ method:'POST', body:JSON.stringify({ action, invoice_id:id }) });
      setModal('detailModal',false);
      await refresh();
    } catch (error) { alert(error.message); }
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const close = target.closest('[data-close]');
    if (close) { setModal(close.dataset.close === 'invoice' ? 'invoiceModal' : 'detailModal',false); return; }
    const detail = target.closest('[data-detail]'); if (detail) return openDetail(detail.dataset.detail);
    const edit = target.closest('[data-edit]'); if (edit) { setModal('detailModal',false); return openEdit(edit.dataset.edit); }
    const issue = target.closest('[data-issue]'); if (issue) return transition(issue.dataset.issue,'issue');
    const voidButton = target.closest('[data-void]'); if (voidButton) return transition(voidButton.dataset.void,'void');
    const tab = target.closest('[data-view]'); if (tab) {
      state.view = tab.dataset.view;
      document.querySelectorAll('[data-view]').forEach(node => node.classList.toggle('active',node === tab));
      renderList();
    }
  });

  $('newInvoice').onclick = openCreate;
  $('refresh').onclick = () => refresh().catch(error => alert(error.message));
  $('search').oninput = event => { state.search = event.target.value || ''; renderList(); };
  $('iSalesOrder').onchange = () => renderInvoiceLines(state.editingId ? state.invoices.find(row => row.id === state.editingId) : null);
  $('saveInvoice').onclick = saveInvoice;
  ['invoiceModal','detailModal'].forEach(id => $(id)?.addEventListener('click',event => { if (event.target === $(id)) setModal(id,false); }));

  window.openOperationalInvoice = openDetail;
  refresh().catch(error => { $('invoiceList').innerHTML = `<div class="empty">${esc(error.message)}</div>`; });
})();
