(() => {
  'use strict';

  if (window.__accountAdministrationInstalled) return;
  window.__accountAdministrationInstalled = true;

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const MANAGEMENT_KEYS = ['administration.users.manage','administration.roles.manage','administration.teams.manage'];
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
    const message = String(error?.message || '').trim();
    return SAFE_ACCOUNT_ERRORS.has(message) ? message : fallback;
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

  function syncAccessUiState() {
    const access = window.ExportMcaAccessControl;
    const notificationsReadOnly = Boolean(access?.can?.('notifications.read') && !access?.can?.('notifications.manage'));
    document.body.classList.toggle('access-notifications-readonly', notificationsReadOnly);
    ensureAdministrationNavigation();
    byId('accountSessionAdminCard')?.classList.toggle('hidden', !canManageAccess());
  }

  async function request(path, options = {}) {
    if (typeof window.api === 'function') return window.api(path, options);
    const token = localStorage.getItem('export_mca_token') || '';
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación');
    return data;
  }

  function ensureAccountSection() {
    let section = byId('accountSection');
    if (section) return section;

    section = document.createElement('section');
    section.id = 'accountSection';
    section.className = 'app-section hidden';
    section.dataset.accountOwner = 'account-administration.js';
    section.innerHTML = `
      <div class="native-workspace-shell account-workspace">
        <header class="native-workspace-hero">
          <div class="native-workspace-heading"><span class="native-workspace-kicker">Perfil y seguridad</span><h2>Mi cuenta</h2><p>Consulta tu acceso efectivo, actualiza tu contraseña y protege las sesiones autorizadas.</p></div>
        </header>
        <div class="account-layout">
        <section class="card account-card">
          <h2>Perfil de acceso</h2>
          <div class="account-intro">Información de la cuenta con la que has iniciado sesión en Export MCA.</div>
          <div id="accountProfile" class="account-profile"><div class="muted">Cargando cuenta...</div></div>
        </section>
        <section class="card account-card">
          <h2>Seguridad</h2>
          <div class="account-intro">Cambia tu contraseña verificando primero la contraseña actual.</div>
          <form id="accountPasswordForm" class="account-security-form" autocomplete="off">
            <label for="accountCurrentPassword">Contraseña actual</label>
            <input id="accountCurrentPassword" type="password" autocomplete="current-password" required>
            <label for="accountNewPassword">Nueva contraseña</label>
            <input id="accountNewPassword" type="password" autocomplete="new-password" minlength="10" required>
            <div class="account-help">Mínimo 10 caracteres.</div>
            <label for="accountConfirmPassword">Confirmar nueva contraseña</label>
            <input id="accountConfirmPassword" type="password" autocomplete="new-password" minlength="10" required>
            <div class="account-security-actions"><button type="submit">Actualizar contraseña</button></div>
            <div id="accountPasswordStatus" class="account-security-status" aria-live="polite"></div>
          </form>
        </section>
        <section id="accountSessionAdminCard" class="card account-card account-session-admin hidden">
          <h2>Sesiones de usuarios</h2>
          <div class="account-intro">Revoca inmediatamente todos los tokens anteriores de una cuenta. La acción queda registrada en auditoría.</div>
          <form id="accountSessionRevokeForm" class="account-session-grid" autocomplete="off">
            <div><label for="accountSessionUser">Usuario</label><select id="accountSessionUser" required><option value="">Seleccionar usuario</option></select></div>
            <div><label for="accountSessionReason">Motivo</label><input id="accountSessionReason" maxlength="240" placeholder="Ej. dispositivo perdido" required></div>
            <button type="submit">Revocar sesiones</button>
          </form>
          <div id="accountSessionStatus" class="account-security-status" aria-live="polite"></div>
        </section>
        </div>
      </div>`;

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
        setStatus(safeAccountMessage(error, 'No se pudo cargar la cuenta. Intenta nuevamente.'), false);
      });
    };
  }

  function roleLabel(account) {
    if (account?.role === 'master_admin') return 'Administrador maestro';
    return account?.access_role?.name || 'Usuario';
  }

  function renderAccount(account) {
    const target = byId('accountProfile');
    if (!target) return;
    const changed = account?.password_changed_at ? new Date(account.password_changed_at) : null;
    const lastLogin = account?.last_login_at ? new Date(account.last_login_at) : null;
    const teams = Array.isArray(account?.teams) ? account.teams.map(team => team.team_name).filter(Boolean) : [];
    const permissions = Array.isArray(account?.permissions) ? account.permissions.length : 0;
    target.innerHTML = `
      <div class="account-field"><div class="account-field-label">Nombre</div><div class="account-field-value">${esc(account?.full_name || 'Sin registrar')}</div></div>
      <div class="account-field"><div class="account-field-label">Usuario</div><div class="account-field-value">${esc(account?.username || '—')}</div></div>
      <div class="account-field"><div class="account-field-label">Rol de acceso</div><div class="account-field-value"><span class="account-role-pill">${esc(roleLabel(account))}</span></div></div>
      <div class="account-field"><div class="account-field-label">Equipos</div><div class="account-field-value">${esc(teams.length ? teams.join(', ') : 'Sin equipo')}</div></div>
      <div class="account-field"><div class="account-field-label">Permisos efectivos</div><div class="account-field-value">${account?.role === 'master_admin' ? 'Acceso total del sistema' : `${permissions} permisos`}</div></div>
      <div class="account-field"><div class="account-field-label">Último acceso</div><div class="account-field-value">${lastLogin && !Number.isNaN(lastLogin.getTime()) ? esc(lastLogin.toLocaleString('es-US')) : 'No disponible'}</div></div>
      <div class="account-field"><div class="account-field-label">Último cambio de contraseña</div><div class="account-field-value">${changed && !Number.isNaN(changed.getTime()) ? esc(changed.toLocaleString('es-US')) : 'No disponible'}</div></div>`;
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

  async function loadSessionTargets() {
    const card = byId('accountSessionAdminCard');
    if (!card) return;
    const allowed = canManageAccess();
    card.classList.toggle('hidden', !allowed);
    if (!allowed) return;
    const result = await request('/api/admins');
    const select = byId('accountSessionUser');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Seleccionar usuario</option>' + (result?.admins || []).map(user =>
      `<option value="${esc(user.id)}">${esc(user.full_name)} · ${esc(user.username)}${user.is_active ? '' : ' · desactivado'}</option>`
    ).join('');
    if ([...select.options].some(option => option.value === current)) select.value = current;
  }

  async function loadAccount() {
    const account = window.ExportMcaAccessControl?.refreshAccount
      ? await window.ExportMcaAccessControl.refreshAccount()
      : (await request('/api/account')).account || {};
    syncAccessUiState();
    renderAccount(account || {});
    await loadSessionTargets();
    return account || {};
  }

  async function submitPassword(event) {
    event.preventDefault();
    const currentPassword = byId('accountCurrentPassword')?.value || '';
    const newPassword = byId('accountNewPassword')?.value || '';
    const confirmPassword = byId('accountConfirmPassword')?.value || '';
    if (newPassword.length < 10) return setStatus('La nueva contraseña debe tener al menos 10 caracteres.', false);
    if (newPassword !== confirmPassword) return setStatus('La confirmación no coincide con la nueva contraseña.', false);

    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    setStatus('Actualizando contraseña...', true);
    try {
      const result = await request('/api/account', {
        method: 'PATCH',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
      });
      if (!result?.token) throw new Error('No se pudo renovar la sesión segura. Inicia sesión nuevamente.');
      localStorage.setItem('export_mca_token', result.token);
      event.currentTarget.reset();
      setStatus('Contraseña actualizada. Las sesiones anteriores quedaron cerradas.', true);
      await loadAccount();
    } catch (error) {
      console.error('ACCOUNT_PASSWORD_UPDATE_FAILED', error);
      setStatus(safeAccountMessage(error, 'No se pudo actualizar la contraseña. Intenta nuevamente.'), false);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function submitSessionRevocation(event) {
    event.preventDefault();
    const userId = byId('accountSessionUser')?.value || '';
    const reason = String(byId('accountSessionReason')?.value || '').trim();
    if (!userId) return setSessionStatus('Selecciona un usuario.', false);
    if (reason.length < 3) return setSessionStatus('Escribe un motivo para la revocación.', false);
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    setSessionStatus('Revocando sesiones...', true);
    try {
      const result = await request('/api/admins', {
        method: 'PATCH',
        body: JSON.stringify({ id: userId, revoke_sessions: true, revoke_reason: reason })
      });
      if (result?.token) localStorage.setItem('export_mca_token', result.token);
      byId('accountSessionReason').value = '';
      setSessionStatus('Sesiones anteriores revocadas correctamente.', true);
      await loadSessionTargets();
    } catch (error) {
      console.error('ACCOUNT_SESSION_REVOCATION_FAILED', error);
      setSessionStatus(safeAccountMessage(error, 'No se pudieron revocar las sesiones. Intenta nuevamente.'), false);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function bindAccountForms() {
    const passwordForm = byId('accountPasswordForm');
    if (passwordForm && passwordForm.dataset.bound !== 'true') {
      passwordForm.dataset.bound = 'true';
      passwordForm.addEventListener('submit', submitPassword);
    }
    const sessionForm = byId('accountSessionRevokeForm');
    if (sessionForm && sessionForm.dataset.bound !== 'true') {
      sessionForm.dataset.bound = 'true';
      sessionForm.addEventListener('submit', submitSessionRevocation);
    }
  }

  function updatePageTitle(sectionId) {
    if (sectionId !== 'accountSection') return;
    const title = byId('pageTitle');
    if (title) title.textContent = 'Mi cuenta';
  }

  function mount() {
    ensureAccountSection();
    ensureAdministrationNavigation();
    syncAccessUiState();
    bindAccountForms();

    window.addEventListener('export-mca:section-changed', event => {
      const id = event.detail?.id;
      updatePageTitle(id);
      if (id === 'accountSection') loadAccount().catch(error => {
        console.error('ACCOUNT_SECTION_REFRESH_FAILED', error);
        setStatus(safeAccountMessage(error, 'No se pudo actualizar la información de la cuenta.'), false);
      });
    });
    window.addEventListener('export-mca:navigation-shell-changed', syncAccessUiState);
    window.addEventListener('export-mca:admin-ready', syncAccessUiState);

    window.ExportMcaAccountAdministration = Object.freeze({
      owner: 'account-administration.js',
      refresh: loadAccount,
      syncNavigation: syncAccessUiState
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
