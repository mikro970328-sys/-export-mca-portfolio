(() => {
  if (window.__sectionStateInstalled) return;
  window.__sectionStateInstalled = true;

  const STORAGE_KEY = 'export_mca_current_section';
  const originalShowSection = window.showSection;
  if (typeof originalShowSection !== 'function') return;

  function getCurrentUser() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser) return currentUser;
    } catch {}
    return window.currentUser || null;
  }

  function sectionExists(id) {
    return Boolean(id && document.getElementById(id)?.classList.contains('app-section'));
  }

  function canOpen(id) {
    if (!sectionExists(id)) return false;
    const user = getCurrentUser();
    if (id === 'adminsSection' && user?.role !== 'master_admin') return false;
    if (id === 'workersSection' && user?.role !== 'master_admin') return false;
    return true;
  }

  function revealApp() {
    const appShell = document.getElementById('appShell');
    if (appShell) appShell.style.visibility = '';
    window.__sectionRestorePending = false;
  }

  window.showSection = function (id) {
    originalShowSection(id);
    if (canOpen(id)) localStorage.setItem(STORAGE_KEY, id);
  };

  function restoreSection(attempt = 0) {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved || saved === 'dashboardSection') {
      revealApp();
      return;
    }

    if (canOpen(saved)) {
      window.showSection(saved);
      revealApp();
      return;
    }

    if (attempt < 20) {
      setTimeout(() => restoreSection(attempt + 1), 50);
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    revealApp();
  }

  restoreSection();
})();