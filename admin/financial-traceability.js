(() => {
  if (window.__financialTraceabilityInstalled) return;
  window.__financialTraceabilityInstalled = true;

  const normalize = value => String(value || '').trim().toUpperCase();
  const token = () => localStorage.getItem('export_mca_token') || '';
  let cache = null;
  let pending = null;

  function installStyles(doc = document) {
    if (doc.getElementById('financialTraceabilityStyles')) return;
    const style = doc.createElement('style');
    style.id = 'financialTraceabilityStyles';
    style.textContent = `
      .fin-context{margin-top:12px;padding:11px;border:1px solid #dfe5ee;border-radius:10px;background:#f8fafc}
      .fin-context-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px}
      .fin-context-title{font-size:10px;text-transform:uppercase;color:#667085;font-weight:900}
      .fin-context-count,.fin-context-empty{font-size:10px;color:#667085}
      .fin-context-actions{display:flex;gap:7px;flex-wrap:wrap}
      .fin-context-btn{border:1px solid #cfd9e8!important;background:#fff!important;color:#06204a!important;border-radius:8px!important;padding:7px 9px!important;font-size:10px!important;font-weight:900!important;cursor:pointer!important}
      .fin-context-btn.primary{background:#06204a!important;color:#fff!important;border-color:#06204a!important}
      .fin-context-btn.warn{color:#9a6700!important;border-color:#efd18b!important}
      .fin-modal{position:fixed;inset:0;background:rgba(6,19,39,.5);display:flex;align-items:center;justify-content:center;padding:16px;z-index:2200}
      .fin-modal.hidden{display:none}.fin-dialog{width:min(900px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:14px;padding:18px}
      .fin-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.fin-dialog h2{margin:0;color:#06204a}
      .fin-card{border:1px solid #dfe5ee;border-radius:10px;padding:11px;margin-top:10px;background:#fff}
      .fin-card-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.fin-meta{font-size:10px;color:#667085;margin-top:4px}
      @media(max-width:650px){.fin-context-btn{flex:1 1 135px;text-align:left}.fin-dialog{padding:13px}}
    `;
    (doc.head || doc.documentElement).appendChild(style);
  }

  async function requestLinks({ refresh = false } = {}) {
    if (!refresh && cache) return cache;
    if (pending) return pending;
    pending = fetch('/api/financial-links', { headers:token() ? { Authorization:`Bearer ${token()}` } : {} })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la trazabilidad financiera');
        cache = Array.isArray(data.invoices) ? data.invoices : [];
        return cache;
      })
      .finally(() => { pending = null; });
    return pending;
  }

  const invalidate = () => { cache = null; };
  const invoiceById = async id => (await requestLinks()).find(row => String(row.invoice_id) === String(id)) || null;
  const invoiceByNumber = async number => {
    const key = normalize(number);
    return (await requestLinks()).find(row => normalize(row.invoice_number) === key) || null;
  };
  const invoicesForSalesOrder = async id => (await requestLinks()).filter(row => String(row.sales_order_id) === String(id));
  const invoicesForClient = async id => (await requestLinks()).filter(row => String(row.client_id) === String(id));

  function frameFor(sectionId) { return document.querySelector(`#${sectionId} iframe`); }

  function openInvoice(invoiceId) {
    if (!invoiceId) return false;
    window.NavigationShell?.openInvoices?.();
    const invoke = () => {
      const frame = frameFor('invoicesSection');
      const fn = frame?.contentWindow?.openOperationalInvoice;
      if (typeof fn === 'function') fn(invoiceId);
    };
    const frame = frameFor('invoicesSection');
    if (frame?.contentDocument?.readyState === 'complete') requestAnimationFrame(invoke);
    else frame?.addEventListener('load', () => requestAnimationFrame(invoke), { once:true });
    return true;
  }

  function button(doc, label, action, { primary = false, warn = false } = {}) {
    const control = doc.createElement('button');
    control.type = 'button';
    control.className = `fin-context-btn${primary ? ' primary' : ''}${warn ? ' warn' : ''}`;
    control.textContent = label;
    control.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve(action()).catch(error => console.error('[financial traceability action]', error));
    });
    return control;
  }

  function block(doc, title, items = [], empty = 'Sin relaciones financieras registradas.') {
    const wrapper = doc.createElement('div');
    wrapper.className = 'fin-context';
    const head = doc.createElement('div'); head.className = 'fin-context-head';
    const heading = doc.createElement('div'); heading.className = 'fin-context-title'; heading.textContent = title; head.appendChild(heading);
    if (items.length) { const count = doc.createElement('div'); count.className = 'fin-context-count'; count.textContent = `${items.length} relacionado${items.length === 1 ? '' : 's'}`; head.appendChild(count); }
    wrapper.appendChild(head);
    const actions = doc.createElement('div'); actions.className = 'fin-context-actions';
    if (!items.length) { const node = doc.createElement('div'); node.className = 'fin-context-empty'; node.textContent = empty; actions.appendChild(node); }
    else items.forEach(item => actions.appendChild(button(doc, item.label, item.action, item)));
    wrapper.appendChild(actions);
    return wrapper;
  }

  function money(value, currency = 'USD') {
    const amount = Number(value || 0);
    return `${currency || 'USD'} ${amount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  }

  function financialLabel(invoice) {
    const f = invoice.financial || {};
    const status = invoice.invoice_status === 'void' ? 'Anulada' : ({ paid:'Pagada', partial:'Parcial', overdue:'Vencida', unpaid:'Pendiente' }[f.payment_status] || invoice.invoice_status || 'Factura');
    return `${invoice.invoice_number} · ${status} · saldo ${money(f.balance_due, invoice.currency)}`;
  }

  function ensureClientModal() {
    let modal = document.getElementById('financialClientActivity');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'financialClientActivity';
    modal.className = 'fin-modal hidden';
    modal.innerHTML = '<div class="fin-dialog"><div class="fin-dialog-head"><div><h2 id="financialClientTitle">Actividad financiera</h2><div class="muted">Cliente → Sales Orders → Facturas → Cobros.</div></div><button id="financialClientClose" class="fin-context-btn">✕</button></div><div id="financialClientBody"></div></div>';
    document.body.appendChild(modal);
    document.getElementById('financialClientClose').onclick = () => modal.classList.add('hidden');
    modal.addEventListener('click', event => { if (event.target === modal) modal.classList.add('hidden'); });
    return modal;
  }

  async function openClientFinancial(clientId) {
    if (!clientId) return false;
    const [invoices, sales] = await Promise.all([
      invoicesForClient(clientId),
      window.OperationalNavigation?.salesOrdersForClient?.(clientId) || Promise.resolve([])
    ]);
    const modal = ensureClientModal();
    const title = invoices.find(Boolean)?.client_name || 'Cliente';
    document.getElementById('financialClientTitle').textContent = `Actividad financiera · ${title}`;
    const body = document.getElementById('financialClientBody');
    body.innerHTML = '';
    body.appendChild(block(document, 'Sales Orders', (sales || []).map(order => ({
      label:`${order.so_number} · ${order.so_status || 'sin estado'}`,
      action:() => window.OperationalNavigation?.openSales?.({ salesOrderId:order.sales_order_id })
    })), 'Este cliente todavía no tiene Sales Orders.'));
    body.appendChild(block(document, 'Facturas', invoices.map(invoice => ({
      label:financialLabel(invoice),
      primary:invoice.invoice_status === 'issued',
      action:() => openInvoice(invoice.invoice_id)
    })), 'Este cliente todavía no tiene facturas.'));
    const posted = invoices.flatMap(invoice => (invoice.payments || []).filter(payment => payment.status === 'posted').map(payment => ({ invoice, payment })));
    const paymentBlock = document.createElement('div'); paymentBlock.className = 'fin-context';
    paymentBlock.innerHTML = `<div class="fin-context-head"><div class="fin-context-title">Cobros activos</div><div class="fin-context-count">${posted.length}</div></div>`;
    const paymentActions = document.createElement('div'); paymentActions.className = 'fin-context-actions';
    if (!posted.length) paymentActions.innerHTML = '<div class="fin-context-empty">No hay cobros posted para este cliente.</div>';
    posted.forEach(({ invoice, payment }) => paymentActions.appendChild(button(document, `${invoice.invoice_number} · ${money(payment.amount,payment.currency)} · ${payment.payment_date || ''}`, () => openInvoice(invoice.invoice_id))));
    paymentBlock.appendChild(paymentActions); body.appendChild(paymentBlock);
    modal.classList.remove('hidden');
    return true;
  }

  function installClientActionObserver() {
    const attach = () => {
      const popover = document.querySelector('.client-actions-popover');
      if (!popover || popover.querySelector('[data-financial-client]')) return;
      const source = popover.querySelector('[data-client-id]');
      const clientId = source?.dataset.clientId;
      if (!clientId) return;
      const control = document.createElement('button');
      control.type = 'button';
      control.dataset.financialClient = clientId;
      control.textContent = 'Actividad financiera';
      control.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        popover.classList.add('hidden');
        openClientFinancial(clientId).catch(error => alert(error.message));
      });
      const danger = popover.querySelector('.danger');
      if (danger) popover.insertBefore(control, danger); else popover.appendChild(control);
    };
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
    attach();
  }

  function observeEmbedded(sectionId, installer) {
    const attach = () => {
      const frame = frameFor(sectionId);
      if (!frame) return;
      const run = () => {
        try { installer(frame.contentWindow, frame.contentDocument); }
        catch (error) { console.error('[financial traceability embedded]', sectionId, error); }
      };
      if (frame.contentDocument?.readyState === 'complete') run();
      else frame.addEventListener('load', run, { once:true });
    };
    attach();
    window.addEventListener('export-mca:section-changed', attach);
  }

  function installSalesContext(win, doc) {
    if (!doc || doc.__financialSalesContextInstalled) return;
    doc.__financialSalesContextInstalled = true;
    installStyles(doc);
    const render = async () => {
      const modal = doc.getElementById('detailModal');
      if (!modal || modal.classList.contains('hidden')) return;
      const soNumber = doc.getElementById('detailTitle')?.textContent?.trim();
      if (!soNumber) return;
      const sale = await window.OperationalNavigation?.salesByNumber?.(soNumber);
      if (!sale?.sales_order_id || modal.classList.contains('hidden')) return;
      const body = doc.getElementById('detailBody'); if (!body) return;
      doc.getElementById('salesFinancialContext')?.remove();
      const invoices = await invoicesForSalesOrder(sale.sales_order_id);
      const node = block(doc, 'Facturación', invoices.map(invoice => ({
        label:financialLabel(invoice),
        primary:invoice.invoice_status === 'issued',
        action:() => openInvoice(invoice.invoice_id)
      })), 'Esta Sales Order todavía no tiene facturas.');
      node.id = 'salesFinancialContext'; body.appendChild(node);
    };
    const modal = doc.getElementById('detailModal');
    if (modal) new MutationObserver(() => render().catch(error => console.error('[sales financial context]', error))).observe(modal,{attributes:true,attributeFilter:['class']});
    const title = doc.getElementById('detailTitle');
    if (title) new MutationObserver(() => render().catch(error => console.error('[sales financial context]', error))).observe(title,{childList:true,subtree:true});
  }

  function installInvoiceContext(win, doc) {
    if (!doc || doc.__financialInvoiceContextInstalled) return;
    doc.__financialInvoiceContextInstalled = true;
    installStyles(doc);
    const render = async () => {
      const modal = doc.getElementById('detailModal');
      if (!modal || modal.classList.contains('hidden')) return;
      const invoiceNumber = doc.getElementById('detailTitle')?.textContent?.trim();
      const invoice = await invoiceByNumber(invoiceNumber);
      if (!invoice || modal.classList.contains('hidden')) return;
      const body = doc.getElementById('detailBody'); if (!body) return;
      ['invoiceFinancialClient','invoiceFinancialSales','invoiceFinancialDownstream'].forEach(id => doc.getElementById(id)?.remove());
      const clientNode = block(doc,'Cliente',invoice.client_id ? [{ label:invoice.client_name || 'Ver cliente', primary:true, action:() => window.OperationalNavigation?.openClient?.({clientId:invoice.client_id}) }] : [],'La factura no tiene cliente resoluble.');
      clientNode.id='invoiceFinancialClient'; body.appendChild(clientNode);
      const salesNode = block(doc,'Sales Order',invoice.sales_order_id ? [{ label:invoice.so_number || 'Ver Sales Order', action:() => window.OperationalNavigation?.openSales?.({salesOrderId:invoice.sales_order_id}) }] : [],'La factura no tiene Sales Order resoluble.');
      salesNode.id='invoiceFinancialSales'; body.appendChild(salesNode);
      const loads = invoice.sales_order_id ? await window.OperationalNavigation?.loadsForSalesOrder?.(invoice.sales_order_id) || [] : [];
      const downstream = [];
      loads.forEach(load => {
        downstream.push({ label:`Cargue · ${load.load_number}`, action:() => window.OperationalNavigation?.openLoad?.({loadId:load.load_id}) });
        if (load.shipment_id) downstream.push({ label:`Tracking · ${load.container_number || load.load_number}`, action:() => window.OperationalNavigation?.openTracking?.({shipmentId:load.shipment_id}) });
        if (load.operation_id) downstream.push({ label:`Expediente · ${load.container_number || load.load_number}`, action:() => window.OperationalNavigation?.openExpediente?.(load.operation_id) });
      });
      const downstreamNode = block(doc,'Cargue / Tracking / Expediente',downstream,'La Sales Order de esta factura todavía no tiene flujo físico vinculado.');
      downstreamNode.id='invoiceFinancialDownstream'; body.appendChild(downstreamNode);
    };
    const modal = doc.getElementById('detailModal');
    if (modal) new MutationObserver(() => render().catch(error => console.error('[invoice financial context]', error))).observe(modal,{attributes:true,attributeFilter:['class']});
    const title = doc.getElementById('detailTitle');
    if (title) new MutationObserver(() => render().catch(error => console.error('[invoice financial context]', error))).observe(title,{childList:true,subtree:true});
  }

  function mount() {
    installStyles();
    installClientActionObserver();
    observeEmbedded('salesSection', installSalesContext);
    observeEmbedded('invoicesSection', installInvoiceContext);
    window.addEventListener('export-mca:data-loaded', invalidate);
    window.addEventListener('export-mca:clients-changed', invalidate);
    window.FinancialTraceability = Object.freeze({
      openInvoice,
      openClientFinancial,
      invoicesForSalesOrder,
      invoicesForClient,
      invoiceById,
      invoiceByNumber,
      refresh:() => requestLinks({ refresh:true }),
      invalidate,
      owner:'financial-traceability.js'
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  else mount();
})();
