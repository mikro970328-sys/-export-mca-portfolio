(() => {
  if (window.__invoiceExpedienteV2Installed) return;
  window.__invoiceExpedienteV2Installed = true;

  const nativeFetch = window.fetch.bind(window);
  const state = { editingInvoiceId:null, sequence:0, issuePass:new Set() };
  const token = () => localStorage.getItem('export_mca_token') || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function ensureField() {
    let select = document.getElementById('iOperation');
    if (select) return select;
    const grid = document.querySelector('#invoiceModal .grid3');
    if (!grid) return null;
    const field = document.createElement('div');
    field.id = 'invoiceOperationField';
    field.style.marginTop = '10px';
    field.innerHTML = '<label>Expediente <span class="muted">(requerido antes de emitir)</span></label><select id="iOperation" disabled><option value="">Selecciona una venta primero</option></select><div id="iOperationHelp" class="muted" style="margin-top:5px">Puedes guardar la factura de cobro como borrador sin Expediente. El Packing List y la Commercial Invoice aduanal se administran aparte dentro del Expediente.</div>';
    grid.insertAdjacentElement('afterend', field);
    return field.querySelector('#iOperation');
  }

  function setHelp(message, bad=false) {
    const node = document.getElementById('iOperationHelp');
    if (!node) return;
    node.textContent = message || '';
    node.style.color = bad ? '#b42318' : '';
  }

  function resetField(message='Selecciona una venta primero') {
    const select = ensureField();
    if (!select) return;
    select.disabled = true;
    select.innerHTML = `<option value="">${esc(message)}</option>`;
    setHelp('Puedes guardar la factura de cobro como borrador sin Expediente. Antes de emitir debes asignar uno del mismo cliente.');
  }

  async function context(params) {
    const query = new URLSearchParams(params);
    const response = await nativeFetch(`/api/invoice-expediente-context?${query.toString()}`, { headers:token() ? {Authorization:`Bearer ${token()}`} : {} });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los Expedientes.');
    return data;
  }

  function optionLabel(operation) {
    const route = [operation.origin_port, operation.destination_port].filter(Boolean).join(' → ');
    const reference = operation.booking_number || operation.bol_number || operation.container_number || '';
    return [operation.operation_code || 'Expediente', route, reference].filter(Boolean).join(' · ');
  }

  function renderContext(data, preferredId=null) {
    const select = ensureField();
    if (!select) return;
    const operations = Array.isArray(data?.operations) ? data.operations : [];
    if (!operations.length) {
      select.disabled = true;
      select.innerHTML = '<option value="">Sin Expediente todavía</option>';
      setHelp('Puedes guardar este borrador. Crea el Expediente antes de emitir la factura de cobro.', false);
      return;
    }
    select.disabled = false;
    select.innerHTML = '<option value="">Expediente pendiente</option>' + operations.map(operation => `<option value="${esc(operation.id)}">${esc(optionLabel(operation))}</option>`).join('');
    const selected = preferredId || data?.selected_operation_id || '';
    if (selected && operations.some(operation => String(operation.id) === String(selected))) select.value = selected;
    setHelp('Solo aparecen Expedientes del mismo cliente. Puedes dejarlo pendiente mientras la factura siga en borrador.');
  }

  async function loadForSalesOrder(salesOrderId, preferredId=null) {
    const select = ensureField();
    if (!salesOrderId) return resetField();
    const sequence = ++state.sequence;
    if (select) { select.disabled=true; select.innerHTML='<option value="">Cargando Expedientes…</option>'; }
    try {
      const data = await context({ sales_order_id:salesOrderId });
      if (sequence !== state.sequence) return;
      renderContext(data, preferredId);
    } catch (error) {
      if (sequence !== state.sequence) return;
      resetField('No se pudieron cargar los Expedientes');
      setHelp(error.message || 'No se pudieron cargar los Expedientes.', true);
    }
  }

  async function loadForInvoice(invoiceId) {
    const sequence = ++state.sequence;
    const select = ensureField();
    if (select) { select.disabled=true; select.innerHTML='<option value="">Cargando Expediente…</option>'; }
    try {
      const data = await context({ invoice_id:invoiceId });
      if (sequence !== state.sequence) return;
      renderContext(data, data.selected_operation_id || null);
    } catch (error) {
      if (sequence !== state.sequence) return;
      resetField('No se pudo cargar el Expediente');
      setHelp(error.message || 'No se pudo cargar el Expediente.', true);
    }
  }

  function isInvoicesPost(input, init) {
    const raw = typeof input === 'string' ? input : input?.url || '';
    const url = new URL(raw, location.origin);
    return url.origin === location.origin && url.pathname === '/api/invoices' && String(init?.method || 'GET').toUpperCase() === 'POST';
  }

  window.fetch = async (input, init={}) => {
    if (!isInvoicesPost(input, init) || typeof init.body !== 'string') return nativeFetch(input, init);
    let body;
    try { body = JSON.parse(init.body); }
    catch { return nativeFetch(input, init); }
    if (body?.action === 'create_plan' || body?.action === 'replace_plan') {
      const operationId = String(ensureField()?.value || '').trim();
      body.operation_id = operationId || null;
      return nativeFetch(input, { ...init, body:JSON.stringify(body) });
    }
    return nativeFetch(input, init);
  };

  async function guardIssue(button, invoiceId) {
    try {
      const data = await context({ invoice_id:invoiceId });
      if (!data?.selected_operation_id) {
        alert('Antes de emitir esta factura de cobro debes asignarle un Expediente del mismo cliente. Puedes mantenerla en borrador mientras tanto.');
        const edit = document.querySelector(`[data-edit="${CSS.escape(invoiceId)}"]`);
        if (edit) edit.click();
        return;
      }
      state.issuePass.add(invoiceId);
      button.click();
    } catch (error) {
      alert(error.message || 'No se pudo validar el Expediente de la factura.');
    }
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('#newInvoice')) {
      state.editingInvoiceId = null;
      setTimeout(() => resetField(), 0);
      return;
    }
    const edit = target.closest('[data-edit]');
    if (edit) {
      state.editingInvoiceId = edit.dataset.edit || null;
      setTimeout(() => loadForInvoice(state.editingInvoiceId), 0);
      return;
    }
    const issue = target.closest('[data-issue]');
    if (!issue) return;
    const invoiceId = issue.dataset.issue || '';
    if (state.issuePass.has(invoiceId)) { state.issuePass.delete(invoiceId); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    guardIssue(issue, invoiceId);
  }, true);

  const salesOrder = document.getElementById('iSalesOrder');
  if (salesOrder) salesOrder.addEventListener('change', () => loadForSalesOrder(salesOrder.value || null));

  ensureField();
  resetField();
})();
