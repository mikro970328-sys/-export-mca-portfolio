(() => {
  if (window.__alertPhase2StabilityInstalled) return;
  window.__alertPhase2StabilityInstalled = true;

  const CHECK_INTERVAL = 5 * 60 * 1000;
  const MIN_CHECK_GAP = 60 * 1000;
  let checkPromise = null;
  let lastCheckAt = 0;
  let timer = null;

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
    timer = setInterval(() => {
      if (!document.hidden) runOperationalCheck(false);
    }, CHECK_INTERVAL);
  }

  async function mount() {
    await waitFor(() => typeof window.api === 'function' && typeof window.loadNotifications === 'function');
    await runOperationalCheck(true);
    schedule();

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) runOperationalCheck(false);
    });
    window.addEventListener('online', () => runOperationalCheck(true));
    window.addEventListener('focus', () => runOperationalCheck(false));
  }

  window.runOperationalAlertCheck = () => runOperationalCheck(true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();