(() => {
  if (window.__payablesPaymentUXInstalled) return;
  window.__payablesPaymentUXInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const state = { mode:'bill', balances:new Map(), billPurchaseOrders:[], advancePurchaseOrders:[] };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = value => Number(value || 0);
  const money = (value, currency='USD') => `${currency} ${num(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const supplierName = row => row?.supplier?.legal_name || row?.supplier?.name || 'Proveedor';

  function requestInfo(input, init={}) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    return { url, method };
  }

  function syncPaymentButton() {
    const button = document.getElementById('newPayment');
    if (!button) return;
    const hasOpenBills = state.billPurchaseOrders.length > 0;
    button.disabled = !hasOpenBills;
    button.title = hasOpenBills ? 'Registrar pago de una factura pendiente' : 'No hay facturas de proveedor con saldo pendiente';
    button.setAttribute('aria-disabled', String(!hasOpenBills));
  }

  window.fetch = async (input, init={}) => {
    const response = await nativeFetch(input, init);
    const { url, method } = requestInfo(input, init);
    if (method !== 'GET' || !/\/api\/supplier-payments(?:\?|$)/.test(url) || !response.ok) return response;

    try {
      const data = await response.clone().json();
      const balances = new Map();
      for (const bill of Array.isArray(data?.bills) ? data.bills : []) {
        const balance = num(bill?.financial?.balance_due);
        if (!(balance > 0) || !bill?.purchase_order_id) continue;
        balances.set(bill.purchase_order_id, (balances.get(bill.purchase_order_id) || 0) + balance);
      }
      state.balances = balances;
      state.billPurchaseOrders = Array.isArray(data?.purchase_orders) ? data.purchase_orders : [];
      state.advancePurchaseOrders = Array.isArray(data?.advance_purchase_orders) ? data.advance_purchase_orders : [];
      window.__payablesPaymentUXData = {
        balances,
        billPurchaseOrders:state.billPurchaseOrders,
        advancePurchaseOrders:state.advancePurchaseOrders
      };
      queueMicrotask(syncPaymentButton);
    } catch (error) {
      console.warn('[payables payment UX] No se pudo leer el contexto de pagos.', error);
    }
    return response;
  };

  function setPaymentCopy(mode) {
    const dialog = document.getElementById('paymentModal');
    const title = dialog?.querySelector('.dialog-head h2');
    const subtitle = dialog?.querySelector('.dialog-head .muted');
    if (title) title.textContent = mode === 'advance' ? 'Registrar anticipo' : 'Pagar factura de proveedor';
    if (subtitle) subtitle.textContent = mode === 'advance'
      ? 'Anticipo antes de la factura final. Quedará sin aplicar hasta que exista una factura contabilizada.'
      : 'Solo se muestran Purchase Orders con facturas contabilizadas y saldo pendiente.';
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
    if (!select || state.mode !== 'bill') return;
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
        ? 'Selecciona una PO con saldo pendiente.'
        : 'No hay facturas de proveedor con saldo pendiente.';
      return;
    }
    hint.textContent = `Saldo pendiente de esta PO: ${money(balance,po?.currency || 'USD')}.`;
    if (amount && !(num(amount.value) > 0) && balance > 0) amount.value = String(balance);
  }

  function openAdvance() {
    state.mode = 'advance';
    const original = document.getElementById('newPayment');
    if (typeof original?.onclick === 'function') original.onclick.call(original, new Event('click'));
    setPaymentCopy('advance');
    fillAdvanceOptions();
    const amount = document.getElementById('pAmount');
    if (amount) amount.value = '';
  }

  function ensureAdvanceButton() {
    const normal = document.getElementById('newPayment');
    if (!normal) return;
    normal.textContent = '+ Pago de factura';
    if (document.getElementById('newAdvancePayment')) return;
    const advance = document.createElement('button');
    advance.id = 'newAdvancePayment';
    advance.type = 'button';
    advance.className = 'btn';
    advance.textContent = '+ Anticipo';
    normal.insertAdjacentElement('afterend', advance);
    advance.addEventListener('click', openAdvance);
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
      if (event.target.closest('#newPayment')) {
        state.mode = 'bill';
        queueMicrotask(() => {
          setPaymentCopy('bill');
          decorateBillOptions();
        });
      }
    }, true);

    document.getElementById('pPO')?.addEventListener('change', updatePaymentHint);

    const allocationTarget = document.getElementById('allocationBills');
    if (allocationTarget) new MutationObserver(hideSettledAllocationRows).observe(allocationTarget,{ childList:true,subtree:true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
