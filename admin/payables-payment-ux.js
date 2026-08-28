(() => {
  if (window.__payablesPaymentUXInstalled) return;
  window.__payablesPaymentUXInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const state = {
    mode:'manual',
    balances:new Map(),
    bills:new Map(),
    billPurchaseOrders:[],
    advancePurchaseOrders:[],
    directBillId:null,
    detailBillId:null
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = value => Number(value || 0);
  const money = (value, currency='USD') => `${currency} ${num(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const supplierName = row => row?.supplier?.legal_name || row?.supplier?.name || 'Proveedor';
  const token = () => localStorage.getItem('export_mca_token') || '';

  function requestInfo(input, init={}) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    return { url, method };
  }

  function billBalance(bill) { return num(bill?.financial?.balance_due); }
  function billOpen(id) {
    const bill = state.bills.get(String(id));
    return Boolean(bill && bill.status === 'posted' && billBalance(bill) > 0);
  }

  function syncPaymentButton() {
    const button = document.getElementById('newPayment');
    if (!button) return;
    const hasOpenBills = state.billPurchaseOrders.length > 0;
    button.textContent = '+ Pago manual';
    button.disabled = !hasOpenBills;
    button.title = hasOpenBills
      ? 'Usa Pago manual solo para distribuir un pago o manejar un caso especial. Para el flujo normal usa Pagar en la factura.'
      : 'No hay facturas de proveedor con saldo pendiente';
    button.setAttribute('aria-disabled', String(!hasOpenBills));
  }

  window.fetch = async (input, init={}) => {
    const response = await nativeFetch(input, init);
    const { url, method } = requestInfo(input, init);
    if (method !== 'GET' || !/\/api\/supplier-payments(?:\?|$)/.test(url) || !response.ok) return response;

    try {
      const data = await response.clone().json();
      const balances = new Map();
      const bills = new Map();
      for (const bill of Array.isArray(data?.bills) ? data.bills : []) {
        bills.set(String(bill.id), bill);
        const balance = billBalance(bill);
        if (!(balance > 0) || !bill?.purchase_order_id) continue;
        balances.set(bill.purchase_order_id, (balances.get(bill.purchase_order_id) || 0) + balance);
      }
      state.balances = balances;
      state.bills = bills;
      state.billPurchaseOrders = Array.isArray(data?.purchase_orders) ? data.purchase_orders : [];
      state.advancePurchaseOrders = Array.isArray(data?.advance_purchase_orders) ? data.advance_purchase_orders : [];
      window.__payablesPaymentUXData = {
        balances,
        bills,
        billPurchaseOrders:state.billPurchaseOrders,
        advancePurchaseOrders:state.advancePurchaseOrders
      };
      queueMicrotask(() => {
        syncPaymentButton();
        decoratePayButtons();
      });
    } catch (error) {
      console.warn('[payables payment UX] No se pudo leer el contexto de pagos.', error);
    }
    return response;
  };

  function setPaymentCopy(mode, bill=null) {
    const dialog = document.getElementById('paymentModal');
    const title = dialog?.querySelector('.dialog-head h2');
    const subtitle = dialog?.querySelector('.dialog-head .muted');
    if (!title || !subtitle) return;

    if (mode === 'advance') {
      title.textContent = 'Registrar anticipo';
      subtitle.textContent = 'Anticipo antes de la factura final. Quedará sin aplicar hasta que exista una factura contabilizada.';
      return;
    }
    if (mode === 'direct' && bill) {
      title.textContent = `Pagar ${bill.bill_number}`;
      subtitle.textContent = `Pago directo a esta factura. Se aplicará automáticamente al guardar. Saldo ${money(billBalance(bill),bill.currency)}.`;
      return;
    }
    title.textContent = 'Pago manual';
    subtitle.textContent = 'Usa este flujo para pagos que después necesites distribuir entre una o varias facturas. Para una factura normal usa Pagar desde su fila.';
  }

  function ensureBalanceHint() {
    const po = document.getElementById('pPO');
    if (!po || document.getElementById('pOpenBalanceHint')) return;
    const hint = document.createElement('div');
    hint.id = 'pOpenBalanceHint';
    hint.className = 'muted';
    hint.style.marginTop = '6px';
    po.insertAdjacentElement('afterend', hint);
  }

  function decorateBillOptions() {
    const select = document.getElementById('pPO');
    if (!select || state.mode !== 'manual') return;
    [...select.options].forEach(option => {
      if (!option.value) return;
      const po = state.billPurchaseOrders.find(row => String(row.id) === String(option.value));
      const balance = num(po?.open_balance || state.balances.get(option.value));
      if (!po || !(balance > 0)) {
        option.remove();
        return;
      }
      option.textContent = `${po.po_number} · ${supplierName(po)} · Saldo ${money(balance,po.currency)}`;
    });
    updatePaymentHint();
  }

  function fillAdvanceOptions() {
    const select = document.getElementById('pPO');
    if (!select) return;
    const rows = state.advancePurchaseOrders;
    select.disabled = false;
    select.innerHTML = '<option value="">Selecciona una Purchase Order para anticipo</option>' + rows.map(po =>
      `<option value="${esc(po.id)}">${esc(po.po_number)} · ${esc(supplierName(po))} · ${esc(po.currency || 'USD')}</option>`
    ).join('');
    updatePaymentHint();
  }

  function updatePaymentHint() {
    ensureBalanceHint();
    const hint = document.getElementById('pOpenBalanceHint');
    const select = document.getElementById('pPO');
    const amount = document.getElementById('pAmount');
    if (!hint || !select) return;

    if (state.mode === 'direct') {
      const bill = state.bills.get(String(state.directBillId));
      hint.textContent = bill ? `Factura ${bill.bill_number} · Saldo actual ${money(billBalance(bill),bill.currency)}. El pago se aplicará automáticamente.` : '';
      return;
    }

    if (state.mode === 'advance') {
      hint.textContent = select.value
        ? 'Anticipo: este pago no requiere una factura abierta y quedará pendiente de aplicación.'
        : 'Selecciona una PO activa. Las PO cerradas no se ofrecen para nuevos anticipos.';
      return;
    }

    const po = state.billPurchaseOrders.find(row => String(row.id) === String(select.value));
    const balance = num(po?.open_balance || state.balances.get(select.value));
    if (!select.value) {
      hint.textContent = state.billPurchaseOrders.length
        ? 'Pago manual: selecciona una PO con saldo pendiente. Después podrás distribuir el pago.'
        : 'No hay facturas de proveedor con saldo pendiente.';
      return;
    }
    hint.textContent = `Saldo pendiente total de esta PO: ${money(balance,po?.currency || 'USD')}.`;
    if (amount && !(num(amount.value) > 0) && balance > 0) amount.value = String(balance);
  }

  function resetDirectMode() {
    state.directBillId = null;
    const select = document.getElementById('pPO');
    if (select) select.disabled = false;
  }

  function openAdvance() {
    resetDirectMode();
    state.mode = 'advance';
    const original = document.getElementById('newPayment');
    if (typeof original?.onclick === 'function') original.onclick.call(original, new Event('click'));
    setPaymentCopy('advance');
    fillAdvanceOptions();
    const amount = document.getElementById('pAmount');
    if (amount) amount.value = '';
  }

  function openDirectPayment(billId) {
    const bill = state.bills.get(String(billId));
    if (!bill || !billOpen(billId)) return;
    state.mode = 'direct';
    state.directBillId = bill.id;
    const original = document.getElementById('newPayment');
    if (typeof original?.onclick !== 'function') return;
    original.onclick.call(original, new Event('click'));
    setPaymentCopy('direct',bill);

    const select = document.getElementById('pPO');
    const amount = document.getElementById('pAmount');
    if (select) {
      select.value = bill.purchase_order_id;
      select.disabled = true;
    }
    if (amount) amount.value = String(billBalance(bill));
    updatePaymentHint();
  }

  async function saveDirectPayment() {
    const bill = state.bills.get(String(state.directBillId));
    const amount = num(document.getElementById('pAmount')?.value);
    const msg = document.getElementById('paymentMsg');
    const save = document.getElementById('savePayment');
    if (msg) msg.textContent = '';
    if (!bill) { if (msg) msg.textContent='Factura no encontrada.'; return; }
    if (!(amount > 0)) { if (msg) msg.textContent='El monto debe ser mayor que cero.'; return; }
    if (amount > billBalance(bill)) { if (msg) msg.textContent='El pago no puede superar el saldo de la factura.'; return; }

    if (save) save.disabled = true;
    try {
      const response = await window.fetch('/api/supplier-payments', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', ...(token() ? { Authorization:`Bearer ${token()}` } : {}) },
        body:JSON.stringify({
          action:'pay_bill',
          supplier_bill_id:bill.id,
          amount,
          payment_date:document.getElementById('pDate')?.value || null,
          method:document.getElementById('pMethod')?.value || null,
          reference:document.getElementById('pReference')?.value || null,
          notes:document.getElementById('pNotes')?.value || null
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No se pudo registrar el pago');
      document.getElementById('paymentModal')?.classList.add('hidden');
      resetDirectMode();
      state.mode = 'manual';
      await window.PayablesModule?.refresh?.();
    } catch (error) {
      if (msg) msg.textContent = error.message;
    } finally {
      if (save) save.disabled = false;
    }
  }

  function ensureAdvanceButton() {
    const normal = document.getElementById('newPayment');
    if (!normal) return;
    normal.textContent = '+ Pago manual';
    if (document.getElementById('newAdvancePayment')) return;
    const advance = document.createElement('button');
    advance.id = 'newAdvancePayment';
    advance.type = 'button';
    advance.className = 'btn';
    advance.textContent = '+ Anticipo';
    normal.insertAdjacentElement('afterend', advance);
    advance.addEventListener('click', openAdvance);
  }

  function directPayButton(billId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn orange';
    button.dataset.directPayBill = String(billId);
    button.textContent = 'Pagar';
    button.title = 'Registrar y aplicar un pago directamente a esta factura';
    return button;
  }

  function decoratePayButtons() {
    document.querySelectorAll('[data-direct-pay-bill]').forEach(button => {
      if (!billOpen(button.dataset.directPayBill)) button.remove();
    });

    document.querySelectorAll('[data-bill-detail]').forEach(detail => {
      const id = detail.dataset.billDetail;
      if (!billOpen(id)) return;
      const actions = detail.closest('.actions');
      if (!actions || actions.querySelector(`[data-direct-pay-bill="${CSS.escape(String(id))}"]`)) return;
      actions.insertBefore(directPayButton(id), actions.firstChild);
    });

    const detailActions = document.getElementById('detailActions');
    if (detailActions && state.detailBillId && billOpen(state.detailBillId) && !detailActions.querySelector('[data-direct-pay-bill]')) {
      detailActions.insertBefore(directPayButton(state.detailBillId), detailActions.firstChild);
    }
  }

  function hideSettledAllocationRows() {
    const target = document.getElementById('allocationBills');
    if (!target) return;
    const rows = [...target.querySelectorAll('[data-allocation-bill]')];
    if (!rows.length) return;
    let visible = 0;
    rows.forEach(row => {
      const input = row.querySelector('[data-amount]');
      const available = num(input?.max);
      const current = num(input?.value);
      const show = available > 0 || current > 0;
      row.style.display = show ? '' : 'none';
      if (show) visible += 1;
    });
    let empty = document.getElementById('allocationOpenBalanceEmpty');
    if (!visible) {
      if (!empty) {
        empty = document.createElement('div');
        empty.id = 'allocationOpenBalanceEmpty';
        empty.className = 'empty';
        empty.textContent = 'Esta PO no tiene facturas con saldo pendiente. Revisa el pago o revértelo si seleccionaste la PO equivocada.';
        target.appendChild(empty);
      }
    } else empty?.remove();
  }

  function install() {
    ensureAdvanceButton();
    ensureBalanceHint();
    syncPaymentButton();

    document.addEventListener('click', event => {
      const direct = event.target.closest('[data-direct-pay-bill]');
      if (direct) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openDirectPayment(direct.dataset.directPayBill);
        return;
      }

      const detail = event.target.closest('[data-bill-detail]');
      if (detail) state.detailBillId = detail.dataset.billDetail;

      if (event.target.closest('#savePayment') && state.mode === 'direct') {
        event.preventDefault();
        event.stopImmediatePropagation();
        saveDirectPayment();
        return;
      }

      if (event.target.closest('#newPayment')) {
        resetDirectMode();
        state.mode = 'manual';
        queueMicrotask(() => {
          setPaymentCopy('manual');
          decorateBillOptions();
        });
      }
    }, true);

    document.getElementById('pPO')?.addEventListener('change', updatePaymentHint);

    const list = document.getElementById('list');
    if (list) new MutationObserver(decoratePayButtons).observe(list,{ childList:true,subtree:true });
    const detailActions = document.getElementById('detailActions');
    if (detailActions) new MutationObserver(decoratePayButtons).observe(detailActions,{ childList:true,subtree:true });
    const allocationTarget = document.getElementById('allocationBills');
    if (allocationTarget) new MutationObserver(hideSettledAllocationRows).observe(allocationTarget,{ childList:true,subtree:true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
