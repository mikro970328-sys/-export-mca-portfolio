(() => {
  if (window.__sectionStateInstalled) return;
  window.__sectionStateInstalled = true;

  const STORAGE_KEY = 'export_mca_current_section';
  const originalShowSection = window.showSection;
  if (typeof originalShowSection !== 'function') return;

  function sectionExists(id) {
    return Boolean(id && document.getElementById(id)?.classList.contains('app-section'));
  }

  function canOpen(id) {
    if (!sectionExists(id)) return false;
    const accessControl = window.ExportMcaAccessControl;
    return typeof accessControl?.sectionAllowed === 'function' ? accessControl.sectionAllowed(id) : true;
  }

  function revealApp() {
    const appShell = document.getElementById('appShell');
    if (appShell) {
      appShell.style.removeProperty('display');
      appShell.style.visibility = '';
    }
    document.documentElement.style.visibility = '';
    window.__sectionRestorePending = false;
  }

  function refreshSectionOwner(id) {
    if (id !== 'dashboardSection') return;
    if (typeof window.initializeOperationalDashboard === 'function') {
      window.initializeOperationalDashboard();
    }
  }

  window.showSection = function (id) {
    if (!canOpen(id)) return false;
    originalShowSection(id);
    refreshSectionOwner(id);
    localStorage.setItem(STORAGE_KEY, id);
    window.dispatchEvent(new CustomEvent('export-mca:section-changed', { detail: { id } }));
    return true;
  };

  function restoreSection() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved || saved === 'dashboardSection') {
      window.showSection('dashboardSection');
      revealApp();
      return;
    }

    if (canOpen(saved)) {
      window.showSection(saved);
      requestAnimationFrame(() => requestAnimationFrame(revealApp));
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    window.showSection('dashboardSection');
    requestAnimationFrame(revealApp);
  }

  restoreSection();
})();
