// Stable admin loader. Authentication and module boot have one owner.
(() => {
  const root = document.documentElement;
  const hasStoredSession = Boolean(localStorage.getItem('export_mca_token'));
  const ACCESS_MANAGEMENT_KEYS = ['administration.users.manage','administration.roles.manage','administration.teams.manage'];

  if (hasStoredSession) root.classList.add('admin-preparing');

  let booted = false;
  let bootPromise = null;

  const decodeTokenPayload = tokenValue => {
    try {
      const part = String(tokenValue || '').split('.')[1];
      if (!part) return null;
      const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      return JSON.parse(decodeURIComponent(escape(atob(padded))));
    } catch {
      return null;
    }
  };

  const storedUserCan = (user, permission) => user?.role === 'master_admin' || (Array.isArray(user?.permissions) && user.permissions.includes(permission));
  const storedUserCanAny = (user, permissions) => user?.role === 'master_admin' || (permissions || []).some(permission => storedUserCan(user, permission));
  const storedRoleLabel = user => user?.role === 'master_admin' ? 'Administrador maestro' : user?.access_role?.name || 'Usuario';

  const showLoginState = () => {
    root.classList.remove('admin-preparing', 'auth-session', 'auth-pending');
    root.classList.add('auth-login');
    document.getElementById('loginPage')?.classList.remove('hidden');
    document.getElementById('appShell')?.classList.add('hidden');
  };

  const restorePersistedSession = () => {
    const storedToken = localStorage.getItem('export_mca_token') || '';
    if (!storedToken) return false;

    const payload = decodeTokenPayload(storedToken);
    if (!payload?.admin || !payload?.admin_id || !payload?.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
      localStorage.removeItem('export_mca_token');
      localStorage.removeItem('export_mca_user');
      showLoginState();
      return false;
    }

    let storedUser = null;
    try { storedUser = JSON.parse(localStorage.getItem('export_mca_user') || 'null'); }
    catch { storedUser = null; }

    if (!storedUser?.id || !storedUser?.username || !storedUser?.role) {
      storedUser = {
        id: payload.admin_id,
        username: payload.username || '',
        full_name: payload.full_name || '',
        role: payload.role || 'admin'
      };
      localStorage.setItem('export_mca_user', JSON.stringify(storedUser));
    }

    try {
      if (typeof token !== 'undefined') token = storedToken;
      if (typeof currentUser !== 'undefined') currentUser = storedUser;
    } catch {}

    root.classList.remove('auth-login', 'auth-pending');
    root.classList.add('auth-session');

    const loginPage = document.getElementById('loginPage');
    const appShell = document.getElementById('appShell');
    if (loginPage && appShell) {
      loginPage.classList.add('hidden');
      appShell.classList.add('hidden');
      const currentUserLabel = document.getElementById('currentUser');
      const currentRoleLabel = document.getElementById('currentRole');
      if (currentUserLabel) currentUserLabel.textContent = storedUser.username || '';
      if (currentRoleLabel) currentRoleLabel.textContent = storedRoleLabel(storedUser);
      document.getElementById('adminNav')?.classList.toggle('hidden', !storedUserCanAny(storedUser, ACCESS_MANAGEMENT_KEYS));
      const dashboardDate = document.getElementById('dashboardDate');
      if (dashboardDate) dashboardDate.textContent = new Date().toLocaleDateString('es-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }

    return true;
  };

  const removeLegacyAdminControls = () => {
    const waTestButton = document.getElementById('sendWaTest');
    const waTestCard = waTestButton?.closest('section.card');
    if (waTestCard) waTestCard.remove();

    document.getElementById('refresh')?.remove();
    document.getElementById('exportCsv')?.remove();
    document.getElementById('trackingAlertBell')?.remove();
    document.getElementById('trackingAlertPopover')?.remove();
    document.getElementById('dashboardTrackingAlerts')?.remove();
    document.querySelector('[data-section="newOperationsSection"]')?.remove();
  };

  const loadScript = (src, marker) => new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[${marker}]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') resolve();
      else {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
      }
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.setAttribute(marker, 'true');
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(script);
  });

  const loadStylesheet = (href, marker) => new Promise((resolve, reject) => {
    const existing = document.querySelector(`link[${marker}]`);
    if (existing) {
      if (existing.dataset.loaded === 'true' || existing.sheet) resolve();
      else {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
      }
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute(marker, 'true');
    link.onload = () => {
      link.dataset.loaded = 'true';
      resolve();
    };
    link.onerror = () => reject(new Error(`No se pudo cargar ${href}`));
    const nativeFoundation = document.querySelector('link[data-native-workspace-foundation]');
    if (nativeFoundation?.parentElement) nativeFoundation.parentElement.insertBefore(link, nativeFoundation);
    else document.head.appendChild(link);
  });

  const accessStylesPromise = loadStylesheet('/admin/access-control.css?v=20260926-business1', 'data-access-control-style');
  const iconSystemPromise = loadScript('/admin/ui-icon-system.js?v=20260926-help2', 'data-ui-icon-system');

  const accessCan = permission => window.ExportMcaAccessControl?.can?.(permission) !== false;

  const revealAdminShell = () => {
    document.getElementById('loginPage')?.classList.add('hidden');
    document.getElementById('appShell')?.classList.remove('hidden');
    root.classList.remove('admin-preparing');
    window.dispatchEvent(new CustomEvent('export-mca:admin-ready'));
  };

  const buttonAvailable = id => {
    const button = document.querySelector(`[data-section="${id}"]`);
    return Boolean(button && !button.hidden && !button.classList.contains('hidden') && !button.disabled);
  };

  const ensureVisibleSection = () => {
    const visible = [...document.querySelectorAll('.app-section')].find(section => !section.classList.contains('hidden') && buttonAvailable(section.id));
    if (visible) return visible.id;
    const saved = localStorage.getItem('export_mca_current_section');
    const firstAllowed = window.ExportMcaAccessControl?.firstAllowedSection?.();
    const candidates = [
      saved,
      firstAllowed,
      accessCan('dashboard.read') ? 'dashboardSection' : null,
      // Help is available before lazy operational sections exist. Only open it
      // when explicitly saved/selected; an automatic fallback here would replace
      // the saved business route before navigation-shell can restore it.
      ...[...document.querySelectorAll('[data-section]')].map(button => button.dataset.section).filter(id => id !== 'helpSection')
    ].filter(Boolean);
    for (const id of [...new Set(candidates)]) {
      const section = document.getElementById(id);
      if (!section?.classList.contains('app-section') || !buttonAvailable(id)) continue;
      if (typeof window.showSection === 'function' && window.showSection(id, { source:'startup' }) !== false) return id;
    }
    return null;
  };

  const hydrateSecondaryModules = async () => {
    const tasks = [];

    if (accessCan('clients.read')) {
      tasks.push(
        loadStylesheet('/admin/clients-module.css?v=20260927-clients1', 'data-clients-module-style')
          .then(() => loadScript('/admin/clients-module.js?v=20260927-clients1', 'data-clients-module'))
      );
    }
    if (accessCan('administration.workers.read')) {
      tasks.push(
        loadStylesheet('/admin/workers-module.css?v=20260927-feedback1', 'data-workers-module-style')
          .then(() => loadScript('/admin/workers-module.js?v=20260927-simple1', 'data-workers-module'))
      );
    }
    if (accessCan('reports.read')) {
      tasks.push(loadScript('/admin/module-export-controls.js', 'data-module-export-controls'));
    }
    if (accessCan('notifications.read')) {
      let alertChain = loadStylesheet('/admin/operational-alert-center.css?v=20260926-figma2', 'data-operational-alert-center-style')
        .then(() => loadScript('/admin/operational-alert-center.js?v=20260926-figma2', 'data-operational-alert-center'));
      if (accessCan('notifications.manage')) {
        alertChain = alertChain.then(() => loadScript('/admin/alert-phase2-stability.js?v=20260903-b10push1', 'data-alert-phase2-stability'));
      }
      const inboxChain = Promise.all([
        loadStylesheet('/admin/notification-inbox.css?v=20260926-figma2', 'data-notification-inbox-style'),
        loadStylesheet('/admin/push-notifications.css?v=20260926-figma2', 'data-push-notifications-style')
      ]).then(() => loadScript('/admin/notification-inbox.js?v=20260926-figma2', 'data-notification-inbox'));
      tasks.push(Promise.all([alertChain,inboxChain]));
    }

    await Promise.all(tasks);
    window.dispatchEvent(new CustomEvent('export-mca:modules-ready'));
  };

  const bootAdminModules = () => {
    if (bootPromise) return bootPromise;
    if (booted || !restorePersistedSession