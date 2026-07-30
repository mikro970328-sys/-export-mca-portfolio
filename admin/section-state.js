(() => {
  if (window.__sectionStateInstalled) return;
  window.__sectionStateInstalled = true;

  const STORAGE_KEY = 'export_mca_current_section';
  const savedSection = localStorage.getItem(STORAGE_KEY) || 'dashboardSection';
  const originalShowSection = window.showSection;
  if (typeof originalShowSection !== 'function') return;

  const restrictedSections = new Set(['adminsSection', 'workersSection']);

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
    if (restrictedSections.has(id) && getCurrentUser()?.role !== 'master_admin') return false;
    return true;
  }

  function revealApp() {
    const appShell = document.getElementById('appShell');
    if (appShell) {
      appShell.style.visibility = '';
      appShell.style.opacity = '';
    }
    window.__sectionRestorePending = false;
  }

  function concealApp() {
    if (savedSection === 'dashboardSection') return;
    const appShell = document.getElementById('appShell');
    if (appShell) {
      appShell.style.visibility = 'hidden';
      appShell.style.opacity = '0';
    }
    window.__sectionRestorePending = true;
  }

  concealApp();

  window.showSection = function (id) {
    if (!id) return;
    originalShowSection(id);
    if (canOpen(id)) localStorage.setItem(STORAGE_KEY, id);
  };

  function restoreSection(attempt = 0) {
    const target = localStorage.getItem(STORAGE_KEY) || 'dashboardSection';

    if (canOpen(target)) {
      window.showSection(target);
      revealApp();
      return;
    }

    // Some sections, such as Registrar contenedor, are created after startup.
    if (attempt < 60) {
      setTimeout(() => restoreSection(attempt + 1), 25);
      return;
    }

    localStorage.setItem(STORAGE_KEY, 'dashboardSection');
    window.showSection('dashboardSection');
    revealApp();
  }

  restoreSection();
})();