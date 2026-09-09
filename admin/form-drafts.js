(() => {
  'use strict';

  if (window.ExportMcaDrafts) return;

  const STORAGE_PREFIX = 'export_mca_form_draft_v1';
  const RECORD_VERSION = 1;
  const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const DEFAULT_DEBOUNCE_MS = 700;
  const MAX_RECORD_BYTES = 180000;
  const MAX_FIELD_LENGTH = 20000;
  const instances = new Set();
  const byRoot = new WeakMap();

  const clone = value => {
    try { return JSON.parse(JSON.stringify(value)); }
    catch { return null; }
  };

  const comparable = value => {
    try { return JSON.stringify(value); }
    catch { return ''; }
  };

  function currentUserKey() {
    try {
      const user = JSON.parse(localStorage.getItem('export_mca_user') || 'null');
      const identity = user?.id || user?.admin_id || user?.username;
      return identity ? encodeURIComponent(String(identity)) : '';
    } catch {
      return '';
    }
  }

  function recordKey(scope) {
    const user = currentUserKey();
    const cleanScope = String(scope || '').trim();
    return user && cleanScope ? `${STORAGE_PREFIX}:${user}:${encodeURIComponent(cleanScope)}` : '';
  }

  function eligibleControl(control) {
    if (!(control instanceof HTMLElement) || control.disabled || control.dataset.draftIgnore !== undefined) return false;
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(control.tagName)) return false;
    const type = String(control.type || '').toLowerCase();
    if (['button', 'submit', 'reset', 'file', 'password', 'hidden'].includes(type)) return false;
    if (/password|passwd|secret|token|one.?time|otp|cvv|card.?number/i.test(`${control.id || ''} ${control.name || ''} ${control.autocomplete || ''}`)) return false;
    return true;
  }

  function controlKey(root, control, index) {
    if (control.dataset.draftField) return `field:${control.dataset.draftField}`;
    if (control.id) return `id:${control.id}`;
    if (control.name) {
      const peers = [...root.querySelectorAll('[name]')].filter(item => eligibleControl(item) && item.name === control.name);
      return `name:${control.name}:${Math.max(0, peers.indexOf(control))}`;
    }
    return `control:${index}`;
  }

  function controlValue(control) {
    const type = String(control.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return Boolean(control.checked);
    if (control instanceof HTMLSelectElement && control.multiple) {
      return [...control.selectedOptions].map(option => String(option.value).slice(0, MAX_FIELD_LENGTH));
    }
    return String(control.value ?? '').slice(0, MAX_FIELD_LENGTH);
  }

  function captureControls(root) {
    const controls = [...root.querySelectorAll('input,select,textarea')].filter(eligibleControl);
    return {
      fields: controls.map((control, index) => ({
        key:controlKey(root, control, index),
        type:String(control.type || control.tagName).toLowerCase(),
        value:controlValue(control)
      }))
    };
  }

  function setControlValue(control, value) {
    const type = String(control.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      control.checked = value === true;
      return;
    }
    if (control instanceof HTMLSelectElement && control.multiple && Array.isArray(value)) {
      const selected = new Set(value.map(String));
      [...control.options].forEach(option => { option.selected = selected.has(String(option.value)); });
      return;
    }
    control.value = value == null ? '' : String(value);
  }

  async function restoreControls(root, data) {
    const saved = new Map((Array.isArray(data?.fields) ? data.fields : []).map(field => [field.key, field]));
    const apply = dispatch => {
      const controls = [...root.querySelectorAll('input,select,textarea')].filter(eligibleControl);
      controls.forEach((control, index) => {
        const field = saved.get(controlKey(root, control, index));
        if (!field) return;
        setControlValue(control, field.value);
        if (!dispatch) return;
        const eventName = control instanceof HTMLSelectElement || ['checkbox', 'radio'].includes(String(control.type || '').toLowerCase()) ? 'change' : 'input';
        control.dispatchEvent(new Event(eventName, { bubbles:true }));
      });
    };
    apply(true);
    await Promise.resolve();
    apply(false);
  }

  function relativeTime(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return 'anteriormente';
    return date.toLocaleString('es-US', { dateStyle:'short', timeStyle:'short' });
  }

  function makeStatus(root, title) {
    const existing = root.querySelector(':scope > [data-form-draft-status]');
    if (existing) existing.remove();
    const node = document.createElement('div');
    node.className = 'form-draft-status';
    node.dataset.formDraftStatus = 'idle';
    node.innerHTML = `<span class="form-draft-dot" aria-hidden="true"></span><div class="form-draft-copy" role="status" aria-live="polite" aria-atomic="true"><strong>Autoguardado</strong><span data-form-draft-copy>Los cambios se guardan en este dispositivo.</span></div><button type="button" class="form-draft-discard" data-form-draft-discard hidden>Descartar borrador</button>`;
    node.dataset.draftTitle = String(title || 'este formulario');
    const header = root.matches('form') ? null : root.querySelector(':scope > .dialog-head, :scope > header');
    if (header?.nextSibling) root.insertBefore(node, header.nextSibling);
    else if (header) root.appendChild(node);
    else root.prepend(node);
    return node;
  }

  function readRecord(key, ttlMs) {
    if (!key) return null;
    try {
      const record = JSON.parse(localStorage.getItem(key) || 'null');
      const valid = record?.version === RECORD_VERSION
        && Number.isFinite(Number(record.saved_at))
        && Date.now() - Number(record.saved_at) <= ttlMs
        && record.data && typeof record.data === 'object';
      if (valid) return record;
      if (record) localStorage.removeItem(key);
    } catch {
      try { localStorage.removeItem(key); } catch {}
    }
    return null;
  }

  function purgeExpired() {
    try {
      const prefix = `${STORAGE_PREFIX}:`;
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const record = JSON.parse(localStorage.getItem(key) || 'null');
        if (!record?.saved_at || Date.now() - Number(record.saved_at) > DEFAULT_TTL_MS) localStorage.removeItem(key);
      }
    } catch {}
  }

  function register(options = {}) {
    const root = typeof options.root === 'string' ? document.querySelector(options.root) : options.root;
    const scope = String(options.key || '').trim();
    if (!(root instanceof HTMLElement) || !scope) return null;

    byRoot.get(root)?.destroy({ flush:true, removeStatus:true });

    const storageKey = recordKey(scope);
    const capture = typeof options.capture === 'function' ? options.capture : () => captureControls(root);
    const restore = typeof options.restore === 'function' ? options.restore : data => restoreControls(root, data);
    const meaningful = typeof options.meaningful === 'function'
      ? options.meaningful
      : (data, baseline) => comparable(data) !== comparable(baseline);
    const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : DEFAULT_TTL_MS;
    const debounceMs = Number(options.debounceMs) >= 0 ? Number(options.debounceMs) : DEFAULT_DEBOUNCE_MS;
    const title = String(options.title || 'este formulario');
    const status = makeStatus(root, title);
    const statusCopy = status.querySelector('[data-form-draft-copy]');
    const discardButton = status.querySelector('[data-form-draft-discard]');
    let baseline = clone(capture());
    let timer = null;
    let destroyed = false;
    let restoring = false;
    let hasStoredDraft = false;

    const renderStatus = (state, copy, discard = hasStoredDraft) => {
      if (!status.isConnected) return;
      status.dataset.formDraftStatus = state;
      statusCopy.textContent = copy;
      discardButton.hidden = !discard;
    };

    const removeRecord = () => {
      if (!storageKey) return;
      try { localStorage.removeItem(storageKey); } catch {}
      hasStoredDraft = false;
    };

    const dispatch = (name, detail = {}) => {
      root.dispatchEvent(new CustomEvent(`export-mca:draft-${name}`, { bubbles:true, detail:{ scope, title, ...detail } }));
    };

    const saveNow = () => {
      if (destroyed || restoring || !storageKey) return false;
      if (timer) clearTimeout(timer);
      timer = null;
      const data = clone(capture());
      if (!data || !meaningful(data, baseline)) {
        removeRecord();
        renderStatus('idle', 'Los cambios se guardan en este dispositivo.', false);
        return false;
      }
      const record = { version:RECORD_VERSION, scope, saved_at:Date.now(), data };
      const serialized = JSON.stringify(record);
      if (serialized.length > MAX_RECORD_BYTES) {
        renderStatus('error', 'Este borrador es demasiado grande para guardarlo localmente.', false);
        return false;
      }
      try {
        localStorage.setItem(storageKey, serialized);
        hasStoredDraft = true;
        renderStatus('saved', `Borrador guardado a las ${new Date(record.saved_at).toLocaleTimeString('es-US', { hour:'numeric', minute:'2-digit' })}.`, true);
        dispatch('saved', { savedAt:record.saved_at });
        return true;
      } catch {
        renderStatus('error', 'No se pudo guardar el borrador en este dispositivo.', false);
        return false;
      }
    };

    const scheduleSave = () => {
      if (destroyed || restoring || !storageKey) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(saveNow, debounceMs);
    };

    const onChange = event => {
      if (event.target?.closest?.('[data-form-draft-status]')) return;
      scheduleSave();
    };

    root.addEventListener('input', onChange, true);
    root.addEventListener('change', onChange, true);

    const controller = {
      scope,
      root,
      ready:Promise.resolve(),
      touch:scheduleSave,
      flush:saveNow,
      clear({ silent = false } = {}) {
        if (timer) clearTimeout(timer);
        timer = null;
        removeRecord();
        if (!silent) renderStatus('idle', 'Sin cambios pendientes.', false);
        dispatch('cleared');
      },
      async discard() {
        if (timer) clearTimeout(timer);
        timer = null;
        restoring = true;
        try { await restore(clone(baseline)); }
        finally { restoring = false; }
        removeRecord();
        renderStatus('discarded', 'Borrador descartado. El formulario volvió a su estado inicial.', false);
        dispatch('discarded');
        root.querySelector('input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled])')?.focus();
      },
      rebase({ clear = true } = {}) {
        if (clear) this.clear({ silent:true });
        baseline = clone(capture());
        renderStatus('idle', 'Los cambios se guardan en este dispositivo.', false);
      },
      destroy({ flush = true, removeStatus = true } = {}) {
        if (destroyed) return;
        if (flush) saveNow();
        destroyed = true;
        if (timer) clearTimeout(timer);
        timer = null;
        root.removeEventListener('input', onChange, true);
        root.removeEventListener('change', onChange, true);
        if (removeStatus) status.remove();
        instances.delete(controller);
        if (byRoot.get(root) === controller) byRoot.delete(root);
      }
    };

    discardButton.addEventListener('click', () => controller.discard());
    instances.add(controller);
    byRoot.set(root, controller);

    const record = readRecord(storageKey, ttlMs);
    controller.ready = (async () => {
      if (!storageKey) {
        renderStatus('disabled', 'Inicia sesión para activar el autoguardado.', false);
        return false;
      }
      if (!record) {
        renderStatus('idle', 'Los cambios se guardan en este dispositivo.', false);
        return false;
      }
      restoring = true;
      try {
        await restore(clone(record.data));
        hasStoredDraft = true;
        renderStatus('restored', `Borrador recuperado del ${relativeTime(record.saved_at)}.`, true);
        dispatch('restored', { savedAt:record.saved_at });
        return true;
      } catch {
        removeRecord();
        renderStatus('error', 'El borrador anterior no era compatible y fue descartado.', false);
        return false;
      } finally {
        restoring = false;
      }
    })();

    return controller;
  }

  function get(root) {
    const element = typeof root === 'string' ? document.querySelector(root) : root;
    return element instanceof HTMLElement ? byRoot.get(element) || null : null;
  }

  function clearScope(scope) {
    const key = recordKey(scope);
    if (!key) return false;
    try { localStorage.removeItem(key); return true; }
    catch { return false; }
  }

  const flushAll = () => instances.forEach(controller => controller.flush());
  window.addEventListener('pagehide', flushAll);
  window.addEventListener('export-mca:session-ending', flushAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAll(); });
  purgeExpired();

  window.ExportMcaDrafts = Object.freeze({
    register,
    get,
    clearScope,
    captureControls,
    restoreControls,
    owner:'form-drafts.js',
    storageVersion:RECORD_VERSION
  });
})();
