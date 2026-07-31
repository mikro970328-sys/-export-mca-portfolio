// Stable admin loader. The login remains isolated until authentication.
(() => {
  const style = document.createElement('style');
  style.id = 'loginViewportStability';
  style.textContent = `
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

  const decodeTokenPayload = token => {
    try {
      const part = String(token || '').split('.')[1];
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

    const loginPage = document.getElementById('loginPage');
    const appShell = document.getElementById('appShell');
    if (loginPage && appShell) {
      loginPage.classList.add('hidden');
      appShell.classList.remove('hidden');
      document.getElementById('currentUser').textContent = storedUser.username || '';
      document.getElementById('currentRole').textContent = storedUser.role === 'master_admin' ? 'Administrador maestro' : 'Administrador';
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

  const loadScript = (src, marker, onload) => {
    if (document.querySelector(`script[${marker}]`)) return onload?.();
    const script = document.createElement('script');
    script.src = src;
    script.setAttribute(marker, 'true');
    script.onload = () => onload?.();
    document.head.appendChild(script);
  };

  const bootAdminModules = () => {
    if (booted || !restorePersistedSession()) return;
    booted = true;

    removeLegacyAdminControls();

    loadScript('/admin/mobile-interaction-core.js?v=20260730-5', 'data-mobile-interaction-core');
    loadScript('/admin/dashboard-operational-state.js?v=20260730-2', 'data-dashboard-operational-state');

    loadScript('/admin/erp-core.js?v=20260730-sessionfix1', 'data-erp-core', () => {
      loadScript('/admin/workers-module.js?v=20260730-sessionfix1', 'data-workers-module', () => {
        loadScript('/admin/workers-responsive.js', 'data-workers-responsive');
        loadScript('/admin/workers-actions-menu.js', 'data-workers-actions-menu');
      });

      loadScript('/admin/clients-module.js?v=20260731-3', 'data-clients-module');

      loadScript('/admin/separate-container-tracking.js', 'data-separate-container-tracking', () => {
        loadScript('/admin/section-state.js?v=20260730-sessionfix1', 'data-section-state');
      });

      loadScript('/admin/responsive-columns-control.js', 'data-responsive-columns-control');
      loadScript('/admin/module-export-controls.js', 'data-module-export-controls');

      loadScript('/admin/operational-alert-center.js?v=20260730-2', 'data-operational-alert-center', () => {
        loadScript('/admin/alert-phase2-stability.js?v=20260730-1', 'data-alert-phase2-stability');
      });

      loadScript('/admin/tracking-fallback.js', 'data-tracking-fallback', () => {
        loadScript('/admin/manual-tracking-switch.js', 'data-manual-tracking-switch', () => {
          loadScript('/admin/shipment-actions-menu.js', 'data-shipment-actions-menu', () => {
            loadScript('/admin/shipment-row-details.js', 'data-shipment-row-details');
          });
        });
      });
    });
  };

  restorePersistedSession();
  bootAdminModules();

  const authWatcher = window.setInterval(() => {
    if (!localStorage.getItem('export_mca_token')) return;
    window.clearInterval(authWatcher);
    restorePersistedSession();
    bootAdminModules();
  }, 250);
})();
