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
    activeTab:null
  };

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const token = () => localStorage.getItem('export_mca_token') || '';
  const MANAGEMENT_KEYS = ['administration.users.manage','administration.roles.manage','administration.teams.manage'];
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
          <div class="native-workspace-heading"><span class="native-workspace-kicker">Gobierno y seguridad</span><h2>Usuarios y acceso</h2><p>Administra quién entra al ERP, qué puede hacer y a qué equipos pertenece. Los permisos se aplican también en el backend.</p></div>
        </header>
        <div class="access-tabs">${tabs.map(([key,label],index)=>`<button type="button" class="access-tab ${index===0?'active':''}" data-access-tab="${key}">${esc(label)}</button>`).join('')}</div>
        <div id="accessWorkspaceMessage" class="access-message" aria-live="polite"></div>
        <div id="accessWorkspaceBody"></div>
      </div>
      <div id="accessModal" class="access-modal hidden" role="dialog" aria-modal="true" aria-labelledby="accessModalTitle">
        <div class="access-dialog">
          <div class="access-dialog-head"><h3 id="accessModalTitle"></h3><button type="button" class="access-secondary" data-access-close>Cerrar</button></div>
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
  }

  function closeModal() {
    byId('accessModal')?.classList.add('hidden');
    if (byId('accessModalBody')) byId('accessModalBody').innerHTML = '';
    if (byId('accessModalFoot')) byId('accessModalFoot').innerHTML = '';
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

  function teamChecks(selected = []) {
    const ids = new Set((selected || []).map(item => String(item.id || item)));
    const teams = (state.usersData?.teams || []).filter(team => team.is_active !== false);
    return teams.length ? `<div class="access-multiselect">${teams.map(team => `<label class="access-member"><input type="checkbox" name="team_ids" value="${esc(team.id)}" ${ids.has(String(team.id))?'checked':''}><span>${esc(team.name)}</span></label>`).join('')}</div>` : '<div class="access-empty">No hay equipos activos.</div>';
  }

  function selectedValues(root, name) {
    return [...root.querySelectorAll(`input[name="${name}"]:checked`)].map(input => input.value);
  }

  function userCreateForm() {
    return `<div class="access-panel"><h3>Crear usuario</h3><div class="access-panel-intro">El usuario recibe únicamente los permisos del rol seleccionado.</div><form id="accessCreateUserForm" class="access-form" autocomplete="off"><div><label>Nombre completo</label><input name="full_name" required></div><div><label>Usuario</label><input name="username" required></div><div><label>Contraseña temporal</label><input name="password" type="password" minlength="10" required></div><div><label>Rol de acceso</label><select name="access_role_id" required><option value="">Seleccionar rol</option>${roleOptions()}</select></div><div><label>Equipos</label>${teamChecks()}</div><div class="access-form-actions"><button type="submit" class="access-primary">Crear usuario</button></div></form></div>`;
  }

  function renderUsersPane() {
    const data = state.usersData || { admins:[], roles:[], teams:[] };
    const rows = data.admins || [];
    const list = rows.length ? rows.map(user => {
      const role = user.role === 'master_admin' ? 'Administrador maestro' : user.access_roles?.name || 'Sin rol';
      const teams = (user.teams || []).map(team => team.name).join(', ') || 'Sin equipo';
      const editable = user.role !== 'master_admin' || state.account?.role === 'master_admin';
      return `<div class="access-row"><div><div class="access-row-title">${esc(user.full_name)} · ${esc(user.username)}</div><div class="access-row-meta">${esc(role)} · ${esc(teams)}</div><div class="access-role-summary"><span class="access-status ${user.is_active?'':'inactive'}">${user.is_active?'Activo':'Desactivado'}</span></div></div><div class="access-row-actions">${editable?`<button type="button" class="access-secondary" data-access-action="edit-user" data-id="${esc(user.id)}">Editar</button><button type="button" class="access-secondary" data-access-action="password-user" data-id="${esc(user.id)}">Contraseña</button>${user.id!==state.account?.id?`<button type="button" class="${user.is_active?'access-danger':'access-secondary'}" data-access-action="toggle-user" data-id="${esc(user.id)}">${user.is_active?'Desactivar':'Activar'}</button>`:''}`:''}</div></div>`;
    }).join('') : '<div class="access-empty">No hay usuarios.</div>';
    byId('accessWorkspaceBody').innerHTML = `<div class="access-grid">${userCreateForm()}<div class="access-panel"><h3>Usuarios</h3><div class="access-panel-intro">Rol, equipos y estado efectivo de cada cuenta.</div><div class="access-list">${list}</div></div></div>`;
    byId('accessCreateUserForm')?.addEventListener('submit', createUser);
  }

  async function createUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await request('/api/admins',{ method:'POST', body:JSON.stringify({ full_name:data.get('full_name'), username:data.get('username'), password:data.get('password'), access_role_id:data.get('access_role_id'), team_ids:selectedValues(form,'team_ids') }) });
      form.reset();
      setMessage('Usuario creado correctamente.',true);
      await loadUsers();
      renderUsersPane();
    } catch(error) { setMessage(safeAccessMessage(error, 'No se pudo crear el usuario. Revisa los datos e intenta nuevamente.', 'create_user'),false); }
  }

  function openUserEditor(id) {
    const user = state.usersData?.admins?.find(row => String(row.id) === String(id));
    if (!user) return;
    if (user.role === 'master_admin') return setMessage('La cuenta maestra se administra desde Mi cuenta.',false);
    openModal('Editar usuario', `<form id="accessEditUserForm" class="access-form"><div><label>Nombre completo</label><input name="full_name" value="${esc(user.full_name)}" required></div><div><label>Usuario</label><input name="username" value="${esc(user.username)}" required></div><div><label>Rol de acceso</label><select name="access_role_id" required>${roleOptions(user.access_role_id)}</select></div><div><label>Equipos</label>${teamChecks(user.teams || [])}</div></form>`, [
      { label:'Cancelar', className:'access-secondary', onClick:closeModal },
      { label:'Guardar cambios', onClick:async()=>{ const form=byId('accessEditUserForm'); const data=new FormData(form); await request('/api/admins',{method:'PATCH',body:JSON.stringify({id:user.id,full_name:data.get('full_name'),username:data.get('username'),access_role_id:data.get('access_role_id'),team_ids:selectedValues(form,'team_ids')})}); closeModal(); setMessage('Usuario actualizado.',true); await loadUsers(); renderUsersPane(); } }
    ]);
  }

  function openPasswordEditor(id) {
    const user = state.usersData?.admins?.find(row => String(row.id) === String(id));
    if (!user) return;
    openModal(`Contraseña · ${user.username}`, '<form id="accessPasswordForm" class="access-form"><div><label>Nueva contraseña</label><input name="password" type="password" minlength="10" required></div><div class="access-panel-intro">Mínimo 10 caracteres.</div></form>', [
      { label:'Cancelar', className:'access-secondary', onClick:closeModal },
      { label:'Actualizar', onClick:async()=>{ const form=byId('accessPasswordForm'); const password=new FormData(form).get('password'); if(String(password||'').length<10) throw new Error('La contraseña debe tener al menos 10 caracteres'); await request('/api/admins',{method:'PATCH',body:JSON.stringify({id:user.id,password})}); closeModal(); setMessage('Contraseña actualizada.',true); } }
    ]);
  }

  function permissionMatrix(selected = [], disabled = false) {
    const chosen = new Set(selected || []);
    const groups = new Map();
    for (const permission of state.permissionCatalog || []) {
      if (!groups.has(permission.module)) groups.set(permission.module, []);
      groups.get(permission.module).push(permission);
    }
    return `<div class="access-permission-groups">${[...groups.entries()].map(([module,items])=>`<div class="access-permission-group"><div class="access-permission-title">${esc(module)}</div><div class="access-permission-items">${items.map(item=>`<label class="access-check"><input type="checkbox" name="permission_keys" value="${esc(item.permission_key)}" ${chosen.has(item.permission_key)?'checked':''} ${disabled?'disabled':''}><span><strong>${esc(item.label || item.permission_key)}</strong><small>${esc(item.description || item.permission_key)}</small></span></label>`).join('')}</div></div>`).join('')}</div>`;
  }

  function renderRolesPane() {
    const list = state.roles.length ? state.roles.map(role => `<div class="access-row"><div><div class="access-row-title">${esc(role.name)}</div><div class="access-row-meta">${esc(role.description || 'Sin descripción')} · ${role.permission_keys?.length || 0} permisos</div><div class="access-role-summary"><span class="access-status ${role.is_active?'':'inactive'}">${role.is_active?'Activo':'Desactivado'}</span>${role.is_system?'<span class="access-role-chip">Sistema</span>':''}</div></div><div class="access-row-actions"><button type="button" class="access-secondary" data-access-action="edit-role" data-id="${esc(role.id)}">${role.is_system?'Ver':'Editar'}</button>${!role.is_system?`<button type="button" class="${role.is_active?'access-danger':'access-secondary'}" data-access-action="toggle-role" data-id="${esc(role.id)}">${role.is_active?'Desactivar':'Activar'}</button>`:''}</div></div>`).join('') : '<div class="access-empty">No hay roles configurados.</div>';
    byId('accessWorkspaceBody').innerHTML = `<div class="access-grid"><div class="access-panel"><h3>Crear rol</h3><div class="access-panel-intro">Define un conjunto reutilizable de permisos. No se crean perfiles departamentales automáticamente.</div><form id="accessCreateRoleForm" class="access-form"><div><label>Nombre</label><input name="name" required></div><div><label>Descripción</label><textarea name="description" rows="3"></textarea></div><div><label>Permisos</label>${permissionMatrix()}</div><div class="access-form-actions"><button type="submit" class="access-primary">Crear rol</button></div></form></div><div class="access-panel"><h3>Roles</h3><div class="access-list">${list}</div></div></div>`;
    byId('accessCreateRoleForm')?.addEventListener('submit', createRole);
  }

  async function createRole(event) {
    event.preventDefault();
    const form=event.currentTarget, data=new FormData(form);
    try {
      await request('/api/access-control?resource=roles',{method:'POST',body:JSON.stringify({name:data.get('name'),description:data.get('description'),permission_keys:selectedValues(form,'permission_keys')})});
      form.reset(); setMessage('Rol creado correctamente.',true); await loadRoles(); renderRolesPane();
    } catch(error) { setMessage(safeAccessMessage(error, 'No se pudo crear el rol. Revisa los datos e intenta nuevamente.', 'create_role'),false); }
  }

  function openRoleEditor(id) {
    const role=state.roles.find(row=>String(row.id)===String(id)); if(!role)return;
    openModal(role.is_system?'Rol de sistema':'Editar rol', `<form id="accessEditRoleForm" class="access-form"><div><label>Nombre</label><input name="name" value="${esc(role.name)}" ${role.is_system?'disabled':''} required></div><div><label>Descripción</label><textarea name="description" rows="3" ${role.is_system?'disabled':''}>${esc(role.description||'')}</textarea></div><div><label>Permisos</label>${permissionMatrix(role.permission_keys||[],role.is_system)}</div></form>`, role.is_system ? [{label:'Cerrar',className:'access-secondary',onClick:closeModal}] : [
      {label:'Cancelar',className:'access-secondary',onClick:closeModal},
      {label:'Guardar cambios',onClick:async()=>{const form=byId('accessEditRoleForm'),data=new FormData(form);await request('/api/access-control?resource=roles',{method:'PATCH',body:JSON.stringify({id:role.id,name:data.get('name'),description:data.get('description'),permission_keys:selectedValues(form,'permission_keys')})});closeModal();setMessage('Rol actualizado.',true);await loadRoles();renderRolesPane();}}
    ]);
  }

  function teamMemberChecks(selected = []) {
    const chosen=new Set((selected||[]).map(String));
    return state.teamUsers.length ? `<div class="access-multiselect">${state.teamUsers.filter(user=>user.is_active!==false).map(user=>`<label class="access-member"><input type="checkbox" name="member_ids" value="${esc(user.id)}" ${chosen.has(String(user.id))?'checked':''}><span>${esc(user.full_name)} · ${esc(user.username)}</span></label>`).join('')}</div>` : '<div class="access-empty">No hay usuarios disponibles.</div>';
  }

  function renderTeamsPane() {
    const list=state.teams.length?state.teams.map(team=>`<div class="access-row"><div><div class="access-row-title">${esc(team.name)}</div><div class="access-row-meta">${esc(team.description||'Sin descripción')} · ${(team.member_ids||[]).length} miembros</div><span class="access-status ${team.is_active?'':'inactive'}">${team.is_active?'Activo':'Desactivado'}</span></div><div class="access-row-actions"><button type="button" class="access-secondary" data-access-action="edit-team" data-id="${esc(team.id)}">Editar</button><button type="button" class="${team.is_active?'access-danger':'access-secondary'}" data-access-action="toggle-team" data-id="${esc(team.id)}">${team.is_active?'Desactivar':'Activar'}</button></div></div>`).join(''):'<div class="access-empty">No hay equipos configurados.</div>';
    byId('accessWorkspaceBody').innerHTML=`<div class="access-grid"><div class="access-panel"><h3>Crear equipo</h3><div class="access-panel-intro">Los equipos agrupan personas para organización y futuros handoffs; no cambian permisos por sí solos.</div><form id="accessCreateTeamForm" class="access-form"><div><label>Nombre</label><input name="name" required></div><div><label>Descripción</label><textarea name="description" rows="3"></textarea></div><div><label>Miembros</label>${teamMemberChecks()}</div><div class="access-form-actions"><button type="submit" class="access-primary">Crear equipo</button></div></form></div><div class="access-panel"><h3>Equipos</h3><div class="access-list">${list}</div></div></div>`;
    byId('accessCreateTeamForm')?.addEventListener('submit',createTeam);
  }

  async function createTeam(event){event.preventDefault();const form=event.currentTarget,data=new FormData(form);try{await request('/api/access-control?resource=teams',{method:'POST',body:JSON.stringify({name:data.get('name'),description:data.get('description'),member_ids:selectedValues(form,'member_ids')})});form.reset();setMessage('Equipo creado correctamente.',true);await loadTeams();renderTeamsPane();}catch(error){setMessage(safeAccessMessage(error,'No se pudo crear el equipo. Revisa los datos e intenta nuevamente.','create_team'),false);}}

  function openTeamEditor(id){const team=state.teams.find(row=>String(row.id)===String(id));if(!team)return;openModal('Editar equipo',`<form id="accessEditTeamForm" class="access-form"><div><label>Nombre</label><input name="name" value="${esc(team.name)}" required></div><div><label>Descripción</label><textarea name="description" rows="3">${esc(team.description||'')}</textarea></div><div><label>Miembros</label>${teamMemberChecks(team.member_ids||[])}</div></form>`,[{label:'Cancelar',className:'access-secondary',onClick:closeModal},{label:'Guardar cambios',onClick:async()=>{const form=byId('accessEditTeamForm'),data=new FormData(form);await request('/api/access-control?resource=teams',{method:'PATCH',body:JSON.stringify({id:team.id,name:data.get('name'),description:data.get('description'),member_ids:selectedValues(form,'member_ids')})});closeModal();setMessage('Equipo actualizado.',true);await loadTeams();renderTeamsPane();}}]);}

  async function loadUsers(){state.usersData=await request('/api/admins');}
  async function loadRoles(){const [roles,permissions]=await Promise.all([request('/api/access-control?resource=roles'),request('/api/access-control?resource=permissions')]);state.roles=roles.roles||[];state.permissionCatalog=permissions.permissions||[];}
  async function loadTeams(){const result=await request('/api/access-control?resource=teams');state.teams=result.teams||[];state.teamUsers=result.users||[];}

  async function switchTab(tab){
    if(tab==='users'&&!can('administration.users.manage'))return;
    if(tab==='roles'&&!can('administration.roles.manage'))return;
    if(tab==='teams'&&!can('administration.teams.manage'))return;
    state.activeTab=tab;
    document.querySelectorAll('[data-access-tab]').forEach(button=>button.classList.toggle('active',button.dataset.accessTab===tab));
    byId('accessWorkspaceBody').innerHTML='<div class="access-empty">Cargando...</div>';
    setMessage('');
    try{
      if(tab==='users'){await loadUsers();renderUsersPane();}
      else if(tab==='roles'){await loadRoles();renderRolesPane();}
      else {await loadTeams();renderTeamsPane();}
    }catch(error){byId('accessWorkspaceBody').innerHTML='<div class="access-empty">No se pudo cargar esta sección.</div>';setMessage(safeAccessMessage(error,'No se pudo cargar esta sección. Intenta nuevamente.','load_tab'),false);}
  }

  async function handleWorkspaceClick(event){
    const close=event.target.closest('[data-access-close]');if(close){closeModal();return;}
    if(event.target===byId('accessModal')){closeModal();return;}
    const action=event.target.closest('[data-access-action]');if(!action)return;
    const id=action.dataset.id,type=action.dataset.accessAction;
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
    state
  });
})();
