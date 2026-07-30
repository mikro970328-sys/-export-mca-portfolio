(() => {
  if (window.__separateContainerTrackingInstalled) return;
  window.__separateContainerTrackingInstalled = true;

  function install() {
    const trackingSection = document.getElementById('containersSection');
    const main = trackingSection?.parentElement;
    const grid = trackingSection?.querySelector('.grid');
    const cards = grid ? Array.from(grid.children).filter(el => el.matches('section.card')) : [];
    if (!trackingSection || !main || cards.length < 2) return false;

    const registerCard = cards[0];
    const trackingCard = cards[1];

    let registerSection = document.getElementById('registerContainerSection');
    if (!registerSection) {
      registerSection = document.createElement('section');
      registerSection.id = 'registerContainerSection';
      registerSection.className = 'app-section hidden';
      registerSection.appendChild(registerCard);
      main.insertBefore(registerSection, trackingSection);
    }

    if (grid.parentElement === trackingSection) {
      trackingSection.appendChild(trackingCard);
      grid.remove();
    }

    const trackingHeading = trackingCard.querySelector('h2');
    if (trackingHeading) trackingHeading.textContent = 'Tracking';

    const oldNav = document.querySelector('[data-section="containersSection"]');
    if (oldNav) {
      oldNav.textContent = 'Tracking';
      if (!document.querySelector('[data-section="registerContainerSection"]')) {
        const registerNav = document.createElement('button');
        registerNav.type = 'button';
        registerNav.dataset.section = 'registerContainerSection';
        registerNav.textContent = 'Registrar contenedor';
        oldNav.parentElement.insertBefore(registerNav, oldNav);
        registerNav.addEventListener('click', () => {
          if (typeof window.showSection === 'function') window.showSection('registerContainerSection');
        });
      }
    }

    document.querySelectorAll('[onclick*="showSection(\'containersSection\')"]').forEach(el => {
      if (/ver contenedores/i.test(el.textContent || '')) el.textContent = 'Ver tracking';
    });

    return true;
  }

  if (!install()) {
    const observer = new MutationObserver(() => {
      if (install()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
