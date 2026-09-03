(() => {
  'use strict';

  if (window.__accountAdministrationInstalled) return;
  window.__accountAdministrationInstalled = true;

  const state = {
    account:null,
    sessionTargets:[],
    loadPromise:null,
    passwordBusy:false,
    revocationBusy:false,
    pendingRevocation:null,
    lastFocused:null
  };

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
  const SAFE_ACCOUNT_ERRORS = new Set([
    'La cuenta no está disponible',
    'Escribe tu contraseña actual',
    'Escribe la nueva contraseña',
    'La nueva contraseña debe ser diferente a la actual',
    'La contraseña actual no es correcta',
    'La contraseña debe tener al menos 10 caracteres',
    'La contraseña cambió en otra sesión. Inicia sesión nuevamente.',
    'No tienes permiso para realizar esta acción',
    'Administrador inválido',
    'No hay cambios para guardar',
    'No se pudo renovar la sesión segura. Inicia sesión nuevamente.'
  ]);

  function safeAccountMessage(error, fallback) {
    const context = arguments[2] || 'operation';
    const message = String(error?.message || '').trim();
    if (error?.status === 401) return 'Tu sesión terminó. Inicia sesión nuevamente para continuar.';
    if (SAFE_ACCOUNT_ERRORS.has(message)) return message;
    if (error?.status === 403) return 'No tienes permiso para completar esta acción.';
    console.error('ACCOUNT_UI_FAILED', { context, status:error?.status || null, code:error?.code || null, error });
    return fallback;
  }

  function getCurrentUser() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser) return currentUser;
    } catch {}
    try { return JSON.parse(localStorage.getItem('export_mca_user') || 'null'); }
    catch { return null; }
  }

  function canManageAccess() {
    const access = window.ExportMcaAccessControl;
    if (access?.can) return access.can('administration.users.manage');
    const user = getCurrentUser();
    return user?.role === 'master_admin' || Array.isArray(user?.permissions) && user.permissions.includes('administration.users.manage');
  }

  async function request(path, options = {}) {
    if (typeof window.api === 'function') return window.api(path, options);
    const token = localStorage.getItem('export_mca_token') || '';
    const response = await fetch(path, {
      ...options,
      headers:{
        'Content-Type':'application/json',
        ...(token ? { Authorization:`Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const failure = new Error(data.error || 'No se pudo completar la operación');
      failure.code = data.details?.code || data.code || data.reason_code || null;
      failure.status = response.status;
      throw failure;
    }
    return data;
  }

  function roleLabel(account) {
    if (account?.role === 'master_admin') return 'Administrador maestro';
    return account?.access_role?.name || 'Usuario';
  }

  function initials(value) {
    const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
    return (parts.slice(0,2).map(part => part[0]).join('') || 'MC').toLocaleUpperCase('es');
  }

  function formatDate(value, fallback = 'No disponible') {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return date.toLocaleString('es-US', {
      day:'2-digit',
      month:'short',
      year:'numeric',
      hour:'2-digit',
      minute:'2-digit'
    });
  }

  function accountSnapshot(account = {}) {
    const teams = Array.isArray(account.teams)
      ? account.teams.map(team => team?.team_name || team?.name).filter(Boolean)
      : [];
    const permissions = Array.isArray(account.permissions) ? account.permissions : [];
    const master = account.role === 'master_admin';
    return {
      fullName:String(account.full_name || 'Sin registrar'),
      username:String(account.username || '—'),
      initials:initials(account.full_name || account.username),
      role:roleLabel(account),
      master,
      active:account.is_active !== false,
      teams,
      permissionCount:permissions.length,
      permissionMetric:master ? 'Total' : String(permissions.length),
      lastLogin:formatDate(account.last_login_at),
      passwordChanged:formatDate(account.password_changed_at, 'Sin fecha registrada'),
      accountCreated:formatDate(account.created_at)
    };
  }

  function passwordChecks(currentPassword = '', newPassword = '', confirmPassword = '') {
    return {
      minimum:newPassword.length >= 10,
      different:Boolean(newPassword) && newPassword !== currentPassword,
      confirmation:Boolean(confirmPassword) && confirmPassword === newPassword
    };
  }

  function workspaceMarkup() {
    return `
      <div class="native-workspace-shell account-workspace">
        <header class="account-header native-workspace-hero">
          <div class="native-workspace-heading">
            <span class="native-workspace-kicker">Identidad y seguridad</span>
            <h2>Mi cuenta</h2>
            <p>Consulta el acceso que tienes hoy, protege tu contraseña y administra sesiones autorizadas desde un solo lugar.</p>
            <div class="account-hero-state" aria-label="Estado de la cuenta">
              <span class="account-state-dot" aria-hidden="true"></span>
              <span id="accountOperationalState">Sesión autenticada</span>
              <span id="accountLastUpdated">Preparando perfil…</span>
            </div>
          </div>
          <div class="account-summary native-workspace-summary" aria-label="Resumen de la cuenta" aria-live="polite">
            <article class="account-summary-card native-workspace-summary-card"><strong id="accountRoleMetric">—</strong><span>Rol efectivo</span><small id="accountRoleDetail">Cargando acceso</small></article>
            <article class="account-summary-card native-workspace-summary-card"><strong id="accountPermissionMetric">—</strong><span>Permisos</span><small>Capacidades vigentes</small></article>
            <article class="account-summary-card native-workspace-summary-card"><strong id="accountTeamMetric">—</strong><span>Equipos</span><small>Membresías activas</small></article>
            <article class="account-summary-card native-workspace-summary-card"><strong id="accountPasswordMetric">—</strong><span>Contraseña</span><small id="accountPasswordDetail">Estado pendiente</small></article>
          </div>
        </header>

        <div id="accountWorkspaceMessage" class="account-message" role="status" aria-live="polite"></div>

        <div class="account-layout">
          <section class="account-panel account-card account-profile-panel" aria-labelledby="accountProfileTitle">
            <header class="account-panel-head">
              <div><span class="account-eyebrow">Acceso efectivo</span><h3 id="accountProfileTitle">Perfil de acceso</h3><p>Identidad, rol, equipos y actividad de la cuenta autenticada.</p></div>
              <span class="account-readonly-pill">Solo consulta</span>
            </header>
            <div id="accountProfile" class="account-profile" aria-live="polite">
              <div class="account-loading" role="status"><span class="account-spinner" aria-hidden="true"></span><span>Cargando cuenta…</span></div>
            </div>
          </section>

          <section class="account-panel account-card account-security-panel" aria-labelledby="accountSecurityTitle">
            <header class="account-panel-head">
              <div><span class="account-eyebrow">Protección personal</span><h3 id="accountSecurityTitle">Cambiar contraseña</h3><p>Verifica tu contraseña actual. Al guardar, las sesiones anteriores dejan de ser válidas.</p></div>
              <span class="account-security-badge"><span aria-hidden="true"></span>Canal seguro</span>
            </header>
            <form id="accountPasswordForm" class="account-security-form" autocomplete="off" novalidate>
              <div class="account-field-control"><label for="accountCurrentPassword">Contraseña actual</label><span class="account-password-control"><input id="accountCurrentPassword" type="password" autocomplete="current-password" required><button type="button" class="account-password-toggle" data-account-toggle="accountCurrentPassword" data-account-label="contraseña actual" aria-label="Mostrar contraseña actual" aria-pressed="false">Mostrar</button></span></div>
              <div class="account-password-grid">
                <div class="account-field-control"><label for="accountNewPassword">Nueva contraseña</label><span class="account-password-control"><input id="accountNewPassword" type="password" autocomplete="new-password" minlength="10" required><button type="button" class="account-password-toggle" data-account-toggle="accountNewPassword" data-account-label="nueva contraseña" aria-label="Mostrar nueva contraseña" aria-pressed="false">Mostrar</button></span></div>
                <div class="account-field-control"><label for="accountConfirmPassword">Confirmar contraseña</label><span class="account-password-control"><input id="accountConfirmPassword" type="password" autocomplete="new-password" minlength="10" required><button type="button" class="account-password-toggle" data-account-toggle="accountConfirmPassword" data-account-label="confirmación de contraseña" aria-label="Mostrar confirmación de contraseña" aria-pressed="false">Mostrar</button></span></div>
              </div>
              <div id="accountPasswordChecklist" class="account-password-checklist" aria-label="Requisitos de la contraseña" aria-live="polite">
                <span data-account-check="minimum"><i aria-hidden="true"></i>10 caracteres o más</span>
                <span data-account-check="different"><i aria-hidden="true"></i>Diferente de la actual</span>
                <span data-account-check="confirmation"><i aria-hidden="true"></i>Confirmación coincidente</span>
              </div>
              <div class="account-security-actions"><button id="accountPasswordSubmit" class="account-primary" type="submit">Actualizar contraseña</button><span>Tu nueva sesión seguirá abierta en este dispositivo.</span></div>
              <div id="accountPasswordStatus" class="account-security-status" role="status" aria-live="polite"></div>
            </form>
          </section>

          <section id="accountSessionAdminCard" class="account-panel account-card account-session-admin hidden" aria-labelledby="accountSessionTitle">
            <header class="account-panel-head account-session-head">
              <div><span class="account-eyebrow">Control administrativo</span><h3 id="accountSessionTitle">Revocar sesiones anteriores</h3><p>Invalida de inmediato los tokens emitidos para una cuenta. La acción y su motivo quedan registrados en auditoría.</p></div>
              <span class="account-sensitive-pill">Acción sensible</span>
            </header>
            <div class="account-session-body">
              <form id="accountSessionRevokeForm" class="account-session-grid" autocomplete="off" novalidate>
                <label class="account-field-control" for="accountSessionUser"><span>Usuario</span><select id="accountSessionUser" required><option value="">Seleccionar usuario</option></select></label>
                <label class="account-field-control" for="accountSessionReason"><span>Motivo de auditoría</span><input id="accountSessionReason" maxlength="240" placeholder="Ej. dispositivo perdido" required></label>
                <button id="accountSessionSubmit" class="account-danger" type="submit">Revisar revocación</button>
              </form>
              <div id="accountSessionTargetSummary" class="account-session-target" role="note">Selecciona una cuenta para revisar la acción.</div>
              <div id="accountSessionStatus" class="account-security-status" role="status" aria-live="polite"></div>
            </div>
          </section>
        </div>

        <div id="accountConfirmDialog" class="account-modal hidden" aria-hidden="true">
          <section class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="accountConfirmTitle" aria-describedby="accountConfirmDescription">
            <span class="account-dialog-kicker">Confirmación requerida</span>
            <h3 id="accountConfirmTitle">Revocar sesiones</h3>
            <p id="accountConfirmDescription">Revisa la cuenta y el motivo antes de continuar.</p>
            <dl class="account-confirm-facts"><div><dt>Cuenta</dt><dd id="accountConfirmUser">—</dd></div><div><dt>Motivo</dt><dd id="accountConfirmReason">—</dd></div></dl>
            <div id="accountConfirmMessage" class="account-dialog-message" role="status" aria-live="polite"></div>
            <div class="account-dialog-actions"><button type="button" class="account-secondary" data-account-dialog-close>Volver</button><button id="accountConfirmRevoke" type="button" class="account-danger" data-account-action="confirm-revocation">Revocar sesiones</button></div>
          </section>
        </div>
      </div>`;
  }

  function ensureAccountSection() {
    let section = byId('accountSection');
    if (section) {
      section.dataset.accountOwner = 'account-administration.js';
      return section;
    }

    section = document.createElement('section');
    section.id = 'accountSection';
    section.className = 'app-section hidden';
    section.dataset.accountOwner = 'account-administration.js';
    section.innerHTML = workspaceMarkup();

    const adminsSection = byId('adminsSection');
    const main = adminsSection?.parentElement || document.querySelector('.main-shell main');
    if (adminsSection?.parentElement) adminsSection.insertAdjacentElement('beforebegin', section);
    else main?.appendChild(section);
    return section;
  }

  function ensureAdministrationNavigation() {
    const adminNav = byId('adminNav');
    if (!adminNav) return;
    adminNav.classList.remove('hidden');
    adminNav.dataset.accountOwner = 'account-administration.js';
    const submenu = adminNav.querySelector('.submenu');
    if (!submenu) return;

    let accountButton = byId('accountNavItem');
    if (!accountButton) {
      accountButton = document.createElement('button');
      accountButton.id = 'accountNavItem';
      accountButton.type = 'button';
      accountButton.dataset.section = 'accountSection';
      accountButton.dataset.navLabel = 'Mi cuenta';
      accountButton.innerHTML = '<span class="nav-icon" aria-hidden="true"></span><span class="nav-label">Mi cuenta</span>';
      submenu.prepend(accountButton);
    }

    const adminsButton = submenu.querySelector('[data-section="adminsSection"]');
    if (adminsButton) {
      adminsButton.classList.toggle('hidden', !canManageAccess());
      adminsButton.dataset.navLabel = 'Usuarios y acceso';
      adminsButton.setAttribute('aria-label','Usuarios y acceso');
      adminsButton.title = 'Usuarios y acceso';
      const label = adminsButton.querySelector('.nav-label');
      if (label) label.textContent = 'Usuarios y acceso';
    }

    window.ExportMcaIcons?.hydrate?.(adminNav);
    accountButton.onclick = event => {
      event.preventDefault();
      if (typeof window.showSection === 'function') window.showSection('accountSection');
      updatePageTitle('accountSection');
      loadAccount().catch(error => {
        console.error('ACCOUNT_LOAD_FAILED', error);
        setWorkspaceMessage(safeAccountMessage(error, 'No se pudo cargar la cuenta. Intenta nuevamente.', 'load_account'), false);
      });
    };
  }

  function syncAccessUiState() {
    const access = window.ExportMcaAccessControl;
    const notificationsReadOnly = Boolean(access?.can?.('notifications.read') && !access?.can?.('notifications.manage'));
    document.body.classList.toggle('access-notifications-readonly', notificationsReadOnly);
    ensureAdministrationNavigation();
    const card = byId('accountSessionAdminCard');
    if (card) {
      const allowed = canManageAccess();
      card.classList.toggle('hidden', !allowed);
      card.setAttribute('aria-hidden', String(!allowed));
    }
  }

  function setWorkspaceMessage(message, ok = false) {
    const target = byId('accountWorkspaceMessage');
    if (!target) return;
    target.textContent = message || '';
    target.className = `account-message ${message ? (ok ? 'ok' : 'bad') : ''}`;
  }

  function setStatus(message, ok) {
    const target = byId('accountPasswordStatus');
    if (!target) return;
    target.textContent = message || '';
    target.className = `account-security-status ${message ? (ok ? 'ok' : 'bad') : ''}`;
  }

  function setSessionStatus(message, ok) {
    const target = byId('accountSessionStatus');
    if (!target) return;
    target.textContent = message || '';
    target.className = `account-security-status ${message ? (ok ? 'ok' : 'bad') : ''}`;
  }

  function setDialogMessage(message) {
    const target = byId('accountConfirmMessage');
    if (!target) return;
    target.textContent = message || '';
    target.className = `account-dialog-message ${message ? 'bad' : ''}`;
  }

  function setMetric(id, value) {
    const target = byId(id);
    if (target) target.textContent = value;
  }

  function renderMetrics(account = state.account) {
    if (!account) return;
    const snapshot = accountSnapshot(account);
    setMetric('accountRoleMetric', snapshot.master ? 'Maestro' : snapshot.role);
    setMetric('accountRoleDetail', snapshot.master ? 'Acceso total' : 'Rol configurado');
    setMetric('accountPermissionMetric', snapshot.permissionMetric);
    setMetric('accountTeamMetric', String(snapshot.teams.length));
    setMetric('accountPasswordMetric', account.password_changed_at ? 'Actualizada' : 'Inicial');
    setMetric('accountPasswordDetail', account.password_changed_at ? snapshot.passwordChanged : 'Sin fecha registrada');
    setMetric('accountOperationalState', snapshot.active ? 'Cuenta activa' : 'Cuenta no disponible');
  }

  function renderAccount(account) {
    const target = byId('accountProfile');
    if (!target) return;
    const snapshot = accountSnapshot(account);
    const teamMarkup = snapshot.teams.length
      ? snapshot.teams.map(team => `<span class="account-team-chip">${esc(team)}</span>`).join('')
      : '<span class="account-team-empty">Sin equipo asignado</span>';
    target.innerHTML = `
      <article class="account-identity">
        <span class="account-avatar" aria-hidden="true">${esc(snapshot.initials)}</span>
        <div class="account-identity-copy"><div class="account-name-row"><h4>${esc(snapshot.fullName)}</h4><span class="account-active-pill"><i aria-hidden="true"></i>${snapshot.active ? 'Activa' : 'No disponible'}</span></div><p>@${esc(snapshot.username)}</p><span class="account-role-pill">${esc(snapshot.role)}</span></div>
      </article>
      <div class="account-profile-grid">
        <article class="account-fact"><span class="account-field-label">Equipos</span><div class="account-team-list">${teamMarkup}</div></article>
        <article class="account-fact"><span class="account-field-label">Permisos efectivos</span><strong>${snapshot.master ? 'Acceso total del sistema' : `${snapshot.permissionCount} permisos`}</strong><small>Determinan qué puedes consultar y gestionar.</small></article>
        <article class="account-fact"><span class="account-field-label">Último acceso</span><strong>${esc(snapshot.lastLogin)}</strong><small>Actividad registrada por el ERP.</small></article>
        <article class="account-fact"><span class="account-field-label">Último cambio de contraseña</span><strong>${esc(snapshot.passwordChanged)}</strong><small>Las sesiones previas se invalidan al cambiarla.</small></article>
        <article class="account-fact account-fact-wide"><span class="account-field-label">Cuenta creada</span><strong>${esc(snapshot.accountCreated)}</strong><small>Identidad administrada desde Usuarios y acceso.</small></article>
      </div>`;
    renderMetrics(account);
  }

  function renderPasswordChecks() {
    const currentPassword = byId('accountCurrentPassword')?.value || '';
    const newPassword = byId('accountNewPassword')?.value || '';
    const confirmPassword = byId('accountConfirmPassword')?.value || '';
    const checks = passwordChecks(currentPassword, newPassword, confirmPassword);
    Object.entries(checks).forEach(([name, complete]) => {
      const node = document.querySelector(`[data-account-check="${name}"]`);
      if (!node) return;
      node.classList.toggle('complete', complete);
      node.setAttribute('data-complete', String(complete));
    });
    return checks;
  }

  function markUpdated() {
    const target = byId('accountLastUpdated');
    if (target) target.textContent = `Actualizado ${new Date().toLocaleTimeString('es-US', { hour:'2-digit', minute:'2-digit' })}`;
  }

  function renderSessionTarget() {
    const target = byId('accountSessionTargetSummary');
    const userId = byId('accountSessionUser')?.value || '';
    if (!target) return;
    const user = state.sessionTargets.find(item => String(item.id) === String(userId));
    if (!user) {
      target.textContent = 'Selecciona una cuenta para revisar la acción.';
      target.classList.remove('selected');
      return;
    }
    target.textContent = `${user.full_name} · @${user.username}${user.is_active === false ? ' · cuenta desactivada' : ' · cuenta activa'}`;
    target.classList.add('selected');
  }

  async function loadSessionTargets() {
    const card = byId('accountSessionAdminCard');
    if (!card) return [];
    const allowed = canManageAccess();
    card.classList.toggle('hidden', !allowed);
    card.setAttribute('aria-hidden', String(!allowed));
    if (!allowed) {
      state.sessionTargets = [];
      return [];
    }
    const result = await request('/api/admins');
    state.sessionTargets = result?.admins || [];
    const select = byId('accountSessionUser');
    if (!select) return state.sessionTargets;
    const current = select.value;
    select.innerHTML = '<option value="">Seleccionar usuario</option>' + state.sessionTargets.map(user =>
      `<option value="${esc(user.id)}">${esc(user.full_name)} · ${esc(user.username)}${user.is_active ? '' : ' · desactivado'}</option>`
    ).join('');
    if ([...select.options].some(option => option.value === current)) select.value = current;
    renderSessionTarget();
    return state.sessionTargets;
  }

  async function loadAccount() {
    if (state.loadPromise) return state.loadPromise;
    state.loadPromise = (async () => {
      setWorkspaceMessage('');
      const account = window.ExportMcaAccessControl?.refreshAccount
        ? await window.ExportMcaAccessControl.refreshAccount()
        : (await request('/api/account')).account || {};
      state.account = account || {};
      syncAccessUiState();
      renderAccount(state.account);
      await loadSessionTargets();
      markUpdated();
      return state.account;
    })();
    try { return await state.loadPromise; }
    finally { state.loadPromise = null; }
  }

  function setPasswordBusy(busy) {
    state.passwordBusy = Boolean(busy);
    const form = byId('accountPasswordForm');
    const button = byId('accountPasswordSubmit');
    form?.setAttribute('aria-busy', String(state.passwordBusy));
    if (button) button.disabled = state.passwordBusy;
  }

  async function submitPassword(event) {
    event.preventDefault();
    if (state.passwordBusy) return;
    const currentPassword = byId('accountCurrentPassword')?.value || '';
    const newPassword = byId('accountNewPassword')?.value || '';
    const confirmPassword = byId('accountConfirmPassword')?.value || '';
    if (!currentPassword) return setStatus('Escribe tu contraseña actual.', false);
    if (!newPassword) return setStatus('Escribe la nueva contraseña.', false);
    if (newPassword.length < 10) return setStatus('La nueva contraseña debe tener al menos 10 caracteres.', false);
    if (newPassword === currentPassword) return setStatus('La nueva contraseña debe ser diferente a la actual.', false);
    if (newPassword !== confirmPassword) return setStatus('La confirmación no coincide con la nueva contraseña.', false);

    setPasswordBusy(true);
    setStatus('Actualizando contraseña…', true);
    try {
      const result = await request('/api/account', {
        method:'PATCH',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
      });
      if (!result?.token) throw new Error('No se pudo renovar la sesión segura. Inicia sesión nuevamente.');
      localStorage.setItem('export_mca_token', result.token);
      event.currentTarget.reset();
      renderPasswordChecks();
      setStatus('Contraseña actualizada. Las sesiones anteriores quedaron cerradas.', true);
      await loadAccount();
    } catch (error) {
      console.error('ACCOUNT_PASSWORD_UPDATE_FAILED', error);
      setStatus(safeAccountMessage(error, 'No se pudo actualizar la contraseña. Intenta nuevamente.', 'password_update'), false);
    } finally {
      setPasswordBusy(false);
    }
  }

  function openRevocationDialog(userId, reason) {
    const user = state.sessionTargets.find(item => String(item.id) === String(userId));
    if (!user) return setSessionStatus('Selecciona un usuario.', false);
    state.pendingRevocation = { userId:String(userId), reason:String(reason), label:`${user.full_name} · @${user.username}` };
    state.lastFocused = document.activeElement;
    setMetric('accountConfirmUser', state.pendingRevocation.label);
    setMetric('accountConfirmReason', state.pendingRevocation.reason);
    setDialogMessage('');
    const dialog = byId('accountConfirmDialog');
    if (!dialog) return;
    dialog.hidden = false;
    dialog.classList.remove('hidden');
    dialog.setAttribute('aria-hidden','false');
    document.body.classList.add('account-dialog-open');
    queueMicrotask(() => byId('accountConfirmRevoke')?.focus());
  }

  function closeRevocationDialog() {
    if (state.revocationBusy) return;
    const dialog = byId('accountConfirmDialog');
    if (!dialog) return;
    dialog.hidden = true;
    dialog.classList.add('hidden');
    dialog.setAttribute('aria-hidden','true');
    document.body.classList.remove('account-dialog-open');
    state.pendingRevocation = null;
    const focusTarget = state.lastFocused;
    state.lastFocused = null;
    focusTarget?.focus?.();
  }

  function setRevocationBusy(busy) {
    state.revocationBusy = Boolean(busy);
    const button = byId('accountConfirmRevoke');
    if (button) {
      button.disabled = state.revocationBusy;
      button.dataset.accountBusy = state.revocationBusy ? '1' : '0';
      button.textContent = state.revocationBusy ? 'Revocando…' : 'Revocar sesiones';
    }
    byId('accountConfirmDialog')?.setAttribute('aria-busy', String(state.revocationBusy));
  }

  async function confirmSessionRevocation() {
    if (state.revocationBusy || !state.pendingRevocation) return;
    const { userId, reason } = state.pendingRevocation;
    setRevocationBusy(true);
    setDialogMessage('');
    try {
      const result = await request('/api/admins', {
        method:'PATCH',
        body: JSON.stringify({ id: userId, revoke_sessions: true, revoke_reason: reason })
      });
      if (result?.token) localStorage.setItem('export_mca_token', result.token);
      const reasonInput = byId('accountSessionReason');
      const userSelect = byId('accountSessionUser');
      if (reasonInput) reasonInput.value = '';
      if (userSelect) userSelect.value = '';
      setRevocationBusy(false);
      closeRevocationDialog();
      renderSessionTarget();
      setSessionStatus('Sesiones anteriores revocadas correctamente.', true);
      await loadSessionTargets();
    } catch (error) {
      console.error('ACCOUNT_SESSION_REVOCATION_FAILED', error);
      setDialogMessage(safeAccountMessage(error, 'No se pudieron revocar las sesiones. Intenta nuevamente.', 'session_revocation'));
      setRevocationBusy(false);
    }
  }

  function submitSessionRevocation(event) {
    event.preventDefault();
    if (state.revocationBusy) return;
    const userId = byId('accountSessionUser')?.value || '';
    const reason = String(byId('accountSessionReason')?.value || '').trim();
    if (!userId) return setSessionStatus('Selecciona un usuario.', false);
    if (reason.length < 3) return setSessionStatus('Escribe un motivo para la revocación.', false);
    setSessionStatus('');
    openRevocationDialog(userId, reason);
  }

  function togglePassword(button) {
    const input = byId(button.dataset.accountToggle);
    if (!input) return;
    const visible = input.type === 'text';
    const label = button.dataset.accountLabel || 'contraseña';
    input.type = visible ? 'password' : 'text';
    button.textContent = visible ? 'Mostrar' : 'Ocultar';
    button.setAttribute('aria-label', `${visible ? 'Mostrar' : 'Ocultar'} ${label}`);
    button.setAttribute('aria-pressed', String(!visible));
    input.focus();
  }

  function handleAccountClick(event) {
    const toggle = event.target?.closest?.('[data-account-toggle]');
    if (toggle) { togglePassword(toggle); return; }
    if (event.target === byId('accountConfirmDialog') || event.target?.closest?.('[data-account-dialog-close]')) {
      closeRevocationDialog();
      return;
    }
    if (event.target?.closest?.('[data-account-action="confirm-revocation"]')) confirmSessionRevocation();
  }

  function handleAccountKeydown(event) {
    const modal = byId('accountConfirmDialog');
    if (!modal || modal.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      closeRevocationDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not(:disabled)')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function bindAccountForms() {
    const passwordForm = byId('accountPasswordForm');
    if (passwordForm && passwordForm.dataset.bound !== 'true') {
      passwordForm.dataset.bound = 'true';
      passwordForm.addEventListener('submit', submitPassword);
      passwordForm.addEventListener('input', renderPasswordChecks);
    }
    const sessionForm = byId('accountSessionRevokeForm');
    if (sessionForm && sessionForm.dataset.bound !== 'true') {
      sessionForm.dataset.bound = 'true';
      sessionForm.addEventListener('submit', submitSessionRevocation);
      byId('accountSessionUser')?.addEventListener('change', renderSessionTarget);
    }
    const section = byId('accountSection');
    if (section && section.dataset.interactionsBound !== 'true') {
      section.dataset.interactionsBound = 'true';
      section.addEventListener('click', handleAccountClick);
      document.addEventListener('keydown', handleAccountKeydown);
    }
    renderPasswordChecks();
  }

  function updatePageTitle(sectionId) {
    if (sectionId !== 'accountSection') return;
    const title = byId('pageTitle');
    if (title) title.textContent = 'Mi cuenta';
  }

  function mount() {
    const section = ensureAccountSection();
    ensureAdministrationNavigation();
    syncAccessUiState();
    bindAccountForms();

    window.addEventListener('export-mca:section-changed', event => {
      const id = event.detail?.id;
      updatePageTitle(id);
      if (id === 'accountSection') loadAccount().catch(error => {
        console.error('ACCOUNT_SECTION_REFRESH_FAILED', error);
        setWorkspaceMessage(safeAccountMessage(error, 'No se pudo actualizar la información de la cuenta.', 'section_refresh'), false);
      });
    });
    window.addEventListener('export-mca:navigation-shell-changed', syncAccessUiState);
    window.addEventListener('export-mca:admin-ready', syncAccessUiState);

    if (!section.classList.contains('hidden')) loadAccount().catch(error => {
      console.error('ACCOUNT_LOAD_FAILED', error);
      setWorkspaceMessage(safeAccountMessage(error, 'No se pudo cargar la cuenta. Intenta nuevamente.', 'initial_load'), false);
    });
  }

  window.ExportMcaAccountAdministration = Object.freeze({
    owner:'account-administration.js',
    state,
    refresh:loadAccount,
    syncNavigation:syncAccessUiState,
    roleLabel,
    accountSnapshot,
    passwordChecks,
    renderMetrics
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true });
  else mount();
})();
