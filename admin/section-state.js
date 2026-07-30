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
    if (id === 'adminsSection' && window.currentUser?.role !== 'master_admin') return false;
    if (id === 'workersSection' && window.currentUser?.role !== 'master_admin') return false;
    return true;
  }

  window.showSection = function (id) {
    originalShowSection(id);
    if (canOpen(id)) localStorage.setItem(STORAGE_KEY, id);
  };

  function restoreSection(attempt = 0) {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved || saved === 'dashboardSection') return;

    if (canOpen(saved)) {
      window.showSection(saved);
      return;
    }

    if (attempt < 20) {
      setTimeout(() => restoreSection(attempt + 1), 100);
    }
  }

  setTimeout(restoreSection, 0);
})();