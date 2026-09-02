(() => {
  const $ = id => document.getElementById(id);
  const state = { charges:[], targets:{}, products:[], models:{}, view:'charges', search:'', editingId:null, writeAccess:false };
  const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const num = value => Number(value || 0);
  const money = (value, currency='USD') => value == null ? '—' : `${currency || '—'} ${num(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const qty = value => num(value).toLocaleString(undefined,{maximumFractionDigits:4});
  const date = value => value ? new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString() : '—';
  const token = () => localStorage.getItem('export_mca_token') || '';

  const categories = [
    ['domestic_trucking','Transporte terrestre'],['ocean_freight','Flete marítimo'],['insurance','Seguro'],
    ['customs_duties','Aranceles / aduana'],['port_terminal','Puerto / terminal'],['warehouse','Almacén'],
    ['inspection','Inspección'],['brokerage','Gestión aduanal'],['nationalization','Nacionalización'],
    ['commission','Comisión'],['gifts','Obsequios'],['documentation','Documentación'],['bank_fee','Cargo bancario'],['other','Otro']
  ];
  const stages = [['inbound','Entrada'],['fulfillment','Preparación'],['destination','Destino'],['overhead','Gastos generales']];
  const bases = [['manual','Manual'],['quantity','Cantidad'],['pallets','Pallets'],['value','Valor'],['weight','Peso']];
  const targetTypes = [
    ['purchase_order_id','Orden de compra'],['warehouse_receipt_id','Recepción de almacén'],['load_id','Cargue'],['shipment_id','Contenedor'],['operation_id','Operación']
  ];
  const categoryLabel = value => categories.find(([id]) => id === value)?.[1] || value || '—';
  const stageLabel = value => stages.find(([id]) => id === value)?.[1] || value || '—';
  const basisLabel = value => bases.find(([id]) => id === value)?.[1] || value || '—';
  const coverageLabel = value => ({ actual:'Actual',partial_actual:'Parcial real',estimated:'Estimado',incomplete_allocation:'Incompleto' }[value] || value || 'Incompleto');
  const allocationLabel = value => ({ allocated:'Distribuido',partial:'Distribución parcial',unallocated:'Sin distribuir',void:'Anulado',invalid:'Revisión requerida' }[value] || 'Sin información');
  const statusLabel = value => ({ posted:'Contabilizado',void:'Anulado',draft:'Borrador' }[value] || 'Estado desconocido');
  const coveragePill = value => `<span class="pill ${value==='actual'?'ok':value==='estimated'||value==='partial_actual'?'warn':'bad'}">${esc(coverageLabel(value))}</span>`;
  const statusPill = value => value === 'posted' ? '<span class="pill ok">Contabilizado</span>' : value === 'void' ? '<span class="pill off">Anulado</span>' : '<span class="pill warn">Borrador</span>';
  const actionAllowed = (charge,action) => charge?.capabilities?.actions?.[action]?.allowed === true;
  const SAFE_COST_ERROR_PATTERNS = [
    /^No autorizado$/i,
    /^No tienes permiso /i,
    /^La solicitud no tiene un formato válido\.?$/i,
    /^Selecciona /i,
    /^Indica /i,
    /^Cada distribución /i,
    /^El monto /i,
    /^La moneda /i,
    /^La distribución /i,
    /^Cargo de costo no encontrado\.?$/i
  ];

  function safeCostMessage(error,fallback='No se pudo completar la operación. Intenta nuevamente.') {
    const value = String(error?.message || '').trim();
    if (error?.code && error.code !== 'COST_UNEXPECTED_ERROR') return value || fallback;
    if (SAFE_COST_ERROR_PATTERNS.some(pattern => pattern.test(value))) return value;
    return fallback;
  }
  function diagnose(marker,error) { console.error(`[${marker}]`,error); }

  async function request(url, options={}) {
    const response = await fetch(url, { ...options, headers:{ 'Content-Type':'application/json', ...(token() ? { Authorization:`Bearer ${token()}` } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'No se pudo procesar Costos');
      error.code = data.details?.code || null;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function refresh() {
    const data = await request('/api/costs');
    state.charges = Array.isArray(data.charges) ? data.charges : [];
    state.targets = data.targets || {};
    state.products = Array.isArray(data.products) ? data.products : [];
    state.models = data.cost_models || {};
    state.writeAccess = data.write_access === true;
    message('pageMsg','');
    render();
    parent?.dispatchEvent?.(new CustomEvent('export-mca:data-loaded'));
  }

  const supplierName = id => {
    const row = (state.targets.suppliers || []).find(item => String(item.id) === String(id));
    return row?.legal_name || row?.name || '—';
  };
  const productName = id => {
    const row = state.products.find(item => String(item.id) === String(id));
    if (!row) return 'Producto';
    return [row.sku, row.brand, row.name].filter(Boolean).join(' · ');
  };
  function targetConfig(key) {
    if (key === 'purchase_order_id') return { rows:state.targets.purchase_orders || [], label:row => row.po_number || row.id };
    if (key === 'warehouse_receipt_id') return { rows:state.targets.warehouse_receipts || [], label:row => row.receipt_number || row.id };
    if (key === 'load_id') return { rows:state.targets.loads || [], label:row => row.load_number || row.id };
    if (key === 'shipment_id') return { rows:state.targets.shipments || [], label:row => row.container_number || `Contenedor ${String(row.id).slice(0,8)}` };
    if (key === 'operation_id') return { rows:state.targets.operations || [], label:row => row.operation_code || row.container_number || row.id };
    return { rows:[], label:row => row?.id || '—' };
  }
  function allocationTarget(row) {
    const key = targetTypes.find(([id]) => row?.[id])?.[0];
    if (!key) return { key:null, label:'Sin objetivo' };
    const cfg = targetConfig(key);
    const target = cfg.rows.find(item => String(item.id) === String(row[key]));
    return { key, label:target ? cfg.label(target) : String(row[key]).slice(0,8) };
  }

  function renderMetrics() {
    const wr = state.models.warehouse_receipt_items || [];
    const loads = state.models.loads || [];
    const posted = state.charges.filter(row => row.status === 'posted').length;
    const drafts = state.charges.filter(row => row.status === 'draft').length;
    const incomplete = state.charges.filter(row => row.status === 'draft' && row.progress?.allocation_status !== 'allocated').length;
    const wrCosted = wr.filter(row => row.cost_coverage !== 'incomplete_allocation' && row.recognized_merchandise_cost != null).length;
    const loadCosted = loads.filter(row => row.cost_coverage !== 'incomplete_allocation' && row.recognized_merchandise_cogs != null).length;
    $('metrics').innerHTML = [
      ['Cargos activos',posted],['Borradores',drafts],['Pendientes de asignar',incomplete],['Recepciones con costo',wrCosted],['Cargues con costo reconocido',loadCosted]
    ].map(([label,value]) => `<div class="metric"><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join('');
  }

  function matches(textValue) {
    const q = state.search.toLowerCase();
    return !q || String(textValue || '').toLowerCase().includes(q);
  }

  function chargeMatches(charge) {
    const allocationText = (charge.allocations || []).map(row => allocationTarget(row).label).join(' ');
    return matches([charge.cost_number,charge.reference,categoryLabel(charge.category),stageLabel(charge.stage),supplierName(charge.supplier_id),charge.status,allocationText].join(' '));
  }

  function renderCharges() {
    const rows = state.charges.filter(chargeMatches);
    if (!rows.length) return '<div class="empty">No hay cargos de costo para esta búsqueda.</div>';
    return `<div class="cost-list">${rows.map(charge => {
      const p = charge.progress || {};
      const actions = [`<button class="btn" data-detail="${esc(charge.id)}">Ver</button>`];
      if (actionAllowed(charge,'edit')) actions.push(`<button class="btn" data-edit="${esc(charge.id)}">Editar</button>`);
      if (actionAllowed(charge,'post')) actions.push(`<button class="btn primary" data-post="${esc(charge.id)}">Contabilizar</button>`);
      if (actionAllowed(charge,'void')) actions.push(`<button class="btn danger" data-void="${esc(charge.id)}">Anular</button>`);
      const allocations = (charge.allocations || []).map(row => {
        const target = allocationTarget(row);
        return `<div class="cost-allocation"><div><b>${esc(targetTypes.find(([id])=>id===target.key)?.[1] || 'Objetivo')}</b></div><div>${esc(target.label)}<div class="small">${esc(basisLabel(row.basis))}${row.notes?` · ${esc(row.notes)}`:''}</div></div><div class="money-strong">${esc(money(row.amount,charge.currency))}</div><div>${esc(stageLabel(charge.stage))}</div></div>`;
      }).join('');
      return `<article class="cost-card"><div class="cost-card-head"><div><div class="cost-title">${esc(charge.cost_number)}</div><div class="cost-sub">${date(charge.incurred_date)}</div></div><div><b>${esc(categoryLabel(charge.category))}</b><div class="cost-sub">${esc(stageLabel(charge.stage))}${charge.supplier_id?` · ${esc(supplierName(charge.supplier_id))}`:''}</div></div><div>${statusPill(charge.status)}<div class="cost-sub">${esc(allocationLabel(p.allocation_status))}</div></div><div><div class="money-strong">${esc(money(charge.amount,charge.currency))}</div><div class="cost-sub">Asignado ${esc(money(p.allocated_amount,charge.currency))}</div></div><div><b>${esc(charge.reference || 'Sin referencia')}</b><div class="cost-sub">${esc(charge.notes || '')}</div></div><div class="actions">${actions.join('')}</div></div>${allocations?`<div class="cost-allocations">${allocations}</div>`:'<div class="cost-sub cost-empty-inline">Sin distribución.</div>'}</article>`;
    }).join('')}</div>`;
  }

  function wrSearchText(receiptId, items, charges) {
    const receipt = (state.targets.warehouse_receipts || []).find(row => String(row.id) === String(receiptId));
    return [receipt?.receipt_number, receipt?.status, ...items.map(row => productName(row.product_id)), ...charges.map(row => `${row.cost_number} ${row.category}`)].join(' ');
  }

  function renderLanded() {
    const wrItems = state.models.warehouse_receipt_items || [];
    const posted = state.models.posted_allocations || [];
    const grouped = new Map();
    for (const row of wrItems) {
      if (!grouped.has(row.receipt_id)) grouped.set(row.receipt_id, []);
      grouped.get(row.receipt_id).push(row);
    }
    const cards = [...grouped.entries()].filter(([receiptId,items]) => {
      const charges = posted.filter(row => String(row.warehouse_receipt_id) === String(receiptId));
      return matches(wrSearchText(receiptId,items,charges));
    }).map(([receiptId,items]) => {
      const receipt = (state.targets.warehouse_receipts || []).find(row => String(row.id) === String(receiptId));
      const charges = posted.filter(row => String(row.warehouse_receipt_id) === String(receiptId));
      const itemHtml = items.map(row => `<div class="model-card"><div class="model-head"><div><div class="model-title">${esc(productName(row.product_id))}</div><div class="small">Línea de recepción ${esc(String(row.receipt_item_id).slice(0,8))}</div></div>${coveragePill(row.cost_coverage)}</div><div class="model-grid"><div class="model-cell"><b>Cantidad física</b><span>${esc(qty(row.physical_quantity))} ${esc(row.unit)}</span></div><div class="model-cell"><b>Vinculada a la orden</b><span>${esc(qty(row.linked_quantity))}</span></div><div class="model-cell"><b>Cantidad con costo</b><span>${esc(qty(row.costed_quantity))}</span></div><div class="model-cell"><b>Costo de mercancía</b><span>${esc(money(row.recognized_merchandise_cost,row.currency))}</span></div><div class="model-cell"><b>Costo unitario</b><span>${esc(money(row.recognized_unit_cost,row.currency))}</span></div></div></div>`).join('');
      const chargeHtml = charges.length ? charges.map(row => `<div class="linked-cost"><span><b>${esc(row.cost_number)}</b> · ${esc(categoryLabel(row.category))} · ${esc(stageLabel(row.stage))}</span><span class="money-strong">${esc(money(row.allocated_amount,row.currency))}</span></div>`).join('') : '<div class="empty compact">No hay cargos contabilizados asignados directamente a esta recepción.</div>';
      return `<article class="model-card"><div class="model-head"><div><div class="model-title">${esc(receipt?.receipt_number || `Recepción ${String(receiptId).slice(0,8)}`)}</div><div class="small">Recibido ${date(receipt?.received_at)}</div></div></div><div class="section-note cost-section-note">El costo de mercancía proviene de las órdenes de compra, las facturas de proveedor y las cantidades recibidas. Los cargos directos se muestran por separado y no se reparten entre productos sin una regla financiera definida.</div><div class="model-list cost-model-inner">${itemHtml}</div><div class="linked-costs"><b>Cargos directos de la recepción</b>${chargeHtml}</div></article>`;
    });
    if (!cards.length) return '<div class="empty">No hay recepciones de almacén con información de costo para esta búsqueda.</div>';
    return `<div class="coverage-note">“Actual”, “Parcial real” y “Estimado” describen la cobertura del costo de mercancía. “Incompleto” evita presentar un costo parcial o multimoneda como definitivo.</div><div class="model-list">${cards.join('')}</div>`;
  }

  function renderCogs() {
    const loads = state.models.loads || [];
    const direct = state.models.load_direct || [];
    const cards = loads.filter(row => {
      const load = (state.targets.loads || []).find(item => String(item.id) === String(row.load_id));
      const costs = direct.filter(item => String(item.load_id) === String(row.load_id));
      return matches([row.load_number,load?.load_number,row.load_status,row.cost_coverage,row.operation_id,...costs.map(item=>item.currency)].join(' '));
    }).map(row => {
      const directRows = direct.filter(item => String(item.load_id) === String(row.load_id));
      const directHtml = directRows.length ? directRows.map(item => `<div class="linked-cost"><span>${esc(item.currency)} · ${esc(item.charge_count)} cargo(s)<div class="small">Entrada ${esc(money(item.inbound_amount,item.currency))} · Preparación ${esc(money(item.fulfillment_amount,item.currency))} · Destino ${esc(money(item.destination_amount,item.currency))} · Generales ${esc(money(item.overhead_amount,item.currency))}</div></span><span class="money-strong">${esc(money(item.direct_cost_amount,item.currency))}</span></div>`).join('') : '<div class="empty compact">Sin cargos contabilizados asignados directamente al Cargue.</div>';
      return `<article class="model-card"><div class="model-head"><div><div class="model-title">${esc(row.load_number || `Cargue ${String(row.load_id).slice(0,8)}`)}</div><div class="small">${row.shipment_id?`Contenedor ${esc(String(row.shipment_id).slice(0,8))}`:'Sin contenedor asignado'}</div></div>${coveragePill(row.cost_coverage)}</div><div class="model-grid"><div class="model-cell"><b>Productos</b><span>${esc(row.item_count)}</span></div><div class="model-cell"><b>Productos con costo</b><span>${esc(row.costed_item_count)}</span></div><div class="model-cell"><b>Monedas de origen</b><span>${esc(row.source_currency_count)}</span></div><div class="model-cell"><b>Costo reconocido</b><span>${esc(money(row.recognized_merchandise_cogs,row.currency))}</span></div><div class="model-cell"><b>Cobertura</b><span>${esc(coverageLabel(row.cost_coverage))}</span></div></div><div class="linked-costs"><b>Costos directos del Cargue</b>${directHtml}</div></article>`;
    });
    if (!cards.length) return '<div class="empty">No hay Cargues con información de costo para esta búsqueda.</div>';
    return `<div class="section-note">El costo reconocido de mercancía y los cargos directos se muestran separados. No se suman si pertenecen a monedas diferentes.</div><div class="model-list">${cards.join('')}</div>`;
  }

  function render() {
    renderMetrics();
    $('newCharge').classList.toggle('hidden',state.writeAccess !== true);
    document.querySelectorAll('[data-view]').forEach(btn => btn.classList.toggle('active',btn.dataset.view === state.view));
    $('content').innerHTML = state.view === 'landed' ? renderLanded() : state.view === 'cogs' ? renderCogs() : renderCharges();
  }

  function setModal(id,open) { $(id)?.classList.toggle('hidden',!open); }
  function message(id,value,good=false) { const node=$(id); if (!node) return; node.textContent=value || ''; node.classList.toggle('ok',Boolean(good)); }
  let decisionResolve = null;
  function closeCostDecision(accepted=false) {
    $('costDecisionModal')?.classList.add('hidden');
    const resolve = decisionResolve;
    decisionResolve = null;
    resolve?.(Boolean(accepted));
  }
  function costDecision({title,copy,accept='Continuar',danger=false}) {
    if (decisionResolve) closeCostDecision(false);
    $('costDecisionTitle').textContent = title;
    $('costDecisionCopy').textContent = copy;
    $('costDecisionAccept').textContent = accept;
    $('costDecisionAccept').classList.toggle('danger',danger);
    return new Promise(resolve => {
      decisionResolve = resolve;
      $('costDecisionModal').classList.remove('hidden');
      setTimeout(() => $('costDecisionCancel')?.focus(),0);
    });
  }
  function fillSelects() {
    $('cCategory').innerHTML = categories.map(([id,label]) => `<option value="${id}">${esc(label)}</option>`).join('');
    $('cStage').innerHTML = stages.map(([id,label]) => `<option value="${id}">${esc(label)}</option>`).join('');
    $('cSupplier').innerHTML = '<option value="">Sin proveedor</option>' + (state.targets.suppliers || []).map(row => `<option value="${esc(row.id)}">${esc(row.legal_name || row.name || row.id)}</option>`).join('');
  }

  function detectTarget(row) { return targetTypes.find(([key]) => row?.[key])?.[0] || 'purchase_order_id'; }
  function targetOptions(type, selected='') {
    const cfg = targetConfig(type);
    return '<option value="">Selecciona objetivo</option>' + cfg.rows.map(row => `<option value="${esc(row.id)}" ${String(row.id)===String(selected)?'selected':''}>${esc(cfg.label(row))}</option>`).join('');
  }
  function allocationLine(row={}) {
    const type = detectTarget(row);
    const selected = row[type] || '';
    return `<div class="allocation-line" data-allocation-line><div><label>Tipo</label><select data-target-type>${targetTypes.map(([id,label]) => `<option value="${id}" ${id===type?'selected':''}>${esc(label)}</option>`).join('')}</select></div><div><label>Objetivo</label><select data-target-id>${targetOptions(type,selected)}</select></div><div><label>Monto</label><input data-amount type="number" min="0" step="0.01" value="${esc(row.amount ?? '')}"></div><div><label>Base</label><select data-basis>${bases.map(([id,label]) => `<option value="${id}" ${id===(row.basis||'manual')?'selected':''}>${esc(label)}</option>`).join('')}</select></div><div><label>Nota</label><input data-note value="${esc(row.notes || '')}"></div><div class="actions"><button class="btn danger" type="button" data-remove-allocation>Quitar</button></div></div>`;
  }
  function addAllocation(row={}) { $('allocationEditor').insertAdjacentHTML('beforeend',allocationLine(row)); }

  function resetChargeForm(charge=null) {
    fillSelects();
    state.editingId = charge?.id || null;
    $('chargeTitle').textContent = charge ? `Editar ${charge.cost_number}` : 'Nuevo cargo de costo';
    $('cCategory').value = charge?.category || 'domestic_trucking';
    $('cStage').value = charge?.stage || 'inbound';
    $('cDate').value = String(charge?.incurred_date || new Date().toISOString().slice(0,10)).slice(0,10);
    $('cAmount').value = charge?.amount ?? '';
    $('cCurrency').value = charge?.currency || 'USD';
    $('cSupplier').value = charge?.supplier_id || '';
    $('cReference').value = charge?.reference || '';
    $('cNotes').value = charge?.notes || '';
    $('allocationEditor').innerHTML = '';
    for (const row of charge?.allocations || []) addAllocation(row);
    if (!(charge?.allocations || []).length) addAllocation();
    message('chargeMsg','');
  }
  function openCreate() { if (state.writeAccess !== true) return; resetChargeForm(); setModal('chargeModal',true); }
  function openEdit(id) {
    const charge = state.charges.find(row => String(row.id) === String(id));
    if (!charge || !actionAllowed(charge,'edit')) return;
    resetChargeForm(charge); setModal('chargeModal',true);
  }
  function collectAllocations() {
    return [...document.querySelectorAll('[data-allocation-line]')].map(node => {
      const type = node.querySelector('[data-target-type]')?.value;
      const target = node.querySelector('[data-target-id]')?.value;
      return { amount:node.querySelector('[data-amount]')?.value || '', basis:node.querySelector('[data-basis]')?.value || 'manual', [type]:target || null, notes:node.querySelector('[data-note]')?.value || null };
    }).filter(row => num(row.amount) > 0 || targetTypes.some(([key]) => row[key]));
  }

  async function saveCharge() {
    message('chargeMsg','');
    const amount = num($('cAmount').value);
    if (amount <= 0) return message('chargeMsg','El monto debe ser mayor que cero.');
    const allocations = collectAllocations();
    if (allocations.some(row => !targetTypes.some(([key]) => row[key]) || num(row.amount) <= 0)) return message('chargeMsg','Cada distribución requiere objetivo y monto mayor que cero.');
    $('saveCharge').disabled = true;
    try {
      await request('/api/costs',{ method:'POST', body:JSON.stringify({ action:state.editingId?'replace':'create', cost_charge_id:state.editingId, category:$('cCategory').value, stage:$('cStage').value, amount, currency:$('cCurrency').value, incurred_date:$('cDate').value || null, supplier_id:$('cSupplier').value || null, reference:$('cReference').value || null, notes:$('cNotes').value || null, allocations }) });
      setModal('chargeModal',false); await refresh();
      message('pageMsg',state.editingId ? 'Cargo actualizado correctamente.' : 'Cargo creado correctamente.',true);
    } catch(error) {
      diagnose('COST_CHARGE_SAVE_FAILED',error);
      message('chargeMsg',safeCostMessage(error,'No se pudo guardar el cargo. Revisa los datos e intenta nuevamente.'));
    }
    finally { $('saveCharge').disabled=false; }
  }

  function openDetail(id) {
    const charge = state.charges.find(row => String(row.id) === String(id)); if (!charge) return;
    const p = charge.progress || {};
    $('detailTitle').textContent = charge.cost_number;
    $('detailSubtitle').textContent = `${categoryLabel(charge.category)} · ${stageLabel(charge.stage)} · ${statusLabel(charge.status)}`;
    const allocations = (charge.allocations || []).map(row => { const target=allocationTarget(row); return `<div class="detail-item"><b>${esc(target.label)}</b><div class="small">${esc(targetTypes.find(([key])=>key===target.key)?.[1] || '')} · ${esc(basisLabel(row.basis))}</div><div class="money-strong">${esc(money(row.amount,charge.currency))}</div></div>`; }).join('');
    $('detailBody').innerHTML = `<div class="summary"><div><b>Total</b>${esc(money(charge.amount,charge.currency))}</div><div><b>Asignado</b>${esc(money(p.allocated_amount,charge.currency))}</div><div><b>Sin asignar</b>${esc(money(p.unallocated_amount,charge.currency))}</div><div><b>Fecha</b>${date(charge.incurred_date)}</div></div><div class="small">Proveedor: ${esc(supplierName(charge.supplier_id))} · Ref: ${esc(charge.reference || '—')}</div><div class="detail-items">${allocations || '<div class="empty compact">Sin distribución.</div>'}</div>`;
    const actions=[];
    if (actionAllowed(charge,'edit')) actions.push(`<button class="btn" data-detail-edit="${esc(charge.id)}">Editar</button>`);
    if (actionAllowed(charge,'post')) actions.push(`<button class="btn primary" data-detail-post="${esc(charge.id)}">Contabilizar</button>`);
    if (actionAllowed(charge,'void')) actions.push(`<button class="btn danger" data-detail-void="${esc(charge.id)}">Anular</button>`);
    $('detailActions').innerHTML=actions.join(''); message('detailMsg',''); setModal('detailModal',true);
  }

  async function transition(id,action) {
    const charge=state.charges.find(row=>String(row.id)===String(id)); if (!charge) return;
    if (!actionAllowed(charge,action)) return;
    const posting = action === 'post';
    const accepted = await costDecision({
      title:posting ? `Contabilizar ${charge.cost_number}` : `Anular ${charge.cost_number}`,
      copy:posting
        ? 'El cargo quedará bloqueado para edición y comenzará a afectar los costos reconocidos.'
        : 'El cargo conservará su historial, pero dejará de afectar los costos reconocidos.',
      accept:posting ? 'Contabilizar' : 'Anular cargo',
      danger:!posting
    });
    if (!accepted) return;
    const detailOpen = !$('detailModal').classList.contains('hidden');
    message(detailOpen?'detailMsg':'pageMsg','');
    try {
      await request('/api/costs',{method:'POST',body:JSON.stringify({action,cost_charge_id:id})});
      setModal('detailModal',false);
      await refresh();
      message('pageMsg',posting ? 'Cargo contabilizado correctamente.' : 'Cargo anulado correctamente.',true);
    } catch(error) {
      diagnose('COST_CHARGE_TRANSITION_FAILED',error);
      message(detailOpen?'detailMsg':'pageMsg',safeCostMessage(error,'No se pudo actualizar el cargo. Intenta nuevamente.'));
    }
  }

  document.addEventListener('change', event => {
    const select = event.target.closest('[data-target-type]');
    if (select) {
      const line=select.closest('[data-allocation-line]');
      const target=line?.querySelector('[data-target-id]');
      if (target) target.innerHTML=targetOptions(select.value);
    }
  });
  document.addEventListener('click', event => {
    const close=event.target.closest('[data-close]'); if (close) return setModal(`${close.dataset.close}Modal`,false);
    const remove=event.target.closest('[data-remove-allocation]'); if (remove) return remove.closest('[data-allocation-line]')?.remove();
    const detail=event.target.closest('[data-detail]'); if (detail) return openDetail(detail.dataset.detail);
    const edit=event.target.closest('[data-edit]'); if (edit) return openEdit(edit.dataset.edit);
    const post=event.target.closest('[data-post]'); if (post) return transition(post.dataset.post,'post');
    const voidBtn=event.target.closest('[data-void]'); if (voidBtn) return transition(voidBtn.dataset.void,'void');
    const dEdit=event.target.closest('[data-detail-edit]'); if (dEdit) { setModal('detailModal',false); return openEdit(dEdit.dataset.detailEdit); }
    const dPost=event.target.closest('[data-detail-post]'); if (dPost) return transition(dPost.dataset.detailPost,'post');
    const dVoid=event.target.closest('[data-detail-void]'); if (dVoid) return transition(dVoid.dataset.detailVoid,'void');
    const view=event.target.closest('[data-view]'); if (view) { state.view=view.dataset.view; render(); }
  });
  $('newCharge').onclick=openCreate;
  $('addAllocation').onclick=()=>addAllocation();
  $('saveCharge').onclick=saveCharge;
  $('refresh').onclick=()=>refresh().catch(error=>{
    diagnose('COSTS_REFRESH_FAILED',error);
    message('pageMsg',safeCostMessage(error,'No se pudo actualizar Costos. Intenta nuevamente.'));
  });
  $('search').oninput=event=>{ state.search=event.target.value.trim(); render(); };
  $('costDecisionCancel').onclick=()=>closeCostDecision(false);
  $('costDecisionAccept').onclick=()=>closeCostDecision(true);
  $('costDecisionModal').addEventListener('click',event=>{ if(event.target===$('costDecisionModal'))closeCostDecision(false); });
  document.addEventListener('keydown',event=>{ if(event.key==='Escape'&&!$('costDecisionModal').classList.contains('hidden'))closeCostDecision(false); });

  refresh().catch(error => {
    diagnose('COSTS_INITIAL_LOAD_FAILED',error);
    $('content').innerHTML=`<div class="empty">${esc(safeCostMessage(error,'No se pudo cargar Costos. Intenta nuevamente.'))}</div>`;
  });
})();
