(() => {
  if (window.__dashboardAlertCleanupInstalled) return;
  window.__dashboardAlertCleanupInstalled = true;

  const byId = id => document.getElementById(id);
  let refreshTimer = null;

  const style = document.createElement('style');
  style.id = 'dashboardAlertCleanupStyles';
  style.textContent = `
    #dashboardTrackingAlerts{display:none!important}
    #dashboardSection > .card:has(#alerts) .section-head{margin-bottom:14px}
    #alerts.dashboard-alert-list{grid-template-columns:1fr!important}
    @supports (padding-top: env(safe-area-inset-top)) {
      @media(max-width:900px){
        .topbar{height:calc(72px + env(safe-area-inset-top));padding-top:env(safe-area-inset-top);top:0}
        .alert-popover{top:calc(76px + env(safe-area-inset-top))!important}
      }
    }
    @media(max-width:520px){
      .topbar-actions{gap:6px;flex-shrink:0}
      .alert-bell{width:42px!important;height:42px!important}
      #pageTitle{font-size:17px;line-height:1.15;max-width:calc(100vw - 150px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
    }
  `;
  document.head.appendChild(style);

  function removeLegacyTrackingCard() {
    byId('dashboardTrackingAlerts')?.remove();
    byId('trackingAlertPopover')?.remove();
    byId('trackingAlertBell')?.remove();
    document.querySelectorAll('.tracking-alert-bell,.tracking-alert-popover,.dashboard-tracking-alerts').forEach(node => node.remove());
  }

  function legacyDashboardVisible() {
    const target = byId('alerts');
    if (!target) return false;
    return Boolean(target.querySelector('.alert')) || /Bienvenidas pendientes|Sin movimiento \+5 días|Mensajes fallidos|Esperando liberación/.test(target.textContent || '');
  }

  function restoreOperationalAlerts() {
    removeLegacyTrackingCard();
    if (!legacyDashboardVisible()) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (typeof window.loadOperationalAlerts === 'function') window.loadOperationalAlerts();
    }, 40);
  }

  function observeDashboard() {
    const dashboard = byId('dashboardSection');
    if (!dashboard) return;
    const observer = new MutationObserver(restoreOperationalAlerts);
    observer.observe(dashboard, { childList: true, subtree: true, characterData: true });
    restoreOperationalAlerts();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeDashboard);
  else observeDashboard();

  window.addEventListener('pageshow', () => setTimeout(restoreOperationalAlerts, 100));
})();
