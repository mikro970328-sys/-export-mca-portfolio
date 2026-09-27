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
  const SAFE_ORDER_ERROR_PATTERNS = [
    /^(?:Selecciona|Indica|Agrega|Falta|No tienes|Esta Sales Order|Solo una Sales Order|El cliente|Cliente|Importador|La cantidad|Los pallets|El precio|El total|Fecha y hora)/i,
    /^No se pudo procesar Ventas$/i
  ];
  const safeOrderMessage = (error,fallback='No se pudo completar la operación. Intenta nuevamente.') => {
    const message = String(error?.message || '').trim();
    return message && SAFE_ORDER_ERROR_PATTERNS.some(pattern => pattern.test(message)) ? message : fallback;
  };
  const reportOrderError = (context,error,fallback) => {
    console.error('SALES_ORDER_UI_FAILED',{context,error});
    return safeOrderMessage(error,fallback);
  };

  let clientPage = 1;
  let clientHasMore = false;
  let clientQuery = '';
  let clientTimer = null;
  let quickProductLine = null;
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
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-labelledby','clientPickerTitle');
    modal.innerHTML = `<div class="dialog client-picker-dialog">
      <div class="dialog-head"><div><span class="sales-dialog-kicker">Directorio comercial</span><h2 id="clientPickerTitle">Seleccionar cliente</h2><div class="muted">Busca por nombre, empresa o NIT.</div></div><button type="button" class="btn sales-close-button" data-client-close aria-label="Cerrar selector de clientes">✕</button></div>
      <div class="client-picker-create"><button id="clientQuickAddToggle" type="button" class="btn orange" hidden>＋ Nuevo cliente</button></div>
      <form id="clientQuickAddForm" class="client-quick-form" hidden><div class="client-quick-grid"><div><label for="clientQuickName">Nombre completo *</label><input id="clientQuickName" required autocomplete="name"></div><div><label for="clientQuickCompany">Empresa o MIPYME</label><input id="clientQuickCompany" autocomplete="organization"></div><div><label for="clientQuickNIT">NIT</label><input id="clientQuickNIT" autocomplete="off"></div><div><label for="clientQuickPhone">WhatsApp *</label><input id="clientQuickPhone" type="tel" inputmode="tel" placeholder="+5351234567" required autocomplete="tel"></div><div><label for="clientQuickEmail">Correo</label><input id="clientQuickEmail" type="email" autocomplete="email"></div></div><div id="clientQuickAddMsg" class="msg" role="status" aria-live="polite"></div><div class="actions"><button id="clientQuickAddCancel" type="button" class="btn">Cancelar</button><button id="clientQuickAddSave" type="submit" class="btn orange">Guardar y seleccionar</button></div></form>
      <label class="sales-visually-hidden" for="clientPickerSearch">Buscar cliente o empresa</label><input id="clientPickerSearch" class="client-picker-search" type="search" autocomplete="off" placeholder="Buscar cliente o NIT">
      <div id="clientPickerList" class="client-picker-list"></div>
      <div class="client-picker-footer"><button id="clientPrev" type="button" class="btn">← Anterior</button><span id="clientPageLabel" class="muted">Página 1</span><button id="clientNext" type="button" class="btn">Siguiente →</button></div>
      <div id="clientPickerMsg" class="msg" role="status" aria-live="polite"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-client-close]').onclick = closeClientPicker;
    modal.addEventListener('click', event => { if (event.target === modal) closeClientPicker(); });
    byId('clientPrev').onclick = () => { if (clientPage > 1) { clientPage--; loadClientPage(); } };
    byId('clientNext').onclick = () => { if (clientHasMore) { clientPage++; loadClientPage(); } };
    const quickAdd = byId('clientQuickAddToggle');
    refreshClientAccess();
    quickAdd.onclick = showQuickClient;
    byId('clientQuickAddCancel').onclick = () => {
      byId('clientQuickAddForm').hidden = true;
      refreshClientAccess();
      quickAdd.focus();
    };
    byId('clientQuickAddForm').addEventListener('submit',saveQuickClient);
    byId('clientPickerSearch').addEventListener('input', event => {
      clearTimeout(clientTimer);
      clientTimer = setTimeout(() => {
        clientQuery = event.target.value.trim();
        clientPage = 1;
        loadClientPage();
      }, 220);
    });
  }

  function canCreateClient() {
    return typeof clientWriteAccess !== 'undefined' && clientWriteAccess === true;
  }

  function refreshClientAccess() {
    const allowed = canCreateClient();
    const pickerOpen = Boolean(byId('clientPickerModal') && !byId('clientPickerModal').classList.contains('hidden'));
    const quickFormOpen = Boolean(byId('clientQuickAddForm') && !byId('clientQuickAddForm').hidden);
    if (byId('clientQuickAddToggle')) byId('clientQuickAddToggle').hidden = !allowed || !pickerOpen || quickFormOpen;
  }

  function showQuickClient() {
    if (!canCreateClient()) return;
    byId('clientQuickAddForm').hidden = false;
    byId('clientQuickAddMsg').textContent = '';
    refreshClientAccess();
    byId('clientQuickName').focus();
  }

  function ensureClientPickerButton() {
    const select = byId('oClient');
    if (!select || byId('oClientPickerButton')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'oClientPickerButton';
    select.parentElement.querySelector('label')?.setAttribute('for', button.id);
    button.className = 'client-picker-button';
    button.setAttribute('aria-haspopup','dialog');
    button.setAttribute('aria-controls','clientPickerModal');
    button.setAttribute('aria-expanded','false');
    button.innerHTML = '<strong>Seleccionar cliente</strong><span>Buscar ›</span>';
    select.insertAdjacentElement('afterend', button);
    select.hidden = true;
    button.onclick = openClientPicker;
    refreshClientAccess();
    syncClientButton();
  }

  function syncClientButton() {
    const select = byId('oClient');
    const button = byId('oClientPickerButton');
    if (!select || !button) return;
    const edit = currentEditing();
    if (!select.value && edit?.client_id) {
      const label = `${edit?.client?.company || edit?.client?.mipyme_name || edit?.client?.name || 'Cliente seleccionado'}${edit?.client?.nit?` · NIT ${edit.client.nit}`:''}`;
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
    refreshClientAccess();
    clientPage = 1;
    clientQuery = '';
    byId('clientPickerSearch').value = '';
    byId('clientPickerMsg').textContent = '';
    byId('clientPickerModal').classList.remove('hidden');
    byId('oClientPickerButton')?.setAttribute('aria-expanded','true');
    refreshClientAccess();
    await loadClientPage();
    byId('clientPickerSearch')?.focus();
  }

  function closeClientPicker() {
    byId('clientPickerModal')?.classList.add('hidden');
    refreshClientAccess();
    const button=byId('oClientPickerButton');
    button?.setAttribute('aria-expanded','false');
    button?.focus();
  }

  async function saveQuickClient(event) {
    event.preventDefault();
    if (!canCreateClient()) return;
    const button=byId('clientQuickAddSave'),message=byId('clientQuickAddMsg');
    if(!button||button.disabled)return;
    button.disabled=true;message.textContent='Guardando cliente…';
    try {
      const result=await uxApi('/api/clients',{method:'POST',body:JSON.stringify({
        name:byId('clientQuickName').value,
        company:byId('clientQuickCompany').value,
        nit:byId('clientQuickNIT').value,
        phone:byId('clientQuickPhone').value,
        email:byId('clientQuickEmail').value,
        mipyme_name:''
      })});
      if(!result.client?.id)throw new Error('No se pudo guardar el cliente.');
      const client=result.client,select=byId('oClient');
      if (typeof clients !== 'undefined' && !clients.some(row=>row.id===client.id)) clients.push(client);
      if(select){
        let option=[...select.options].find(item=>String(item.value)===String(client