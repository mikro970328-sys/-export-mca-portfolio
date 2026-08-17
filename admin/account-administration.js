(() => {
  'use strict';

  if (window.__accountAdministrationInstalled) return;
  window.__accountAdministrationInstalled = true;

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  function getCurrentUser() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser) return currentUser;
    } catch {}
    try { return JSON.parse(localStorage.getItem('export_mca_user') || 'null'); }
    catch { return null; }
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
    if (!response.ok) throw new Error(data.error || data.details || 'Error');
    return data;
  }

  function installStyles() {
    if (byId('accountAdministrationStyles')) return;
    const style = document.createElement('style');
    style.id = 'accountAdministrationStyles';
    style.textContent = `
      .account-layout{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:18px}
      .account-card h2{margin-top:0;color:var(--navy)}
      .account-card h3{margin:0 0 4px;color:var(--navy)}
      .account-intro{color:var(--muted);font-size:13px;line-height:1.5;margin-bottom:18px}
      .account-profile{display:grid;gap:12px}
      .account-field{padding:12px 0;border-bottom:1px solid var(--line)}
      .account-field:last-child{border-bottom:0}
      .account-field-label{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:5px}
      .account-field-value{font-size:15px;font-weight:800;color:var(--text);word-break:break-word}
      .account-role-pill{display:inline-flex;align-items:center;padding:6px 9px;border-radius:999px;background:#edf3ff;color:var(--navy);font-size:12px;font-weight:900}
      .account-security-form{max-width:520px}
      .account-security-form .account-help{font-size:11px;color:var(--muted);margin-top:5px;line-height:1.45}
      .account-security-actions{display:flex;gap:8px;align-items:center;margin-top:16px;flex-wrap:wrap}
      .account-security-actions button{min-width:180px}
      .account-security-status{font-size:12px;margin-top:10px;min-height:18px}
      .sidebar-foot .sidebar-user{margin-bottom:10px}
      .sidebar-foot #logout{width:100%;display:flex;align-items:center;justify-content:center;gap:9px}
      body.sidebar-collapsed .sidebar-foot #logout .nav-label{display:none}
      body.sidebar-collapsed .sidebar-foot #logout{width:42px;min-width:42px;height:42px;padding:0;margin-inline:auto}
      @media(max-width:760px){.account-layout{grid-template-columns:1fr}.account-security-actions button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function ensureAccountSection() {
    let section = byId('accountSection');
    if (section) return section;

    section = document.createElement('section');
    section.id = 'accountSection';
    section.className = 'app-section hidden';
    section.dataset.accountOwner = 'account-administration.js';
    section.innerHTML = `
      <div class="account-layout">
        <section class="card account-card">
          <h2>Mi cuenta</h2>
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

    const user = getCurrentUser();
    const adminsButton = submenu.querySelector('[data-section="adminsSection"]');
    adminsButton?.classList.toggle('hidden', user?.role !== 'master_admin');

    accountButton.onclick = event => {
      event.preventDefault();
      if (typeof window.showSection === 'function') window.showSection('accountSection');
      updatePageTitle('accountSection');
      loadAccount().catch(error => setStatus(error.message, false));
    };
  }

  function cleanSidebarFooter() {
    byId('changeOwnPassword')?.remove();
  }

  function roleLabel(role) {
    return role === 'master_admin' ? 'Administrador maestro' : role === 'admin' ? 'Administrador' : String(role || 'Usuario');
  }

  function renderAccount(account) {
    const target = byId('accountProfile');
    if (!target) return;
    const changed = account?.password_changed_at ? new Date(account.password_changed_at) : null;
    const lastLogin = account?.last_login_at ? new Date(account.last_login_at) : null;
    target.innerHTML = `
      <div class="account-field"><div class="account-field-label">Nombre</div><div class="account-field-value">${esc(account?.full_name || 'Sin registrar')}</div></div>
      <div class="account-field"><div class="account-field-label">Usuario</div><div class="account-field-value">${esc(account?.username || '—')}</div></div>
      <div class="account-field"><div class="account-field-label">Rol</div><div class="account-field-value"><span class="account-role-pill">${esc(roleLabel(account?.role))}</span></div></div>
      <div class="account-field"><div class="account-field-label">Último acceso</div><div class="account-field-value">${lastLogin && !Number.isNaN(lastLogin.getTime()) ? esc(lastLogin.toLocaleString('es-US')) : 'No disponible'}</div></div>
      <div class="account-field"><div class="account-field-label">Último cambio de contraseña</div><div class="account-field-value">${changed && !Number.isNaN(changed.getTime()) ? esc(changed.toLocaleString('es-US')) : 'No disponible'}</div></div>`;
  }

  async function loadAccount() {
    const result = await request('/api/account');
    renderAccount(result.account || {});
    return result.account || {};
  }

  function setStatus(message, ok) {
    const target = byId('accountPasswordStatus');
    if (!target) return;
    target.textContent = message || '';
    target.className = `account-security-status ${message ? (ok ? 'ok' : 'bad') : ''}`;
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
      await request('/api/account', {
        method: 'PATCH',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
      });
      event.currentTarget.reset();
      setStatus('Contraseña actualizada correctamente.', true);
      await loadAccount();
    } catch (error) {
      setStatus(error.message || 'No se pudo actualizar la contraseña.', false);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function bindAccountForm() {
    const form = byId('accountPasswordForm');
    if (!form || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';
    form.addEventListener('submit', submitPassword);
  }

  function updatePageTitle(sectionId) {
    if (sectionId !== 'accountSection') return;
    const title = byId('pageTitle');
    if (title) title.textContent = 'Mi cuenta';
  }

  function mount() {
    installStyles();
    ensureAccountSection();
    ensureAdministrationNavigation();
    cleanSidebarFooter();
    bindAccountForm();

    window.addEventListener('export-mca:section-changed', event => {
      const id = event.detail?.id;
      updatePageTitle(id);
      if (id === 'accountSection') loadAccount().catch(error => setStatus(error.message, false));
    });

    window.ExportMcaAccountAdministration = Object.freeze({
      owner: 'account-administration.js',
      refresh: loadAccount
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
