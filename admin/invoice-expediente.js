(() => {
  if (window.__b7InvoiceExpedienteInstalled) return;
  window.__b7InvoiceExpedienteInstalled = true;

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
    field.id = 'b7InvoiceOperationField';
    field.style.marginTop = '10px';
    field.innerHTML = '<label>Expediente *</label><select id="iOperation" disabled><option value="">Selecciona una Sales Order primero</option></select><div id="iOperationHelp" class="muted" style="margin-top:5px">La Factura Comercial se archivará en este Expediente.</div>';
    grid.insertAdjacentElement('afterend', field);
    return field.querySelector('#iOperation');
  }

  function setHelp(message, bad = false) {
    const node = document.getElementById('iOperationHelp');
    if (!node) return;
    node.textContent = message || '';
    node.style.color = bad ? '#b42318' : '';
  }

  function resetField(message = 'Selecciona una Sales Order primero') {
    const select = ensureField();
    if (!select) return;
    select.disabled = true;
    select.innerHTML = `<option value="">${esc(message)}</option>`;
    setHelp('La Factura Comercial se archivará en este Expediente.');
  }

  async function context(params) {
    const query = new URLSearchParams(params);
    const response = await nativeFetch(`/api/invoice-expediente-context?${query.toString()}`, {
      headers: token() ? { Authorization:`Bearer ${token()}` } : {}
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los Expedientes.');
    return data;
  }

  function optionLabel(operation) {
    const route = [operation.origin_port, operation.destination_port].filter(Boolean).join(' → ');
    const reference = operation.booking_number || operation.bol_number || operation.container_number || '';
    return [operation.operation_code || 'Expediente', route, reference].filter(Boolean).join(' · ');
  }

  function renderContext(data, preferredId = null) {
    const select = ensureField();
    if (!select) return;
    const operations = Array.isArray(data?.operations) ? data.operations : [];
    if (!operations.length) {
      select.disabled = true;
      select.innerHTML = '<option value="">No hay Expedientes para este cliente</option>';
      setHelp('Crea primero un Expediente para este cliente en Operaciones → Expedientes.', true);
      return;
    }
    select.disabled = false;
    select.innerHTML = '<option value="">Selecciona un Expediente</option>' + operations.map(operation => `<option value="${esc(operation.id)}">${esc(optionLabel(operation))}</option>`).join('');
    const selected = preferredId || data?.selected_operation_id || '';
    if (selected && operations.some(operation => String(operation.id) === String(selected))) select.value = selected;
    setHelp('Solo se muestran Expedientes pertenecientes al cliente de la Sales Order.');
  }

  async function loadForSalesOrder(salesOrderId, preferredId = null) {
    const select = ensureField();
    if (!salesOrderId) return resetField();
    const sequence = ++state.sequence;
    if (select) {
      select.disabled = true;
      select.innerHTML = '<option value="">Cargando Expedientes…</option>';
    }
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
    if (select) {
      select.disabled = true;
      select.innerHTML = '<option value="">Cargando Expediente…</option>';
    }
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

  const isInvoicesPost = (input, init) => {
    const raw = typeof input === 'string' ? input : input?.url || '';
    const url = new URL(raw, location.origin);
    return url.origin === location.origin && url.pathname === '/api/invoices' && String(init?.method || 'GET').toUpperCase() === 'POST';
  };

  window.fetch = async (input, init = {}) => {
    if (!isInvoicesPost(input, init) || typeof init.body !== 'string') return nativeFetch(input, init);
    let body;
    try { body = JSON.parse(init.body); }
    catch { return nativeFetch(input, init); }
    if (body?.action === 'create_plan' || body?.action === 'replace_plan') {
      const select = ensureField();
      const operationId = String(select?.value || '').trim();
      if (!operationId) throw new Error('Selecciona un Expediente antes de guardar la factura.');
      body.operation_id = operationId;
      return nativeFetch(input, { ...init, body:JSON.stringify(body) });
    }
    return nativeFetch(input, init);
  };

  async function guardIssue(button, invoiceId) {
    try {
      const data = await context({ invoice_id:invoiceId });
      if (!data?.selected_operation_id) {
        alert('Esta factura todavía no tiene Expediente. Ábrela en Editar, selecciona el Expediente y guarda antes de emitirla.');
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
    if (state.issuePass.has(invoiceId)) {
      state.issuePass.delete(invoiceId);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    guardIssue(issue, invoiceId);
  }, true);

  const salesOrder = document.getElementById('iSalesOrder');
  if (salesOrder) salesOrder.addEventListener('change', () => loadForSalesOrder(salesOrder.value || null));

  ensureField();
  resetField();
})();
