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

  const accessStylesPromise = loadStylesheet('/admin/access-control.css?v=20260902-ux6access1', 'data-access-control-style');
  const iconSystemPromise = loadScript('/admin/ui-icon-system.js?v=20260817-e1', 'data-ui-icon-system');

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
      ...[...document.querySelectorAll('[data-section]')].map(button => button.dataset.section)
    ].filter(Boolean);
    for (const id of [...new Set(candidates)]) {
      const section = document.getElementById(id);
      if (!section?.classList.contains('app-section') || !buttonAvailable(id)) continue;
      if (typeof window.showSection === 'function' && window.showSection(id) !== false) return id;
    }
    return null;
  };

  const hydrateSecondaryModules = async () => {
    const tasks = [];

    if (accessCan('clients.read')) {
      tasks.push(
        loadStylesheet('/admin/clients-module.css?v=20260902-ux7clients1', 'data-clients-module-style')
          .then(() => loadScript('/admin/clients-module.js?v=20260902-ux7clients1', 'data-clients-module'))
      );
    }
    if (accessCan('administration.workers.read')) {
      tasks.push(
        loadStylesheet('/admin/workers-module.css?v=20260902-ux6owner1', 'data-workers-module-style')
          .then(() => loadScript('/admin/workers-module.js?v=20260902-ux6owner1', 'data-workers-module'))
      );
    }
    if (accessCan('reports.read')) {
      tasks.push(loadScript('/admin/module-export-controls.js', 'data-module-export-controls'));
    }
    if (accessCan('notifications.read')) {
      let alertChain = loadStylesheet('/admin/operational-alert-center.css?v=20260902-ux6alerts2', 'data-operational-alert-center-style')
        .then(() => loadScript('/admin/operational-alert-center.js?v=20260902-ux6alerts2', 'data-operational-alert-center'));
      if (accessCan('notifications.manage')) {
        alertChain = alertChain.then(() => loadScript('/admin/alert-phase2-stability.js?v=20260830-p9', 'data-alert-phase2-stability'));
      }
      const inboxChain = loadStylesheet('/admin/notification-inbox.css?v=20260902-ux6inbox1', 'data-notification-inbox-style')
        .then(() => loadScript('/admin/notification-inbox.js?v=20260902-ux6inbox1', 'data-notification-inbox'));
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
    let authenticatedShellReady = false;

    bootPromise = (async () => {
      await accessStylesPromise;
      await loadScript('/admin/access-control-administration.js?v=20260902-ux6access1', 'data-access-control-administration');
      if (!window.ExportMcaAccessControl?.initialize) throw new Error('El contexto de permisos no está disponible.');
      await window.ExportMcaAccessControl.initialize();
      window.ExportMcaAccessControl?.applyNavigation?.();

      ensureVisibleSection();
      revealAdminShell();
      authenticatedShellReady = true;

      if (accessCan('dashboard.read')) {
        await loadStylesheet('/admin/dashboard-executive.css?v=20260902-ux7shell1', 'data-dashboard-executive-style');
        await loadScript('/admin/dashboard-operational-state.js?v=20260902-greeting1', 'data-dashboard-operational-state');
      }
      if (accessCan('logistics.read')) {
        await loadStylesheet('/admin/containers-module.css?v=20260903-ux7tracking2', 'data-containers-module-style');
        await loadScript('/admin/containers-module.js?v=20260903-ux7tracking2', 'data-containers-module');
      }
      if (accessCan('logistics.write')) {
        await loadStylesheet('/admin/shipment-editor.css?v=20260903-ux7tracking2', 'data-shipment-editor-style');
        await loadScript('/admin/shipment-editor.js?v=20260903-ux7tracking2', 'data-shipment-editor');
      }
      await loadScript('/admin/modal-dismissal.js?v=20260902-ux6c1', 'data-modal-dismissal');
      await iconSystemPromise;
      await loadStylesheet('/admin/account-administration.css?v=20260901-ux6style1', 'data-account-administration-style');
      await loadScript('/admin/account-administration.js?v=20260902-ux6b1', 'data-account-administration');
      await loadScript('/admin/navigation-shell.js?v=20260902-ux7shell1', 'data-navigation-shell');

      if (accessCan('tasks.read')) {
        await loadStylesheet('/admin/tasks-workspace.css?v=20260902-ux6tasks1', 'data-tasks-workspace-style');
        await loadScript('/admin/tasks-workspace.js?v=20260902-ux6tasks1', 'data-tasks-workspace');
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
      await loadScript('/admin/ap-traceability.js?v=20260903-ux7payables1', 'data-ap-traceability');
      await loadScript('/admin/admin-data-loader.js?v=20260830-hotfix2', 'data-admin-data-loader');
      window.ExportMcaAccessControl?.applyNavigation?.();
      ensureVisibleSection();

      if (!window.ExportMcaAdminData?.loadCore) {
        throw new Error('El cargador inicial de datos no está disponible.');
      }

      const coreResult = await window.ExportMcaAdminData.loadCore();
      if (coreResult?.errors?.length) console.warn('[admin boot] core data degraded', coreResult.errors);

      if (accessCan('dashboard.read') && typeof window.initializeOperationalDashboard === 'function') {
        window.initializeOperationalDashboard();
      }

      if (accessCan('dashboard.read')) {
        window.ExportMcaAdminData.loadDashboard().catch(error => {
          console.error('[admin dashboard]', error);
        });
      }

      hydrateSecondaryModules().catch(error => {
        console.error('[admin secondary modules]', error);
      });

      return true;
    })().catch(error => {
      console.error('[admin boot]', error);
      root.classList.remove('admin-preparing');
      booted = false;
      bootPromise = null;
      if (!authenticatedShellReady) {
        showLoginState();
        return false;
      }
      window.dispatchEvent(new CustomEvent('export-mca:admin-degraded', { detail:{ message:String(error?.message || 'Módulo no disponible') } }));
      ensureVisibleSection();
      return true;
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
