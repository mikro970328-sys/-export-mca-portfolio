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
    document.head.appendChild(link);
  });

  const themePromise = loadStylesheet('/admin/platform-theme.css?v=20260816-1', 'data-platform-theme').catch(error => {
    console.error('[platform theme]', error);
    return false;
  });
  const navigationStylesPromise = loadStylesheet('/admin/navigation-shell.css?v=20260830-ux1', 'data-navigation-shell-style');
  const accessStylesPromise = loadStylesheet('/admin/access-control.css?v=20260830-p3', 'data-access-control-style');
  const iconSystemPromise = loadScript('/admin/ui-icon-system.js?v=20260817-e1', 'data-ui-icon-system');

  const accessCan = permission => window.ExportMcaAccessControl?.can?.(permission) !== false;

  const revealAdminShell = () => {
    document.getElementById('loginPage')?.classList.add('hidden');
    document.getElementById('appShell')?.classList.remove('hidden');
    root.classList.remove('admin-preparing');
    window.dispatchEvent(new CustomEvent('export-mca:admin-ready'));
  };

  const hydrateSecondaryModules = async () => {
    const tasks = [];

    if (accessCan('clients.read')) {
      tasks.push(loadScript('/admin/clients-module.js?v=20260830-ux2d', 'data-clients-module'));
    }
    if (accessCan('reports.read')) {
      tasks.push(loadScript('/admin/module-export-controls.js', 'data-module-export-controls'));
    }
    if (accessCan('notifications.read')) {
      let alertChain = loadScript('/admin/operational-alert-center.js?v=20260830-p9', 'data-operational-alert-center');
      if (accessCan('notifications.manage')) {
        alertChain = alertChain.then(() => loadScript('/admin/alert-phase2-stability.js?v=20260830-p9', 'data-alert-phase2-stability'));
      }
      const inboxChain = loadStylesheet('/admin/notification-inbox.css?v=20260830-p10', 'data-notification-inbox-style')
        .then(() => loadScript('/admin/notification-inbox.js?v=20260830-p10', 'data-notification-inbox'));
      tasks.push(Promise.all([alertChain,inboxChain]));
    }

    await Promise.all(tasks);
    window.dispatchEvent(new CustomEvent('export-mca:modules-ready'));
  };

  const bootAdminModules = () => {
    if (bootPromise) return bootPromise;
    if (booted || !restorePersistedSession()) return Promise.resolve(false);

    booted = true;
    root.classList.add('admin-preparing');
    removeLegacyAdminControls();

    bootPromise = (async () => {
      await accessStylesPromise;
      await loadScript('/admin/access-control-administration.js?v=20260830-p3', 'data-access-control-administration');
      if (!window.ExportMcaAccessControl?.initialize) throw new Error('El contexto de permisos no está disponible.');
      await window.ExportMcaAccessControl.initialize();

      if (accessCan('dashboard.read')) {
        await loadStylesheet('/admin/dashboard-executive.css?v=20260830-p11', 'data-dashboard-executive-style');
        await loadScript('/admin/dashboard-operational-state.js?v=20260830-p11', 'data-dashboard-operational-state');
      }
      if (accessCan('logistics.read')) {
        await loadScript('/admin/containers-module.js?v=20260830-ux2d', 'data-containers-module');
      }
      if (accessCan('logistics.write')) {
        await loadScript('/admin/registration-form-shell.js?v=20260817-uxc1', 'data-registration-form-shell');
        await loadScript('/admin/shipment-editor.js?v=20260817-importers1', 'data-shipment-editor');
      }
      await loadScript('/admin/modal-dismissal.js?v=20260817-uxc2', 'data-modal-dismissal');
      await themePromise;
      await iconSystemPromise;
      await loadScript('/admin/account-administration.js?v=20260830-p3', 'data-account-administration');
      await navigationStylesPromise;
      await loadScript('/admin/navigation-shell.js?v=20260830-p3', 'data-navigation-shell');

      if (accessCan('tasks.read')) {
        await loadStylesheet('/admin/tasks-workspace.css?v=20260830-p4', 'data-tasks-workspace-style');
        await loadScript('/admin/tasks-workspace.js?v=20260830-p4', 'data-tasks-workspace');
        await loadScript('/admin/tasks-navigation.js?v=20260830-p4', 'data-tasks-navigation');
        if (accessCan('tasks.manage')) {
          await loadStylesheet('/admin/workflow-route-settings.css?v=20260830-p5', 'data-workflow-route-settings-style');
          await loadScript('/admin/workflow-route-settings.js?v=20260830-p5', 'data-workflow-route-settings');
          await loadStylesheet('/admin/task-supervisor-queue.css?v=20260830-p8', 'data-task-supervisor-queue-style');
          await loadScript('/admin/task-supervisor-queue.js?v=20260830-p8', 'data-task-supervisor-queue');
        }
      }

      window.ExportMcaAccessControl?.applyNavigation?.();
      await loadScript('/admin/section-state.js?v=20260817-nav1', 'data-section-state');
      await loadScript('/admin/operational-navigation.js?v=20260830-ux2d', 'data-operational-navigation');
      window.ExportMcaAccessControl?.applyNavigation?.();

      if (typeof window.loadAll !== 'function') {
        throw new Error('El cargador inicial de datos no está disponible.');
      }

      await window.loadAll();

      if (accessCan('dashboard.read') && typeof window.initializeOperationalDashboard === 'function') {
        window.initializeOperationalDashboard();
      }

      revealAdminShell();

      hydrateSecondaryModules().catch(error => {
        console.error('[admin secondary modules]', error);
      });

      return true;
    })().catch(error => {
      console.error('[admin boot]', error);
      showLoginState();
      booted = false;
      bootPromise = null;
      return false;
    });

    return bootPromise;
  };

  const startAuthenticatedAdmin = async () => {
    root.classList.remove('auth-login', 'auth-pending');
    root.classList.add('auth-session', 'admin-preparing');

    if (!restorePersistedSession()) return false;
    return bootAdminModules();
  };

  window.startAuthenticatedAdmin = startAuthenticatedAdmin;

  const loginButton = document.getElementById('login');
  if (loginButton) {
    loginButton.onclick = async () => {
      try {
        const response = await api('/api/login', {
          method: 'POST',
          body: JSON.stringify({
            username: document.getElementById('username')?.value || '',
            password: document.getElementById('password')?.value || ''
          })
        });

        token = response.token;
        currentUser = response.user;
        localStorage.setItem('export_mca_token', token);
        localStorage.setItem('export_mca_user', JSON.stringify(currentUser));

        const started = await startAuthenticatedAdmin();
        if (!started) throw new Error('No se pudo iniciar la plataforma.');
      } catch (error) {
        note('loginMsg', error.message || 'No se pudo iniciar sesión.');
      }
    };
  }

  if (hasStoredSession) startAuthenticatedAdmin();
})();