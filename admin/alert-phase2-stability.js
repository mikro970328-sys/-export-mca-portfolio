(() => {
  if (window.__alertPhase2StabilityInstalled) return;
  window.__alertPhase2StabilityInstalled = true;

  const CHECK_INTERVAL = 5 * 60 * 1000;
  const MIN_CHECK_GAP = 60 * 1000;
  let checkPromise = null;
  let lastCheckAt = 0;
  let timer = null;
  let active = false;

  const hasSession = () => active && Boolean(localStorage.getItem('export_mca_token')) && document.documentElement.classList.contains('auth-session');

  function stop() {
    active = false;
    clearInterval(timer);
    timer = null;
  }

  const waitFor = (test, timeout = 12000) => new Promise(resolve => {
    const started = Date.now();
    const tick = () => {
      const value = test();
      if (value) return resolve(value);
      if (Date.now() - started >= timeout) return resolve(null);
      setTimeout(tick, 100);
    };
    tick();
  });

  async function runOperationalCheck(force = false) {
    if (!hasSession()) return null;
    if (!navigator.onLine) return null;
    if (!force && Date.now() - lastCheckAt < MIN_CHECK_GAP) return null;
    if (checkPromise) return checkPromise;

    checkPromise = (async () => {
      try {
        lastCheckAt = Date.now();
        if (typeof window.api !== 'function') return null;
        const result = await window.api('/api/tracking-alerts?action=check');
        if (typeof window.loadNotifications === 'function') {
          await window.loadNotifications();
        }
        window.__lastOperationalAlertCheck = {
          ok: true,
          at: new Date().toISOString(),
          result
        };
        return result;
      } catch (error) {
        if (Number(error?.status) === 401 || error?.authTransition === true || !localStorage.getItem('export_mca_token')) {
          stop();
          window.__lastOperationalAlertCheck = {
            ok: false,
            auth_transition: true,
            at: new Date().toISOString()
          };
          return null;
        }
        console.error('ALERT_PHASE2_CHECK_ERROR', error);
        window.__lastOperationalAlertCheck = {
          ok: false,
          at: new Date().toISOString(),
          error: error?.message || String(error)
        };
        return null;
      } finally {
        checkPromise = null;
      }
    })();

    return checkPromise;
  }

  function schedule() {
    clearInterval(timer);
    if (!hasSession()) return;
    timer = setInterval(() => {
      if (!document.hidden && hasSession()) runOperationalCheck(false);
    }, CHECK_INTERVAL);
  }

  async function resume() {
    if (!localStorage.getItem('export_mca_token')) return false;
    active = true;
    await waitFor(() => typeof window.api === 'function' && typeof window.loadNotifications === 'function');
    if (!hasSession()) return false;
    await runOperationalCheck(true);
    schedule();
    return true;
  }

  async function mount() {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && hasSession()) runOperationalCheck(false);
    });
    window.addEventListener('online', () => hasSession() && runOperationalCheck(true));
    window.addEventListener('focus', () => hasSession() && runOperationalCheck(false));
    window.addEventListener('export-mca:session-ending', stop);
    window.addEventListener('export-mca:auth-invalid', stop);
    window.addEventListener('export-mca:admin-ready', () => resume());
    await resume();
  }

  window.runOperationalAlertCheck = () => runOperationalCheck(true);
  window.AlertPhase2Stability = Object.freeze({
    owner:'alert-phase2-stability.js',
    stop,
    resume,
    isScheduled:() => Boolean(timer) && hasSession()
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
