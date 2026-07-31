// Stable admin loader. The login remains isolated until authentication.
(() => {
  const root = document.documentElement;
  const hasStoredSession = Boolean(localStorage.getItem('export_mca_token'));

  if (hasStoredSession) root.classList.add('admin-preparing');

  const style = document.createElement('style');
  style.id = 'loginViewportStability';
  style.textContent = `
    html.admin-preparing #appShell {
      display: none !important;
    }
    #loginPage.login-page {
      min-height: 100vh;
      min-height: 100svh;
      height: 100svh;
      overflow-y: auto;
      overscroll-behavior: none;
      align-items: center;
      justify-items: center;
      padding-top: max(24px, env(safe-area-inset-top));
      padding-right: max(20px, env(safe-area-inset-right));
      padding-bottom: max(24px, env(safe-area-inset-bottom));
      padding-left: max(20px, env(safe-area-inset-left));
    }
    #loginCard.login-card {
      transform: translateZ(0);
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
      contain: layout paint;
    }
  `;
  if (!document.getElementById(style.id)) document.head.appendChild(style);

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

  const restorePersistedSession = () => {
    const storedToken = localStorage.getItem('export_mca_token') || '';
    if (!storedToken) return false;

    const payload = decodeTokenPayload(storedToken);
    if (!payload?.admin || !payload?.admin_id || !payload?.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
      localStorage.removeItem('export_mca_token');
      localStorage.removeItem('export_mca_user');
      root.classList.remove('admin-preparing', 'auth-session', 'auth-pending');
      root.classList.add('auth-login');
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
      if (currentRoleLabel) currentRoleLabel.textContent = storedUser.role === 'master_admin' ? 'Administrador maestro' : 'Administrador';
      document.getElementById('adminNav')?.classList.toggle('hidden', storedUser.role !== 'master_admin');
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

  const revealAdminShell = async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const loginPage = document.getElementById('loginPage');
    const appShell = document.getElementById('appShell');
    loginPage?.classList.add('hidden');
    appShell?.classList.remove('hidden');
    root.classList.remove('admin-preparing');
    window.dispatchEvent(new CustomEvent('export-mca:admin-ready'));
  };

  const bootAdminModules = () => {
    if (bootPromise) return bootPromise;
    if (booted || !restorePersistedSession()) return Promise.resolve(false);

    booted = true;
    root.classList.add('admin-preparing');
    removeLegacyAdminControls();

    bootPromise = (async () => {
      const independentModules = [
        loadScript('/admin/mobile-interaction-core.js?v=20260730-5', 'data-mobile-interaction-core'),
        loadScript('/admin/dashboard-operational-state.js?v=20260730-2', 'data-dashboard-operational-state')
      ];

      await loadScript('/admin/erp-core.js?v=20260730-sessionfix1', 'data-erp-core');

      const clientsModule = loadScript('/admin/clients-module.js?v=20260731-3', 'data-clients-module');

      const sectionChain = loadScript('/admin/separate-container-tracking.js', 'data-separate-container-tracking')
        .then(() => loadScript('/admin/section-state.js?v=20260730-sessionfix1', 'data-section-state'));

      const alertChain = loadScript('/admin/operational-alert-center.js?v=20260730-2', 'data-operational-alert-center')
        .then(() => loadScript('/admin/alert-phase2-stability.js?v=20260730-1', 'data-alert-phase2-stability'));

      const trackingChain = loadScript('/admin/tracking-fallback.js', 'data-tracking-fallback')
        .then(() => loadScript('/admin/manual-tracking-switch.js', 'data-manual-tracking-switch'))
        .then(() => loadScript('/admin/shipment-actions-menu.js', 'data-shipment-actions-menu'))
        .then(() => loadScript('/admin/shipment-row-details.js', 'data-shipment-row-details'));

      await Promise.all([
        ...independentModules,
        clientsModule,
        sectionChain,
        loadScript('/admin/responsive-columns-control.js', 'data-responsive-columns-control'),
        loadScript('/admin/module-export-controls.js', 'data-module-export-controls'),
        alertChain,
        trackingChain
      ]);

      await revealAdminShell();
      return true;
    })().catch(error => {
      console.error('[admin boot]', error);
      root.classList.remove('admin-preparing', 'auth-session', 'auth-pending');
      root.classList.add('auth-login');
      const loginPage = document.getElementById('loginPage');
      const appShell = document.getElementById('appShell');
      loginPage?.classList.remove('hidden');
      appShell?.classList.add('hidden');
      booted = false;
      bootPromise = null;
      return false;
    });

    return bootPromise;
  };

  restorePersistedSession();
  bootAdminModules();

  const authWatcher = window.setInterval(() => {
    if (!localStorage.getItem('export_mca_token')) return;
    window.clearInterval(authWatcher);
    root.classList.add('admin-preparing');
    restorePersistedSession();
    bootAdminModules();
  }, 250);
})();
