(() => {
  'use strict';

  if (window.__accessControlAdministrationInstalled) return;
  window.__accessControlAdministrationInstalled = true;

  const state = {
    account:null,
    permissions:new Set(),
    usersData:null,
    roles:[],
    permissionCatalog:[],
    teams:[],
    teamUsers:[],
    activeTab:null,
    search:'',
    statusView:'all',
    loaded:{ users:false, roles:false, teams:false },
    lastFocused:null
  };

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const token = () => localStorage.getItem('export_mca_token') || '';
  const MANAGEMENT_KEYS = ['administration.users.manage','administration.roles.manage','administration.teams.manage'];
  const PERMISSION_MODULE_LABELS = Object.freeze({
    dashboard:'Inicio',
    clients:'Clientes',
    sales:'Ventas',
    procurement:'Compras',
    warehouse:'Almacén e inventario',
    logistics:'Logística y Tracking',
    documents:'Documentos',
    finance:'Finanzas',
    reports:'Reportes',
    notifications:'Notificaciones',
    publications:'Publicaciones',
    'administration.workers':'Trabajadores',
    'administration.users':'Usuarios',
    'administration.roles':'Roles y permisos',
    'administration.teams':'Equipos',
    'administration.audit':'Auditoría'
  });
  const ROLE_TEMPLATES = Object.freeze([
    Object.freeze({
      key:'sales',
      label:'Ventas',
      description:'Clientes, ventas, publicaciones y consulta de Tracking.',
      roleName:'Ventas',
      roleDescription:'Gestiona clientes, ventas y publicaciones; consulta logística, documentos y notificaciones.',
      permissionKeys:Object.freeze(['dashboard.read','clients.read','clients.write','sales.read','sales.write','logistics.read','documents.read','notifications.read','publications.read','publications.write'])
    }),
    Object.freeze({
      key:'procurement',
      label:'Compras',
      description:'Proveedores, compras y consulta de almacén y Tracking.',
      roleName:'Compras',
      roleDescription:'Gestiona proveedores y compras; consulta almacén, logística, documentos y notificaciones.',
      permissionKeys:Object.freeze(['dashboard.read','procurement.read','procurement.write','warehouse.read','logistics.read','documents.read','notifications.read'])
    }),
    Object.freeze({
      key:'logistics',
      label:'Logística / Tracking',
      description:'Almacén, cargues, contenedores, Tracking y documentos.',
      roleName:'Logística',
      roleDescription:'Gestiona almacén, cargues, contenedores, Tracking y documentos; consulta compras y ventas vinculadas.',
      permissionKeys:Object.freeze(['dashboard.read','sales.read','procurement.read','warehouse.read','warehouse.write','logistics.read','logistics.write','documents.read','documents.write','notifications.read','notifications.manage'])
    }),
    Object.freeze({
      key:'finance',
      label:'Finanzas',
      description:'Facturas, cobros, pagos, costos y reportes.',
      roleName:'Finanzas',
      roleDescription:'Gestiona facturación, cobros, pagos y costos; consulta clientes, ventas, compras, documentos y reportes.',
      permissionKeys:Object.freeze(['dashboard.read','clients.read','sales.read','procurement.read','documents.read','finance.read','finance.write','reports.read','notifications.read'])
    }),
    Object.freeze({
      key:'readonly',
      label:'Supervisor · solo lectura',
      description:'Puede revisar toda la operación sin cambiar información.',
      roleName:'Supervisor de consulta',
      roleDescription:'Consulta la operación completa sin permisos para crear, editar, cancelar ni registrar movimientos.',
      permissionKeys:Object.freeze(['dashboard.read','clients.read','sales.read','procurement.read','warehouse.read','logistics.read','documents.read','finance.read','reports.read','notifications.read','publications.read','administration.workers.read','administration.audit.read'])
    }),
    Object.freeze({
      key:'custom',
      label:'Personalizado',
      description:'Empieza sin permisos y selecciona exactamente lo necesario.',
      roleName:'',
      roleDescription:'',
      permissionKeys:Object.freeze([])
    })
  ]);
  const SECTION_PERMISSIONS = {
    dashboardSection:'dashboard.read',
    notificationsSection:'notifications.read',
    clientsSection:'clients.read',
    salesSection:'sales.read',
    invoicesSection:'finance.read',
    publicationsSection:'publications.read',
    purchasesSection:'procurement.read',
    warehouseSection:'warehouse.read',
    inventorySection:'warehouse.read',
    loadsSection:'logistics.read',
    containersSection:'logistics.read',
    registerContainerSection:'logistics.write',
    payablesSection:'finance.read',
    costsSection:'finance.read',
    suppliersSection:'procurement.read',
    productsSection:'warehouse.read',
    workersSection:'administration.workers.read'
  };
  const SAFE_ACCESS_ERRORS = new Set([
    'La cuenta no está disponible',
    'El nombre completo es obligatorio',
    'Selecciona un rol de acceso',
    'Administrador inválido',
    'No hay cambios para guardar',
    'El usuario debe tener entre 4 y 32 caracteres y solo usar letras, números, punto, guion o guion bajo',
    'La contraseña debe tener al menos 10 caracteres',
    'El rol seleccionado no está disponible',
    'Ese nombre de usuario ya existe',
    'Uno de los equipos seleccionados no está disponible',
    'Debe existir al menos una cuenta maestra activa',
    'Solo el administrador maestro puede modificar otra cuenta maestra',
    'No puedes desactivar tu propia cuenta',
    'El nombre del rol es obligatorio',
    'Rol inválido',
    'Ya existe un rol con ese nombre',
    'Uno de los permisos seleccionados no es válido',
    'Nombre de rol inválido',
    'El rol de sistema no admite ese cambio',
    'El nombre del equipo es obligatorio',
    'Equipo inválido',
    'Ya existe un equipo con ese nombre',
    'El equipo está inactivo',
    'Nombre de equipo inválido',
    'Uno de los usuarios seleccionados no está disponible',
    'No tienes permiso para realizar esta acción'
  ]);

  async function request(path, options = {}) {
    if (typeof window.api === 'function') return window.api(path, options);
    const response = await fetch(path, {
      ...options,
      headers:{
        'Content-Type':'application/json',
        ...(token() ? { Authorization:`Bearer ${token()}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'No se pudo completar la operación');
      error.code = data.details?.code || data.code || data.reason_code || null;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function safeAccessMessage(error, fallback = 'No se pudo completar la operación. Intenta nuevamente.', context = 'operation') {
    const message = String(error?.message || '').trim();
    if (error?.status === 401) return 'Tu sesión terminó. Inicia sesión nuevamente para continuar.';
    if (SAFE_ACCESS_ERRORS.has(message)) return message;
    if (error?.status === 403) return 'No tienes permiso para completar esta acción.';
    console.error('ACCESS_CONTROL_UI_FAILED', { context, status:error?.status || null, code:error?.code || null, error });
    return fallback;
  }

  function can(permission) {
    if (!permission) return true;
    return state.account?.role === 'master_admin' || state.permissions.has(permission);
  }

  function canAny(keys) {
    return state.account?.role === 'master_admin' || (keys || []).some(can);
  }

  function sectionAllowed(sectionId) {
    if (sectionId === 'accountSection') return true;
    if (sectionId === 'adminsSection') return canAny(MANAGEMENT_KEYS);
    const required = SECTION_PERMISSIONS[sectionId];
    return required ? can(required) : true;
  }

  function firstAllowedSection() {
    const order = ['dashboardSection','salesSection','containersSection','clientsSection','purchasesSection','warehouseSection','inventorySection','invoicesSection','payablesSection','costsSection','publicationsSection','workersSection','adminsSection','accountSection'];
    return order.find(id => byId(id) && sectionAllowed(id)) || 'accountSection';
  }

  function setMessage(message, ok = true) {
    const node = byId('accessWorkspaceMessage');
    if (!node) return;
    node.textContent = message || '';
    node.className = `access-message ${message ? (ok ? 'ok' : 'bad') : ''}`;
  }

  function activeRoleLabel(account) {
    if (account?.role === 'master_admin') return 'Administrador maestro';
    return account?.access_role?.name || 'Usuario';
  }

  function normalizeSearch(value) {
    return String(value || '').trim().toLocaleLowerCase('es');
  }

  function matchesSearch(values) {
    const query = normalizeSearch(state.search);
    return !query || values.some(value => normalizeSearch(value).includes(query));
  }

  function matchesStatus(record) {
    if (state.statusView === 'all') return true;
    return state.statusView === 'active' ? record?.is_active !== false : record?.is_active === false;
  }

  function currentRecords(tab = state.activeTab) {
    if (tab === 'users') return state.usersData?.admins || [];
    if (tab === 'roles') return state.roles || [];
    if (tab === 'teams') return state.teams || [];
    return [];
  }

  function visibleRecords(tab = state.activeTab) {
    return currentRecords(tab).filter(record => {
      if (!matchesStatus(record)) return false;
      if (tab === 'users') {
        const role = record.role === 'master_admin' ? 'Administrador maestro' : record.access_roles?.name || 'Sin rol';
        return matchesSearch([record.full_name, record.username, role, ...(record.teams || []).map(team => team.name)]);
      }
      if (tab === 'roles') return matchesSearch([record.name, record.description, ...(record.permission_keys || [])]);
      if (tab === 'teams') {
        const memberNames = (record.member_ids || []).map(id => {
          const member = state.teamUsers.find(user => String(user.id) === String(id));
          return member ? `${member.full_name} ${member.username}` : '';
        });
        return matchesSearch([record.name, record.description, ...memberNames]);
      }
      return false;
    });
  }

  function metricValue(records, loaded, predicate = () => true) {
    return loaded ? String((records || []).filter(predicate).length) : '—';
  }

  function renderMetrics() {
    const users = state.usersData?.admins || (state.loaded.teams ? state.teamUsers : []);
    const roles = state.loaded.roles ? state.roles : state.usersData?.roles || [];
    const teams = state.loaded.teams ? state.teams : state.usersData?.teams || [];
    const usersLoaded = state.loaded.users || state.loaded.teams;
    const rolesLoaded = state.loaded.roles || state.loaded.users;
    const teamsLoaded = state.loaded.teams || state.loaded.users;
    const values = {
      accessUsersMetric:metricValue(users, usersLoaded),
      accessActiveMetric:metricValue(users, usersLoaded, user => user.is_active !== false),
      accessRolesMetric:metricValue(roles, rolesLoaded, role => role.is_active !== false),
      accessTeamsMetric:metricValue(teams, teamsLoaded, team => team.is_active !== false)
    };
    Object.entries(values).forEach(([id,value]) => {
      const node = byId(id);
      if (node) node.textContent = value;
    });
  }

  function syncStoredAccount() {
    if (!state.account) return;
    try {
      const current = JSON.parse(localStorage.getItem('export_mca_user') || '{}');
      const next = {
        ...current,
        id:state.account.id,
        username:state.account.username,
        full_name:state.account.full_name,
        role:state.account.role,
        access_role_id:state.account.access_role_id || null,
        access_role:state.account.access_role || null,
        permissions:[...state.permissions],
        teams:state.account.teams || []
      };
      localStorage.setItem('export_mca_user', JSON.stringify(next));
      try { if (typeof currentUser !== 'undefined') currentUser = next; } catch {}
      const roleNode = byId('currentRole');
      if (roleNode) roleNode.textContent = activeRoleLabel(state.account);
    } catch {}
  }

  async function refreshAccount() {
    const result = await request('/api/account');
    state.account = result.account || null;
    state.permissions = new Set(state.account?.permissions || []);
    syncStoredAccount();
    return state.account;
  }

  function applyNavigation() {
    document.querySelectorAll('[data-section]').forEach(button => {
      const id = button.dataset.section;
      if (!id) return;
      button.classList.toggle('hidden', !sectionAllowed(id));
    });

    const adminButton = document.querySelector('[data-section="adminsSection"]');
    if (adminButton) {
      adminButton.classList.toggle('hidden', !canAny(MANAGEMENT_KEYS));
      adminButton.dataset.navLabel = 'Usuarios y acceso';
      adminButton.setAttribute('aria-label','Usuarios y acceso');
      adminButton.title = 'Usuarios y acceso';
      const label = adminButton.querySelector('.nav-label');
      if (label) label.textContent = 'Usuarios y acceso';
    }

    document.querySelectorAll('.nav-group').forEach(group => {
      const visible = [...group.querySelectorAll('.submenu [data-section]')].some(button => !button.classList.contains('hidden'));
      group.classList.toggle('hidden', !visible);
    });

    const legacyAdmin = byId('adminNav');
    if (legacyAdmin) legacyAdmin.classList.toggle('hidden', !canAny(MANAGEMENT_KEYS));

    const saved = localStorage.getItem('export_mca_current_section');
    if (saved && !sectionAllowed(saved)) localStorage.setItem('export_mca_current_section', firstAllowedSection());
  }

  function wrapSectionGuard() {
    if (window.__accessControlSectionGuardInstalled) return;
    const original = window.showSection;
    if (typeof original !== 'function') return;
    window.__accessControlSectionGuardInstalled = true;
    window.showSection = id => original(sectionAllowed(id) ? id : firstAllowedSection());
  }

  function workspaceMarkup() {
    const tabs = [];
    if (can('administration.users.manage')) tabs.push(['users','Usuarios']);
    if (can('administration.roles.manage')) tabs.push(['roles','Roles y permisos']);
    if (can('administration.teams.manage')) tabs.push(['teams','Equipos']);
    return `
      <div class="access-shell native-workspace-shell">
        <header class="access-header native-workspace-hero">
          <div class="native-workspace-heading"><span class="native-workspace-kicker">Gobierno y seguridad</span><h2>Usuarios y acceso</h2><p>Controla quién entra al ERP, qué puede hacer y cómo se organiza. Cada permiso se valida también en el backend.</p><div class="access-hero-state"><span class="access-state-dot" aria-hidden="true"></span><span>Control de acceso activo</span><span id="accessLastUpdated">Preparando directorio…</span></div></div>
          <div class="access-summary native-workspace-summary" aria-label="Resumen de acceso">
            <div class="access-summary-card native-workspace-summary-card"><strong id="accessUsersMetric">—</strong><span>Usuarios</span></div>
            <div class="access-summary-card native-workspace-summary-card"><strong id="accessActiveMetric">—</strong><span>Activos</span></div>
            <div class="access-summary-card native-workspace-summary-card"><strong id="accessRolesMetric">—</strong><span>Roles activos</span></div>
            <div class="access-summary-card native-workspace-summary-card"><strong id="accessTeamsMetric">—</strong><span>Equipos activos</span></div>
          </div>
        </header>
        <section class="access-command" aria-label="Controles del directorio">
          <div class="access-tabs" role="tablist" aria-label="Áreas de acceso">${tabs.map(([key,label],index)=>`<button type="button" role="tab" class="access-tab ${index===0?'active':''}" data-access-tab="${key}" aria-selected="${index===0?'true':'false'}" aria-controls="accessWorkspaceBody">${esc(label)}</button>`).join('')}</div>
          <button id="accessCreateButton" type="button" class="access-primary access-create" data-access-action="create-user">Nuevo usuario</button>
        </section>
        <div id="accessWorkspaceMessage" class="access-message" aria-live="polite"></div>
        <div id="accessWorkspaceBody" class="access-workspace-body" role="tabpanel" aria-live="polite"></div>
      </div>
      <div id="accessModal" class="access-modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="accessModalTitle">
        <div class="access-dialog" tabindex="-1">
          <div class="access-dialog-head"><div><span class="access-dialog-kicker">Usuarios y acceso</span><h3 id="accessModalTitle"></h3></div><button type="button" class="access-icon-button" data-access-close aria-label="Cerrar diálogo">Cerrar</button></div>
          <div id="accessModalBody" class="access-dialog-body"></div>
          <div id="accessModalMessage" class="access-message access-modal-message" aria-live="polite"></div>
          <div id="accessModalFoot" class="access-dialog-foot"></div>
        </div>
      </div>`;
  }

  function prepareWorkspace() {
    const section = byId('adminsSection');
    if (!section || !canAny(MANAGEMENT_KEYS)) return;
    section.dataset.accessOwner = 'access-control-administration.js';
    section.innerHTML = workspaceMarkup();
    const title = window.titles;
    if (title && typeof title === 'object') title.adminsSection = 'Usuarios y acceso';
    state.activeTab = can('administration.users.manage') ? 'users' : can('administration.roles.manage') ? 'roles' : 'teams';
    section.querySelectorAll('[data-access-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.accessTab === state.activeTab);
      button.addEventListener('click', () => switchTab(button.dataset.accessTab));
    });
    section.addEventListener('click', handleWorkspaceClick);
    section.addEventListener('input', handleWorkspaceInput);
    document.addEventListener('keydown', handleModalKeydown);
    renderMetrics();
  }

  function closeModal() {
    const modal = byId('accessModal');
    modal?.classList.add('hidden');
    modal?.setAttribute('aria-hidden','true');
    if (byId('accessModalBody')) byId('accessModalBody').innerHTML = '';
    if (byId('accessModalFoot')) byId('accessModalFoot').innerHTML = '';
    if (state.lastFocused?.isConnected) state.lastFocused.focus();
    state.lastFocused = null;
  }

  function setModalMessage(message = '') {
    const node = byId('accessModalMessage');
    if (!node) return;
    node.textContent = message;
    node.className = `access-message access-modal-message ${message ? 'bad' : ''}`;
  }

  function openModal(title, bodyHtml, actions = []) {
    const modal = byId('accessModal');
    if (!modal) return;
    state.lastFocused = document.activeElement;
    byId('accessModalTitle').textContent = title;
    byId('accessModalBody').innerHTML = bodyHtml;
    setModalMessage('');
    const foot = byId('accessModalFoot');
    foot.innerHTML = '';
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.className = action.className || 'access-primary';
      button.addEventListener('click', async event => {
        if (button.dataset.accessBusy === '1') return;
        button.dataset.accessBusy = '1';
        button.disabled = true;
        try { await action.onClick(event); }
        catch(error) { setModalMessage(safeAccessMessage(error, 'No se pudo completar la acción. Intenta nuevamente.', 'modal_action')); }
        finally {
          if (button.isConnected) {
            button.disabled = false;
            delete button.dataset.accessBusy;
          }
        }
      });
      foot.appendChild(button);
    }
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden','false');
    const dialog = modal.querySelector('.access-dialog');
    const focusTarget = byId('accessModalBody')?.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') || modal.querySelector('button:not([disabled])');
    queueMicrotask(() => (focusTarget || dialog)?.focus());
  }

  function handleModalKeydown(event) {
    if (event.key === 'Escape' && !byId('accessModal')?.classList.contains('hidden')) closeModal();
  }

  function confirmAction(title, message, onConfirm, danger = false) {
    openModal(title, `<p>${esc(message)}</p>`, [
      { label:'Cancelar', className:'access-secondary', onClick:closeModal },
      { label:'Confirmar', className:danger?'access-danger':'access-primary', onClick:async()=>{ await onConfirm(); closeModal(); } }
    ]);
  }

  function roleOptions(selected = '') {
    return (state.usersData?.roles || []).filter(role => role.is_active !== false).map(role => `<option value="${esc(role.id)}" ${String(role.id)===String(selected)?'selected':''}>${esc(role.name)}</option>`).join('');
  }

  function roleSelectionMarkup(selected = '') {
    const role=(state.usersData?.roles||[]).find(item=>String(item.id)===String(selected));
    return `<div class="access-role-selection ${role?.is_system?'system':''}" data-access-role-summary role="note"><strong>${esc(role?.name||'Selecciona un rol')}</strong><span>${esc(role?.description||'El rol determina las pantallas y acciones disponibles para esta persona.')}</span></div>`;
  }

  function bindRoleSelection(formId) {
    const form=byId(formId),select=form?.querySelector('select[name="access_role_id"]'),summary=form?.querySelector('[data-access-role-summary]');
    if(!form||!select||!summary)return;
    const update=()=>{
      const role=(state.usersData?.roles||[]).find(item=>String(item.id)===String(select.value));
      summary.classList.toggle('system',Boolean(role?.is_system));
      summary.querySelector('strong').textContent=role?.name||'Selecciona un rol';
      summary.querySelector('span').textContent=role?.description||'El rol determina las pantallas y acciones disponibles para esta persona.';
    };
    select.addEventListener('change',update);
    update();
  }

  function teamChecks(selected = []) {
    const ids = new Set((selected || []).map(item => String(item.id || item)));
    const teams = (state.usersData?.teams || []).filter(team => team.is_active !== false);
    return teams.length ? `<div class="access-multiselect">${teams.map(team => `<label class="access-member"><input type="checkbox" name="team_ids" value="${esc(team.id)}" ${ids.has(String(team.id))?'checked':''}><span>${esc(team.name)}</span></label>`).join('')}</div>` : '<div class="access-empty">No hay equipos activos.</div>';
  }

  function selectedValues(root, name) {
    return [...root.querySelectorAll(`input[name="${name}"]:checked`)].map(input => input.value);
  }

  function formReady(form) {
    if (!form) return false;
    if (typeof form.checkValidity !== 'function' || form.checkValidity()) return true;
    form.reportValidity?.();
    return false;
  }

  function bindModalSubmit(formId) {
    byId(formId)?.addEventListener('submit', event => {
      event.preventDefault();
      byId('accessModalFoot')?.querySelector('.access-primary, .access-danger')?.click();
    });
  }

  function directoryToolbar(title, intro, noun) {
    return `<div class="access-panel-head"><div><span class="access-eyebrow">Directorio</span><h3>${esc(title)}</h3><p>${esc(intro)}</p></div><span id="accessResultCount" class="access-result-count">0 ${esc(noun)}</span></div><div class="access-toolbar"><label class="access-search"><span class="access-search-label">Buscar</span><input id="accessSearch" type="search" value="${esc(state.search)}" placeholder="Buscar por nombre o detalle" autocomplete="off"></label><div class="access-view-tabs" role="tablist" aria-label="Filtrar por estado"><button type="button" data-access-view="all" role="tab" aria-selected="${state.statusView==='all'}" class="${state.statusView==='all'?'active':''}">Todos</button><button type="button" data-access-view="active" role="tab" aria-selected="${state.statusView==='active'}" class="${state.statusView==='active'?'active':''}">Activos</button><button type="button" data-access-view="inactive" role="tab" aria-selected="${state.statusView==='inactive'}" class="${state.statusView==='inactive'?'active':''}">Desactivados</button></div></div><div id="accessDirectoryList" class="access-list"></div>`;
  }

  function updateResultCount(visible, total, singular, plural) {
    const node = byId('accessResultCount');
    if (!node) return;
    const label = visible === 1 ? singular : plural;
    node.textContent = visible === total ? `${visible} ${label}` : `${visible} de ${total} ${plural}`;
  }

  function initials(value) {
    return String(value || '?').trim().split(/\s+/).slice(0,2).map(part => part.charAt(0)).join('').toUpperCase() || '?';
  }

  function emptyDirectory(title, detail, filtered = false) {
    return `<div class="access-empty"><span class="access-empty-mark" aria-hidden="true">${filtered?'0':'—'}</span><strong>${esc(title)}</strong><span>${esc(detail)}</span></div>`;
  }

  function renderUsersDirectory() {
    const target = byId('accessDirectoryList');
    if (!target) return;
    const rows = visibleRecords('users');
    const total = currentRecords('users').length;
    updateResultCount(rows.length,total,'usuario','usuarios');
    target.innerHTML = rows.length ? rows.map(user => {
      const role = user.role === 'master_admin' ? 'Administrador maestro' : user.access_roles?.name || 'Sin rol';
      const teams = (user.teams || []).map(team => team.name);
      const editable = user.role !== 'master_admin' || state.account?.role === 'master_admin';
      const mayEditProfile = editable && user.role !== 'master_admin';
      const mayChangePassword = editable;
      return `<article class="access-card" data-status="${user.is_active?'active':'inactive'}"><div class="access-card-main"><span class="access-avatar" aria-hidden="true">${esc(initials(user.full_name))}</span><div class="access-card-copy"><div class="access-card-title-row"><h4>${esc(user.full_name)}</h4><span class="access-status ${user.is_active?'':'inactive'}">${user.is_active?'Activo':'Desactivado'}</span></div><p class="access-handle">@${esc(user.username)}</p><dl class="access-facts"><div><dt>Rol</dt><dd>${esc(role)}</dd></div><div><dt>Equipos</dt><dd>${esc(teams.join(', ') || 'Sin equipo')}</dd></div></dl></div></div><div class="access-row-actions">${mayEditProfile?`<button type="button" class="access-secondary" data-access-action="edit-user" data-id="${esc(user.id)}">Editar</button>`:''}${mayChangePassword?`<button type="button" class="access-secondary" data-access-action="password-user" data-id="${esc(user.id)}">Contraseña</button>`:''}${editable&&user.id!==state.account?.id?`<button type="button" class="${user.is_active?'access-danger':'access-secondary'}" data-access-action="toggle-user" data-id="${esc(user.id)}">${user.is_active?'Desactivar':'Activar'}</button>`:''}</div></article>`;
    }).join('') : emptyDirectory(
      total ? 'No hay coincidencias' : 'No hay usuarios registrados',
      total ? 'Cambia la búsqueda o el filtro de estado para ver otros resultados.' : 'Crea la primera cuenta para comenzar a delegar acceso.',
      total > 0
    );
  }

  function renderUsersPane() {
    byId('accessWorkspaceBody').innerHTML = `<section class="access-panel access-directory-panel" aria-labelledby="accessUsersTitle">${directoryToolbar('Usuarios','Rol, equipos y estado efectivo de cada cuenta.','usuarios')}</section>`;
    byId('accessWorkspaceBody').querySelector('h3')?.setAttribute('id','accessUsersTitle');
    renderUsersDirectory();
  }

  function openCreateUser() {
    openModal('Nuevo usuario', `<form id="accessCreateUserForm" class="access-form" autocomplete="off"><div class="access-form-grid"><div><label>Nombre completo</label><input name="full_name" autocomplete="name" required></div><div><label>Usuario</label><input name="username" autocomplete="username" required></div></div><div><label>Contraseña temporal</label><input name="password" type="password" minlength="10" autocomplete="new-password" required><small class="access-field-help">Mínimo 10 caracteres. La persona podrá cambiarla desde Mi cuenta.</small></div><div><label>Rol de acceso</label><select name="access_role_id" required><option value="">Seleccionar rol</option>${roleOptions()}</select>${roleSelectionMarkup()}</div><div><label>Equipos</label>${teamChecks()}</div></form>`, [
      { label:'Cancelar', className:'access-secondary', onClick:closeModal },
      { label:'Crear usuario', className:'access-primary', onClick:createUser }
    ]);
    bindModalSubmit('accessCreateUserForm');
    bindRoleSelection('accessCreateUserForm');
  }

  async function createUser() {
    const form = byId('accessCreateUserForm');
    if (!formReady(form)) return;
    const data = new FormData(form);
    try {
      await request('/api/admins',{ method:'POST', body:JSON.stringify({ full_name:data.get('full_name'), username:data.get('username'), password:data.get('password'), access_role_id:data.get('access_role_id'), team_ids:selectedValues(form,'team_ids') }) });
      closeModal();
      setMessage('Usuario creado correctamente.',true);
      await loadUsers();
      renderUsersPane();
    } catch(error) { setModalMessage(safeAccessMessage(error, 'No se pudo crear el usuario. Revisa los datos e intenta nuevamente.', 'create_user')); }
  }

  function openUserEditor(id) {
    const user = state.usersData?.admins?.find(row => String(row.id) === String(id));
    if (!user) return;
    if (user.role === 'master_admin') return setMessage('La cuenta maestra se administra desde Mi cuenta.',false);
    openModal('Editar usuario', `<form id="accessEditUserForm" class="access-form"><div><label>Nombre completo</label><input name="full_name" value="${esc(user.full_name)}" required></div><div><label>Usuario</label><input name="username" value="${esc(user.username)}" required></div><div><label>Rol de acceso</label><select name="access_role_id" required>${roleOptions(user.access_role_id)}</select>${roleSelectionMarkup(user.access_role_id)}</div><div><label>Equipos</label>${teamChecks(user.teams || [])}</div></form>`, [
      { label:'Cancelar', className:'access-secondary', onClick:closeModal },
      { label:'Guardar cambios', onClick:async()=>{ const form=byId('accessEditUserForm'); if(!formReady(form))return; const data=new FormData(form); await request('/api/admins',{method:'PATCH',body:JSON.stringify({id:user.id,full_name:data.get('full_name'),username:data.get('username'),access_role_id:data.get('access_role_id'),team_ids:selectedValues(form,'team_ids')})}); closeModal(); setMessage('Usuario actualizado.',true); await loadUsers(); renderUsersPane(); } }
    ]);
    bindModalSubmit('accessEditUserForm');
    bindRoleSelection('accessEditUserForm');
  }

  function openPasswordEditor(id) {
    const user = state.usersData?.admins?.find(row => String(row.id) === String(id));
    if (!user) return;
    openModal(`Contraseña · ${user.username}`, '<form id="accessPasswordForm" class="access-form"><div><label>Nueva contraseña</label><input name="password" type="password" minlength="10" required></div><div class="access-panel-intro">Mínimo 10 caracteres.</div></form>', [
      { label:'Cancelar', className:'access-secondary', onClick:closeModal },
      { label:'Actualizar', onClick:async()=>{ const form=byId('accessPasswordForm'); const password=new FormData(form).get('password'); if(String(password||'').length<10) throw new Error('La contraseña debe tener al menos 10 caracteres'); await request('/api/admins',{method:'PATCH',body:JSON.stringify({id:user.id,password})}); closeModal(); setMessage('Contraseña actualizada.',true); } }
    ]);
    bindModalSubmit('accessPasswordForm');
  }

  function permissionMatrix(selected = [], disabled = false) {
    const chosen = new Set(selected || []);
    const groups = new Map();
    for (const permission of state.permissionCatalog || []) {
      if (!groups.has(permission.module)) groups.set(permission.module, []);
      groups.get(permission.module).push(permission);
    }
    return `<div class="access-permission-groups">${[...groups.entries()].map(([module,items])=>`<div class="access-permission-group"><div class="access-permission-title">${esc(PERMISSION_MODULE_LABELS[module]||module)}</div><div class="access-permission-items">${items.map(item=>`<label class="access-check"><input type="checkbox" name="permission_keys" value="${esc(item.permission_key)}" ${chosen.has(item.permission_key)?'checked':''} ${disabled?'disabled':''}><span><strong>${esc(item.label || item.permission_key)}</strong><small>${esc(item.description || item.permission_key)}</small></span></label>`).join('')}</div></div>`).join('')}</div>`;
  }

  function roleTemplatePicker() {
    return `<div class="access-role-templates" aria-label="Plantillas recomendadas">${ROLE_TEMPLATES.map(template=>`<button type="button" class="access-role-template" data-role-template="${esc(template.key)}" aria-pressed="false"><strong>${esc(template.label)}</strong><span>${esc(template.description)}</span></button>`).join('')}</div>`;
  }

  function selectedPermissionKeys(form) {
    return selectedValues(form,'permission_keys').sort();
  }

  function samePermissionKeys(left,right) {
    const a=[...(left||[])].sort(),b=[...(right||[])].sort();
    return a.length===b.length&&a.every((key,index)=>key===b[index]);
  }

  function syncRoleComposer(form) {
    if(!form)return;
    const selected=selectedPermissionKeys(form);
    const summary=form.querySelector('[data-role-permission-summary]');
    if(summary){
      summary.textContent=selected.length
        ? `${selected.length} permisos seleccionados. Puedes ajustar cualquier opción antes de crear el rol.`
        : 'Sin permisos seleccionados. Este rol no podrá abrir módulos operativos hasta que elijas al menos uno.';
      summary.classList.toggle('empty',selected.length===0);
    }
    form.querySelectorAll('[data-role-template]').forEach(button=>{
      const template=ROLE_TEMPLATES.find(item=>item.key===button.dataset.roleTemplate);
      button.setAttribute('aria-pressed',String(Boolean(template&&samePermissionKeys(selected,template.permissionKeys))));
    });
  }

  function applyRoleTemplate(form,key) {
    const template=ROLE_TEMPLATES.find(item=>item.key===key);
    if(!form||!template)return;
    const chosen=new Set(template.permissionKeys);
    const name=form.elements.namedItem('name'),description=form.elements.namedItem('description');
    if(name)name.value=template.roleName;
    if(description)description.value=template.roleDescription;
    form.querySelectorAll('input[name="permission_keys"]').forEach(input=>{input.checked=chosen.has(input.value);});
    syncRoleComposer(form);
    name?.focus();
  }

  function bindRoleComposer() {
    const form=byId('accessCreateRoleForm');
    if(!form)return;
    form.querySelectorAll('[data-role-template]').forEach(button=>button.addEventListener('click',()=>applyRoleTemplate(form,button.dataset.roleTemplate)));
    form.addEventListener('change',event=>{if(event.target?.name==='permission_keys')syncRoleComposer(form);});
    syncRoleComposer(form);
  }

  function renderRolesDirectory() {
    const target = byId('accessDirectoryList');
    if (!target) return;
    const rows = visibleRecords('roles');
    const total = currentRecords('roles').length;
    updateResultCount(rows.length,total,'rol','roles');
    target.innerHTML = rows.length ? rows.map(role => {
      const permissionCount = role.permission_keys?.length || 0;
      return `<article class="access-card" data-status="${role.is_active?'active':'inactive'}"><div class="access-card-main"><span class="access-avatar access-avatar-role" aria-hidden="true">${esc(initials(role.name))}</span><div class="access-card-copy"><div class="access-card-title-row"><h4>${esc(role.name)}</h4><span class="access-status ${role.is_active?'':'inactive'}">${role.is_active?'Activo':'Desactivado'}</span></div><p class="access-card-description">${esc(role.description || 'Sin descripción')}</p><div class="access-role-summary"><span class="access-role-chip">${permissionCount} ${permissionCount===1?'permiso':'permisos'}</span>${role.is_system?'<span class="access-role-chip system">Sistema</span>':''}</div></div></div><div class="access-row-actions"><button type="button" class="access-secondary" data-access-action="edit-role" data-id="${esc(role.id)}">${role.is_system?'Ver permisos':'Editar'}</button>${!role.is_system?`<button type="button" class="${role.is_active?'access-danger':'access-secondary'}" data-access-action="toggle-role" data-id="${esc(role.id)}">${role.is_active?'Desactivar':'Activar'}</button>`:''}</div></article>`;
    }).join('') : emptyDirectory(
      total ? 'No hay coincidencias' : 'No hay roles configurados',
      total ? 'Cambia la búsqueda o el filtro para encontrar otro rol.' : 'Crea un rol para asignar permisos reutilizables.',
      total > 0
    );
  }

  function renderRolesPane() {
    byId('accessWorkspaceBody').innerHTML = `<section class="access-panel access-directory-panel" aria-labelledby="accessRolesTitle">${directoryToolbar('Roles y permisos','Conjuntos reutilizables que determinan las acciones disponibles dentro del ERP.','roles')}</section>`;
    byId('accessWorkspaceBody').querySelector('h3')?.setAttribute('id','accessRolesTitle');
    renderRolesDirectory();
  }

  function openCreateRole() {
    openModal('Nuevo rol', `<form id="accessCreateRoleForm" class="access-form"><div><label>Comenzar con una plantilla</label><p class="access-field-help">Elige la función de la persona. Después puedes agregar o quitar cualquier permiso.</p>${roleTemplatePicker()}</div><div><label>Nombre del rol</label><input name="name" required></div><div><label>Descripción</label><textarea name="description" rows="3"></textarea></div><div><label>Permisos</label><p class="access-field-help">Lectura permite consultar; gestión permite crear o cambiar información.</p><div class="access-role-permission-summary empty" data-role-permission-summary role="status"></div>${permissionMatrix()}</div></form>`, [
      { label:'Cancelar', className:'access-secondary', onClick:closeModal },
      { label:'Crear rol', className:'access-primary', onClick:createRole }
    ]);
    bindModalSubmit('accessCreateRoleForm');
    bindRoleComposer();
  }

  async function createRole() {
    const form=byId('accessCreateRoleForm');
    if (!formReady(form)) return;
    const data=new FormData(form);
    try {
      await request('/api/access-control?resource=roles',{method:'POST',body:JSON.stringify({name:data.get('name'),description:data.get('description'),permission_keys:selectedValues(form,'permission_keys')})});
      closeModal(); setMessage('Rol creado correctamente.',true); await loadRoles(); renderRolesPane();
    } catch(error) { setModalMessage(safeAccessMessage(error, 'No se pudo crear el rol. Revisa los datos e intenta nuevamente.', 'create_role')); }
  }

  function openRoleEditor(id) {
    const role=state.roles.find(row=>String(row.id)===String(id));
    if(!role)return;
    openModal(role.is_system?'Rol de sistema':'Editar rol', `<form id="accessEditRoleForm" class="access-form"><div><label>Nombre</label><input name="name" value="${esc(role.name)}" ${role.is_system?'disabled':''} required></div><div><label>Descripción</label><textarea name="description" rows="3" ${role.is_system?'disabled':''}>${esc(role.description||'')}</textarea></div><div><label>Permisos</label>${permissionMatrix(role.permission_keys||[],role.is_system)}</div></form>`, role.is_system ? [{label:'Cerrar',className:'access-secondary',onClick:closeModal}] : [
      {label:'Cancelar',className:'access-secondary',onClick:closeModal},
      {label:'Guardar cambios',onClick:async()=>{const form=byId('accessEditRoleForm');if(!formReady(form))return;const data=new FormData(form);await request('/api/access-control?resource=roles',{method:'PATCH',body:JSON.stringify({id:role.id,name:data.get('name'),description:data.get('description'),permission_keys:selectedValues(form,'permission_keys')})});closeModal();setMessage('Rol actualizado.',true);await loadRoles();renderRolesPane();}}
    ]);
    if(!role.is_system)bindModalSubmit('accessEditRoleForm');
  }

  function teamMemberChecks(selected = []) {
    const chosen=new Set((selected||[]).map(String));
    return state.teamUsers.length ? `<div class="access-multiselect">${state.teamUsers.filter(user=>user.is_active!==false).map(user=>`<label class="access-member"><input type="checkbox" name="member_ids" value="${esc(user.id)}" ${chosen.has(String(user.id))?'checked':''}><span>${esc(user.full_name)} · ${esc(user.username)}</span></label>`).join('')}</div>` : '<div class="access-empty">No hay usuarios disponibles.</div>';
  }

  function renderTeamsDirectory() {
    const target = byId('accessDirectoryList');
    if (!target) return;
    const rows = visibleRecords('teams');
    const total = currentRecords('teams').length;
    updateResultCount(rows.length,total,'equipo','equipos');
    target.innerHTML = rows.length ? rows.map(team => {
      const members = (team.member_ids || []).map(id => state.teamUsers.find(user => String(user.id) === String(id))).filter(Boolean);
      const memberLabel = members.length ? members.slice(0,3).map(member => member.full_name).join(', ') + (members.length > 3 ? ` y ${members.length-3} más` : '') : 'Sin miembros';
      return `<article class="access-card" data-status="${team.is_active?'active':'inactive'}"><div class="access-card-main"><span class="access-avatar access-avatar-team" aria-hidden="true">${esc(initials(team.name))}</span><div class="access-card-copy"><div class="access-card-title-row"><h4>${esc(team.name)}</h4><span class="access-status ${team.is_active?'':'inactive'}">${team.is_active?'Activo':'Desactivado'}</span></div><p class="access-card-description">${esc(team.description || 'Sin descripción')}</p><dl class="access-facts"><div><dt>Miembros</dt><dd>${esc(memberLabel)}</dd></div></dl></div></div><div class="access-row-actions"><button type="button" class="access-secondary" data-access-action="edit-team" data-id="${esc(team.id)}">Editar</button><button type="button" class="${team.is_active?'access-danger':'access-secondary'}" data-access-action="toggle-team" data-id="${esc(team.id)}">${team.is_active?'Desactivar':'Activar'}</button></div></article>`;
    }).join('') : emptyDirectory(
      total ? 'No hay coincidencias' : 'No hay equipos configurados',
      total ? 'Cambia la búsqueda o el filtro para encontrar otro equipo.' : 'Crea un equipo para organizar a las personas del ERP.',
      total > 0
    );
  }

  function renderTeamsPane() {
    byId('accessWorkspaceBody').innerHTML=`<section class="access-panel access-directory-panel" aria-labelledby="accessTeamsTitle">${directoryToolbar('Equipos','Agrupaciones organizativas; por sí solas no conceden permisos.','equipos')}</section>`;
    byId('accessWorkspaceBody').querySelector('h3')?.setAttribute('id','accessTeamsTitle');
    renderTeamsDirectory();
  }

  function openCreateTeam(){
    openModal('Nuevo equipo',`<form id="accessCreateTeamForm" class="access-form"><div><label>Nombre</label><input name="name" required></div><div><label>Descripción</label><textarea name="description" rows="3"></textarea></div><div><label>Miembros</label><p class="access-field-help">Los equipos organizan personas, pero no cambian permisos por sí solos.</p>${teamMemberChecks()}</div></form>`,[
      {label:'Cancelar',className:'access-secondary',onClick:closeModal},
      {label:'Crear equipo',className:'access-primary',onClick:createTeam}
    ]);
    bindModalSubmit('accessCreateTeamForm');
  }

  async function createTeam(){
    const form=byId('accessCreateTeamForm');
    if(!formReady(form))return;
    const data=new FormData(form);
    try{
      await request('/api/access-control?resource=teams',{method:'POST',body:JSON.stringify({name:data.get('name'),description:data.get('description'),member_ids:selectedValues(form,'member_ids')})});
      closeModal();setMessage('Equipo creado correctamente.',true);await loadTeams();renderTeamsPane();
    }catch(error){setModalMessage(safeAccessMessage(error,'No se pudo crear el equipo. Revisa los datos e intenta nuevamente.','create_team'));}
  }

  function openTeamEditor(id){
    const team=state.teams.find(row=>String(row.id)===String(id));
    if(!team)return;
    openModal('Editar equipo',`<form id="accessEditTeamForm" class="access-form"><div><label>Nombre</label><input name="name" value="${esc(team.name)}" required></div><div><label>Descripción</label><textarea name="description" rows="3">${esc(team.description||'')}</textarea></div><div><label>Miembros</label>${teamMemberChecks(team.member_ids||[])}</div></form>`,[
      {label:'Cancelar',className:'access-secondary',onClick:closeModal},
      {label:'Guardar cambios',onClick:async()=>{const form=byId('accessEditTeamForm');if(!formReady(form))return;const data=new FormData(form);await request('/api/access-control?resource=teams',{method:'PATCH',body:JSON.stringify({id:team.id,name:data.get('name'),description:data.get('description'),member_ids:selectedValues(form,'member_ids')})});closeModal();setMessage('Equipo actualizado.',true);await loadTeams();renderTeamsPane();}}
    ]);
    bindModalSubmit('accessEditTeamForm');
  }

  function renderActivePane() {
    if (state.activeTab === 'users') renderUsersPane();
    else if (state.activeTab === 'roles') renderRolesPane();
    else if (state.activeTab === 'teams') renderTeamsPane();
  }

  function renderActiveDirectory() {
    if (state.activeTab === 'users') renderUsersDirectory();
    else if (state.activeTab === 'roles') renderRolesDirectory();
    else if (state.activeTab === 'teams') renderTeamsDirectory();
  }

  function updateCommand() {
    const button = byId('accessCreateButton');
    if (!button) return;
    const settings = {
      users:['create-user','Nuevo usuario'],
      roles:['create-role','Nuevo rol'],
      teams:['create-team','Nuevo equipo']
    }[state.activeTab];
    if (!settings) {
      button.hidden = true;
      return;
    }
    button.hidden = false;
    button.dataset.accessAction = settings[0];
    button.textContent = settings[1];
  }

  function markUpdated() {
    const node = byId('accessLastUpdated');
    if (!node) return;
    node.textContent = `Actualizado ${new Date().toLocaleTimeString('es-US',{hour:'2-digit',minute:'2-digit'})}`;
  }

  function renderLoading() {
    const target = byId('accessWorkspaceBody');
    if (!target) return;
    target.innerHTML = '<div class="access-loading" role="status"><span class="access-spinner" aria-hidden="true"></span><span>Cargando directorio…</span></div>';
  }

  function renderLoadError() {
    const target = byId('accessWorkspaceBody');
    if (!target) return;
    target.innerHTML = '<div class="access-empty access-error" role="status"><span class="access-empty-mark" aria-hidden="true">!</span><strong>No pudimos cargar esta sección</strong><span>La información permanece sin cambios. Intenta nuevamente.</span><button type="button" class="access-secondary" data-access-action="retry">Reintentar</button></div>';
  }

  async function loadUsers(){state.usersData=await request('/api/admins');state.loaded.users=true;renderMetrics();}
  async function loadRoles(){const [roles,permissions]=await Promise.all([request('/api/access-control?resource=roles'),request('/api/access-control?resource=permissions')]);state.roles=roles.roles||[];state.permissionCatalog=permissions.permissions||[];state.loaded.roles=true;renderMetrics();}
  async function loadTeams(){const result=await request('/api/access-control?resource=teams');state.teams=result.teams||[];state.teamUsers=result.users||[];state.loaded.teams=true;renderMetrics();}

  async function switchTab(tab){
    if(tab==='users'&&!can('administration.users.manage'))return;
    if(tab==='roles'&&!can('administration.roles.manage'))return;
    if(tab==='teams'&&!can('administration.teams.manage'))return;
    state.activeTab=tab;
    state.search='';
    state.statusView='all';
    document.querySelectorAll('[data-access-tab]').forEach(button=>{
      const selected=button.dataset.accessTab===tab;
      button.classList.toggle('active',selected);
      button.setAttribute('aria-selected',String(selected));
    });
    updateCommand();
    renderLoading();
    setMessage('');
    try{
      if(tab==='users')await loadUsers();
      else if(tab==='roles')await loadRoles();
      else await loadTeams();
      renderActivePane();
      markUpdated();
    }catch(error){renderLoadError();setMessage(safeAccessMessage(error,'No se pudo cargar esta sección. Intenta nuevamente.','load_tab'),false);}
  }

  function handleWorkspaceInput(event){
    if(event.target?.id!=='accessSearch')return;
    state.search=event.target.value;
    renderActiveDirectory();
  }

  async function handleWorkspaceClick(event){
    const close=event.target.closest('[data-access-close]');if(close){closeModal();return;}
    if(event.target===byId('accessModal')){closeModal();return;}
    const view=event.target.closest('[data-access-view]');
    if(view){
      state.statusView=view.dataset.accessView;
      document.querySelectorAll('[data-access-view]').forEach(button=>{
        const selected=button.dataset.accessView===state.statusView;
        button.classList.toggle('active',selected);
        button.setAttribute('aria-selected',String(selected));
      });
      renderActiveDirectory();
      return;
    }
    const action=event.target.closest('[data-access-action]');if(!action)return;
    const id=action.dataset.id,type=action.dataset.accessAction;
    if(type==='create-user')return openCreateUser();
    if(type==='create-role')return openCreateRole();
    if(type==='create-team')return openCreateTeam();
    if(type==='retry')return switchTab(state.activeTab);
    if(type==='edit-user')return openUserEditor(id);
    if(type==='password-user')return openPasswordEditor(id);
    if(type==='toggle-user'){
      const user=state.usersData?.admins?.find(row=>String(row.id)===String(id));if(!user)return;
      return confirmAction(user.is_active?'Desactivar usuario':'Activar usuario',`${user.is_active?'Desactivar':'Activar'} la cuenta ${user.username}?`,async()=>{await request('/api/admins',{method:'PATCH',body:JSON.stringify({id:user.id,is_active:!user.is_active})});setMessage(`Usuario ${user.is_active?'desactivado':'activado'}.`,true);await loadUsers();renderUsersPane();},user.is_active);
    }
    if(type==='edit-role')return openRoleEditor(id);
    if(type==='toggle-role'){
      const role=state.roles.find(row=>String(row.id)===String(id));if(!role)return;
      return confirmAction(role.is_active?'Desactivar rol':'Activar rol',`${role.is_active?'Desactivar':'Activar'} el rol ${role.name}?`,async()=>{await request('/api/access-control?resource=roles',{method:'PATCH',body:JSON.stringify({id:role.id,is_active:!role.is_active})});setMessage(`Rol ${role.is_active?'desactivado':'activado'}.`,true);await loadRoles();renderRolesPane();},role.is_active);
    }
    if(type==='edit-team')return openTeamEditor(id);
    if(type==='toggle-team'){
      const team=state.teams.find(row=>String(row.id)===String(id));if(!team)return;
      return confirmAction(team.is_active?'Desactivar equipo':'Activar equipo',`${team.is_active?'Desactivar':'Activar'} el equipo ${team.name}?${team.is_active?' Sus membresías quedarán vacías.':''}`,async()=>{await request('/api/access-control?resource=teams',{method:'PATCH',body:JSON.stringify({id:team.id,is_active:!team.is_active})});setMessage(`Equipo ${team.is_active?'desactivado':'activado'}.`,true);await loadTeams();renderTeamsPane();},team.is_active);
    }
  }

  async function initialize() {
    await refreshAccount();
    wrapSectionGuard();
    prepareWorkspace();
    applyNavigation();
    if (canAny(MANAGEMENT_KEYS) && state.activeTab) await switchTab(state.activeTab);
    return state.account;
  }

  function afterNavigationMounted() {
    applyNavigation();
    wrapSectionGuard();
  }

  window.ExportMcaAccessControl = Object.freeze({
    initialize,
    refreshAccount:async()=>{await refreshAccount();applyNavigation();return state.account;},
    applyNavigation:afterNavigationMounted,
    can,
    canAny,
    sectionAllowed,
    firstAllowedSection,
    state,
    visibleRecords,
    renderActivePane,
    renderMetrics,
    roleTemplates:ROLE_TEMPLATES,
    owner:'access-control-administration.js'
  });
})();
