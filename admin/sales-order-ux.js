(() => {
  const byId = id => document.getElementById(id);
  const token = () => localStorage.getItem('export_mca_token') || '';
  const num = value => Number(value || 0);
  const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const fmt = value => new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(num(value));
  const money = (value,currency='USD') => {
    try { return new Intl.NumberFormat('en-US',{style:'currency',currency:String(currency||'USD').toUpperCase(),maximumFractionDigits:2}).format(num(value)); }
    catch { return `${String(currency||'USD').toUpperCase()} ${num(value).toFixed(2)}`; }
  };
  const inputNumber = value => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return String(Number(n.toFixed(8)));
  };
  const currentEditing = () => {
    try { return typeof editing !== 'undefined' ? editing : null; } catch { return null; }
  };

  let clientPage = 1;
  let clientHasMore = false;
  let clientQuery = '';
  let clientTimer = null;
  const inventoryCache = new Map();

  async function uxApi(path, options={}) {
    const response = await fetch(path, {
      ...options,
      headers:{
        'Content-Type':'application/json',
        ...(token() ? {Authorization:`Bearer ${token()}`} : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo procesar Ventas');
    return data;
  }

  function ensureClientPickerModal() {
    if (byId('clientPickerModal')) return;
    const modal = document.createElement('div');
    modal.id = 'clientPickerModal';
    modal.className = 'modal hidden';
    modal.innerHTML = `<div class="dialog client-picker-dialog">
      <div class="dialog-head"><div><h2>Seleccionar cliente</h2><div class="muted">Busca por nombre o empresa y navega las páginas de clientes activos.</div></div><button type="button" class="btn" data-client-close>✕</button></div>
      <input id="clientPickerSearch" class="client-picker-search" placeholder="Buscar cliente o empresa">
      <div id="clientPickerList" class="client-picker-list"></div>
      <div class="client-picker-footer"><button id="clientPrev" type="button" class="btn">← Anterior</button><span id="clientPageLabel" class="muted">Página 1</span><button id="clientNext" type="button" class="btn">Siguiente →</button></div>
      <div id="clientPickerMsg" class="msg"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-client-close]').onclick = closeClientPicker;
    modal.addEventListener('click', event => { if (event.target === modal) closeClientPicker(); });
    byId('clientPrev').onclick = () => { if (clientPage > 1) { clientPage--; loadClientPage(); } };
    byId('clientNext').onclick = () => { if (clientHasMore) { clientPage++; loadClientPage(); } };
    byId('clientPickerSearch').addEventListener('input', event => {
      clearTimeout(clientTimer);
      clientTimer = setTimeout(() => {
        clientQuery = event.target.value.trim();
        clientPage = 1;
        loadClientPage();
      }, 220);
    });
  }

  function ensureClientPickerButton() {
    const select = byId('oClient');
    if (!select || byId('oClientPickerButton')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'oClientPickerButton';
    button.className = 'client-picker-button';
    button.innerHTML = '<strong>Seleccionar cliente</strong><span>Buscar ›</span>';
    select.insertAdjacentElement('afterend', button);
    button.onclick = openClientPicker;
    syncClientButton();
  }

  function syncClientButton() {
    const select = byId('oClient');
    const button = byId('oClientPickerButton');
    if (!select || !button) return;
    const edit = currentEditing();
    if (!select.value && edit?.client_id) {
      const label = edit?.client?.company || edit?.client?.mipyme_name || edit?.client?.name || 'Cliente seleccionado';
      if (![...select.options].some(option => option.value === edit.client_id)) {
        select.add(new Option(label, edit.client_id));
      }
      select.value = edit.client_id;
    }
    const option = select.selectedOptions?.[0];
    const label = select.value && option ? option.textContent : 'Seleccionar cliente';
    button.innerHTML = `<strong>${esc(label)}</strong><span>${select.value ? 'Cambiar ›' : 'Buscar ›'}</span>`;
  }

  async function openClientPicker() {
    ensureClientPickerModal();
    clientPage = 1;
    clientQuery = '';
    byId('clientPickerSearch').value = '';
    byId('clientPickerMsg').textContent = '';
    byId('clientPickerModal').classList.remove('hidden');
    await loadClientPage();
    setTimeout(() => byId('clientPickerSearch')?.focus(), 0);
  }

  function closeClientPicker() {
    byId('clientPickerModal')?.classList.add('hidden');
  }

  async function loadClientPage() {
    const list = byId('clientPickerList');
    if (!list) return;
    list.innerHTML = '<div class="empty">Cargando clientes…</div>';
    byId('clientPickerMsg').textContent = '';
    try {
      const params = new URLSearchParams({mode:'clients',page:String(clientPage),page_size:'25'});
      if (clientQuery) params.set('q',clientQuery);
      const data = await uxApi(`/api/sales-order-ux?${params.toString()}`);
      clientHasMore = Boolean(data.has_more);
      const rows = Array.isArray(data.clients) ? data.clients : [];
      list.innerHTML = rows.length ? rows.map(row => `<button type="button" class="client-picker-row" data-client-id="${esc(row.id)}">
        <div><b>${esc(row.display_name || row.company || row.mipyme_name || row.name || 'Cliente')}</b><div class="small">${esc(row.name || '')}</div></div>
        <div class="secondary small">${esc(row.company || row.mipyme_name || '')}</div><span class="choose">Seleccionar</span>
      </button>`).join('') : '<div class="empty">No se encontraron clientes.</div>';
      list.querySelectorAll('[data-client-id]').forEach(button => button.onclick = () => chooseClient(button.dataset.clientId));
      byId('clientPageLabel').textContent = `Página ${clientPage}`;
      byId('clientPrev').disabled = clientPage <= 1;
      byId('clientNext').disabled = !clientHasMore;
    } catch (error) {
      list.innerHTML = '<div class="empty">No se pudieron cargar los clientes.</div>';
      byId('clientPickerMsg').textContent = error.message;
    }
  }

  async function chooseClient(clientId) {
    try {
      byId('clientPickerMsg').textContent = 'Seleccionando…';
      const data = await uxApi(`/api/sales-order-ux?mode=client_context&client_id=${encodeURIComponent(clientId)}`);
      const client = data.client;
      const select = byId('oClient');
      if (!client || !select) return;
      if (![...select.options].some(option => option.value === client.id)) {
        select.add(new Option(client.display_name || client.company || client.mipyme_name || client.name || 'Cliente', client.id));
      }
      select.value = client.id;
      const importerSelect = byId('oImporter');
      if (importerSelect) {
        importerSelect.innerHTML = '<option value="">Sin importador definido</option>' + (data.importers || []).map(row => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');
      }
      syncClientButton();
      closeClientPicker();
    } catch (error) {
      byId('clientPickerMsg').textContent = error.message;
    }
  }

  function decorateAllLines() {
    document.querySelectorAll('#orderLines .line').forEach(decorateLine);
    ensureOrderTotalPreview();
    refreshOrderTotalPreview();
  }

  function decorateLine(line) {
    if (!line || line.dataset.salesUxReady === '1') return;
    line.dataset.salesUxReady = '1';
    const price = line.querySelector('.lPrice');
    const qty = line.querySelector('.lQty');
    const pallets = line.querySelector('.lPallets');
    const upp = line.querySelector('.lUpp');
    const product = line.querySelector('.lProduct');
    if (!price || !qty || !pallets || !upp || !product) return;

    const priceLabel = price.closest('div')?.querySelector('label');
    if (priceLabel) priceLabel.textContent = 'Precio unitario';
    const secondGrid = price.closest('.grid3');
    if (secondGrid) secondGrid.classList.add('sales-price-grid');
    const totalWrap = document.createElement('div');
    totalWrap.innerHTML = '<label>Total venta</label><input class="lTotal" type="number" min="0" step="0.01" placeholder="Total de esta línea"><div class="pricing-hint">Usa unitario o total.</div>';
    price.closest('div').insertAdjacentElement('afterend', totalWrap);
    const total = totalWrap.querySelector('.lTotal');

    const stock = document.createElement('div');
    stock.className = 'sales-stock';
    stock.innerHTML = '<div class="sales-stock-title">Existencia por almacén</div><div class="muted">Selecciona un producto para consultar inventario.</div>';
    const info = line.querySelector('.lProductInfo');
    (info || secondGrid || line).insertAdjacentElement('afterend', stock);

    line.dataset.priceMode = price.value !== '' ? 'unit' : '';
    if (price.value !== '' && qty.value !== '') total.value = inputNumber(num(qty.value) * num(price.value));

    price.addEventListener('input', () => {
      line.dataset.priceMode = 'unit';
      syncPricing(line,'unit');
    });
    total.addEventListener('input', () => {
      line.dataset.priceMode = 'total';
      syncPricing(line,'total');
    });
    qty.addEventListener('input', () => {
      line.dataset.quantityMode = 'quantity';
      syncPalletsFromQuantity(line);
      syncPricing(line,line.dataset.priceMode);
      updateStockWarning(line);
    });
    pallets.addEventListener('input', () => {
      line.dataset.quantityMode = 'pallets';
      syncQuantityFromPallets(line);
      syncPricing(line,line.dataset.priceMode);
      updateStockWarning(line);
    });
    upp.addEventListener('input', () => {
      if (line.dataset.quantityMode === 'pallets' || (!qty.value && pallets.value)) syncQuantityFromPallets(line);
      else if (qty.value) syncPalletsFromQuantity(line);
      syncPricing(line,line.dataset.priceMode);
    });
    product.addEventListener('change', () => {
      setTimeout(() => {
        if (!upp.value) {
          try {
            const p = typeof products !== 'undefined' ? products.find(row => row.id === product.value) : null;
            if (p?.default_units_per_pallet) upp.value = p.default_units_per_pallet;
          } catch {}
        }
        loadInventory(line);
      },0);
    });
    if (product.value) loadInventory(line);
  }

  function syncPalletsFromQuantity(line) {
    const qty = num(line.querySelector('.lQty')?.value);
    const upp = num(line.querySelector('.lUpp')?.value);
    if (upp > 0) line.querySelector('.lPallets').value = qty > 0 ? inputNumber(qty / upp) : '';
  }

  function syncQuantityFromPallets(line) {
    const pallets = num(line.querySelector('.lPallets')?.value);
    const upp = num(line.querySelector('.lUpp')?.value);
    if (upp > 0) line.querySelector('.lQty').value = pallets > 0 ? inputNumber(pallets * upp) : '';
  }

  function syncPricing(line, mode) {
    const qty = num(line.querySelector('.lQty')?.value);
    const price = line.querySelector('.lPrice');
    const total = line.querySelector('.lTotal');
    if (!price || !total) return;
    if (mode === 'total') {
      if (qty > 0 && total.value !== '') price.value = inputNumber(num(total.value) / qty);
    } else if (mode === 'unit') {
      if (qty > 0 && price.value !== '') total.value = inputNumber(qty * num(price.value));
    }
    const hint = total.parentElement.querySelector('.pricing-hint');
    if (hint) {
      hint.classList.toggle('active',Boolean(mode));
      hint.textContent = mode === 'total' ? 'Total manda; unitario calculado.' : mode === 'unit' ? 'Unitario manda; total calculado.' : 'Usa unitario o total.';
    }
    refreshOrderTotalPreview();
  }

  async function loadInventory(line) {
    const productId = line.querySelector('.lProduct')?.value;
    const stock = line.querySelector('.sales-stock');
    if (!stock) return;
    if (!productId) {
      stock.innerHTML = '<div class="sales-stock-title">Existencia por almacén</div><div class="muted">Selecciona un producto para consultar inventario.</div>';
      return;
    }
    stock.innerHTML = '<div class="sales-stock-title">Existencia por almacén</div><div class="muted">Consultando inventario real…</div>';
    try {
      let data = inventoryCache.get(productId);
      if (!data) {
        data = await uxApi(`/api/sales-order-ux?mode=inventory&product_id=${encodeURIComponent(productId)}`);
        inventoryCache.set(productId,data);
      }
      line.dataset.availableQuantity = String(data.totals?.available_quantity || 0);
      line.dataset.availablePallets = String(data.totals?.available_pallets || 0);
      const rows = Array.isArray(data.inventory) ? data.inventory : [];
      const unit = rows[0]?.unit || '';
      const totals = data.totals || {};
      stock.innerHTML = `<div class="sales-stock-head"><div><div class="sales-stock-title">Existencia por almacén</div><div class="sales-stock-totals">Total: <b>${fmt(totals.physical_quantity)} ${esc(unit)}</b> físico · <b>${fmt(totals.reserved_quantity)}</b> reservado · <b>${fmt(totals.available_quantity)}</b> disponible · <b>${fmt(totals.available_pallets)}</b> pallets disponibles</div></div></div>
        ${rows.length ? `<div class="sales-stock-warehouses">${rows.map(row => `<div class="sales-stock-row"><div><b>${esc(row.warehouse_code || '')}</b> · ${esc(row.warehouse_name || '')}</div><div>Físico <b>${fmt(row.physical_quantity)}</b></div><div>Reservado <b>${fmt(row.reserved_quantity)}</b></div><div>Disponible <b>${fmt(row.available_quantity)}</b> · ${fmt(row.available_pallets)} pallets</div></div>`).join('')}</div>` : '<div class="sales-stock-warning">No hay existencia física registrada para este producto.</div>'}
        <div class="sales-stock-warning" data-stock-warning></div><div class="sales-stock-note">La Sales Order no reserva inventario. La reserva ocurre después al crear el Cargue.</div>`;
      updateStockWarning(line);
    } catch (error) {
      stock.innerHTML = `<div class="sales-stock-title">Existencia por almacén</div><div class="sales-stock-warning">${esc(error.message)}</div>`;
    }
  }

  function updateStockWarning(line) {
    const warning = line.querySelector('[data-stock-warning]');
    if (!warning) return;
    const qty = num(line.querySelector('.lQty')?.value);
    const available = num(line.dataset.availableQuantity);
    warning.textContent = qty > available ? `Aviso: estás vendiendo ${fmt(qty)} y actualmente hay ${fmt(available)} disponibles. La SO puede guardarse, pero el Cargue no podrá reservar más inventario del disponible.` : '';
  }

  function ensureOrderTotalPreview() {
    if (byId('salesOrderTotalPreview')) return;
    const lines = byId('orderLines');
    if (!lines) return;
    const box = document.createElement('div');
    box.id = 'salesOrderTotalPreview';
    box.className = 'sales-total-preview';
    box.innerHTML = '<div><span>Total de la Sales Order</span><b>USD 0.00</b></div>';
    lines.insertAdjacentElement('afterend',box);
  }

  function refreshOrderTotalPreview() {
    const box = byId('salesOrderTotalPreview');
    if (!box) return;
    const total = [...document.querySelectorAll('#orderLines .lTotal')].reduce((sum,input) => sum + num(input.value),0);
    box.querySelector('b').textContent = money(total,byId('oCurrency')?.value || 'USD');
  }

  async function hydrateExactPricing() {
    const edit = currentEditing();
    if (!edit?.id) return;
    try {
      const data = await uxApi(`/api/sales-order-ux?mode=pricing&sales_order_id=${encodeURIComponent(edit.id)}`);
      const exactById = new Map((data.items || []).map(item => [item.id,item.entered_line_total]));
      const domLines = [...document.querySelectorAll('#orderLines .line')];
      (edit.items || []).forEach((item,index) => {
        const exact = exactById.get(item.id);
        const line = domLines[index];
        if (!line || exact === null || exact === undefined) return;
        const total = line.querySelector('.lTotal');
        if (!total) return;
        total.value = inputNumber(exact);
        line.dataset.priceMode = 'total';
        syncPricing(line,'total');
      });
      refreshOrderTotalPreview();
    } catch {}
  }

  function collectUxLines() {
    return [...document.querySelectorAll('#orderLines .line')].map((line,index) => {
      const productId = line.querySelector('.lProduct')?.value || '';
      const qty = line.querySelector('.lQty')?.value || '';
      const pallets = line.querySelector('.lPallets')?.value || '';
      const upp = line.querySelector('.lUpp')?.value || '';
      const price = line.querySelector('.lPrice')?.value ?? '';
      const total = line.querySelector('.lTotal')?.value ?? '';
      const mode = line.dataset.priceMode || (total !== '' ? 'total' : price !== '' ? 'unit' : '');
      if (!productId) throw new Error(`Selecciona el producto de la línea ${index+1}.`);
      if (num(qty) <= 0 && !(num(pallets) > 0 && num(upp) > 0)) throw new Error(`Indica cantidad o pallets válidos en la línea ${index+1}.`);
      if (!mode || (mode === 'total' && total === '') || (mode === 'unit' && price === '')) throw new Error(`Indica precio unitario o total de venta en la línea ${index+1}.`);
      return {
        product_id:productId,
        ordered_quantity:qty,
        ordered_pallets:pallets,
        units_per_pallet:upp,
        unit_price:price,
        line_total:mode === 'total' ? total : '',
        notes:line.querySelector('.lNotes')?.value || ''
      };
    });
  }

  function toIso(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new Error('Fecha y hora inválida');
    return d.toISOString();
  }

  async function saveOrderUx() {
    const button = byId('saveOrder');
    const msg = byId('orderMsg');
    try {
      button.disabled = true;
      msg.textContent = '';
      const edit = currentEditing();
      const clientId = byId('oClient')?.value || '';
      if (!clientId) throw new Error('Selecciona un cliente.');
      const body = {
        action:edit ? 'replace_plan' : 'create_plan',
        sales_order_id:edit?.id || null,
        client_id:clientId,
        importer_id:byId('oImporter')?.value || null,
        order_date:byId('oDate')?.value || null,
        requested_at:toIso(byId('oRequested')?.value),
        currency:byId('oCurrency')?.value || 'USD',
        customer_reference:byId('oReference')?.value || null,
        notes:byId('oNotes')?.value || null,
        lines:collectUxLines()
      };
      await uxApi('/api/sales-order-ux',{method:'POST',body:JSON.stringify(body)});
      try { closeModal('order'); } catch { byId('orderModal')?.classList.add('hidden'); }
      try { await load(); } catch { location.reload(); }
    } catch (error) {
      msg.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  function bind() {
    ensureClientPickerButton();
    ensureClientPickerModal();
    decorateAllLines();
    if (byId('saveOrder')) byId('saveOrder').onclick = saveOrderUx;
    if (byId('oCurrency')) byId('oCurrency').addEventListener('input',refreshOrderTotalPreview);

    const lines = byId('orderLines');
    if (lines) new MutationObserver(() => setTimeout(decorateAllLines,0)).observe(lines,{childList:true,subtree:false});
    const modal = byId('orderModal');
    if (modal) new MutationObserver(() => {
      if (!modal.classList.contains('hidden')) {
        setTimeout(() => {
          ensureClientPickerButton();
          syncClientButton();
          decorateAllLines();
          hydrateExactPricing();
        },0);
      }
    }).observe(modal,{attributes:true,attributeFilter:['class']});
  }

  bind();
})();
