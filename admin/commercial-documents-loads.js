(() => {
  if (window.__b7LoadDocumentsInstalled) return;
  window.__b7LoadDocumentsInstalled = true;

  const token = localStorage.getItem('export_mca_token') || '';
  const generatedLabel = 'Packing List';

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json', ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo generar el Packing List');
    return data;
  }

  function getLoadState() {
    try { return typeof state !== 'undefined' ? state : null; } catch { return null; }
  }

  async function refreshLoads() {
    try {
      if (typeof refresh === 'function') return await refresh();
      if (typeof window.refresh === 'function') return await window.refresh();
    } catch {}
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[char]));
  }

  function notice(message, generatedDocument = null, error = false) {
    window.document.getElementById('b7PackingNotice')?.remove();
    const box = window.document.createElement('div');
    box.id = 'b7PackingNotice';
    box.style.cssText = `position:fixed;right:18px;bottom:18px;z-index:1000;max-width:390px;padding:12px 14px;border-radius:10px;background:${error ? '#fff0f0' : '#f0f7ff'};border:1px solid ${error ? '#efc0bc' : '#bfd1e8'};box-shadow:0 12px 32px rgba(6,32,74,.18);font:12px Arial;color:#152238`;
    const safeUrl = String(generatedDocument?.signed_url || '').replace(/"/g, '&quot;');
    const link = safeUrl ? `<a href="${safeUrl}" target="_blank" rel="noopener" style="display:inline-block;margin-top:7px;color:#06204a;font-weight:800">Ver PDF</a>` : '';
    box.innerHTML = `<b>${error ? 'No se pudo generar' : 'Documento actualizado'}</b><div style="margin-top:4px">${escapeHtml(message)}</div>${link}`;
    window.document.body.appendChild(box);
    setTimeout(() => box.remove(), 9000);
  }

  async function generate(loadId, button) {
    const original = button.textContent;
    try {
      button.disabled = true;
      button.textContent = 'Revisando…';
      const versions = await request(`/api/commercial-documents?source_type=load&source_id=${encodeURIComponent(loadId)}`);
      const latest = (versions.documents || []).filter(row => row.document_type === generatedLabel).sort((a,b) => Number(b.version || 0) - Number(a.version || 0))[0];
      if (latest && !confirm(`Ya existe el Packing List v${latest.version}. ¿Generar una nueva versión desde el Cargue actual?`)) return;
      button.textContent = 'Generando…';
      const result = await request('/api/commercial-documents', { method:'POST', body:JSON.stringify({ action:'generate_packing_list', load_id:loadId }) });
      notice(`Packing List v${result.document?.version || 1} generado y guardado en el expediente documental.`, result.document);
      await refreshLoads();
    } catch (error) {
      notice(error.message || 'No se pudo generar el Packing List.', null, true);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function enhanceRows() {
    const loadState = getLoadState();
    window.document.querySelectorAll('#loadRows tr[data-id]').forEach(row => {
      if (row.dataset.b7PackingList === '1') return;
      const loadId = row.dataset.id;
      const load = loadState?.loads?.find?.(item => String(item.id) === String(loadId));
      if (!load || !['loaded','dispatched'].includes(load.status)) return;
      const firstCell = row.querySelector('td');
      if (!firstCell) return;
      row.dataset.b7PackingList = '1';
      const button = window.document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.textContent = 'Packing List';
      button.title = 'Generar PDF versionado desde el Cargue físico';
      button.style.marginLeft = '8px';
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        generate(loadId, button);
      };
      firstCell.appendChild(button);
    });
  }

  const target = window.document.getElementById('loadRows');
  if (target) {
    new MutationObserver(enhanceRows).observe(target, { childList:true, subtree:true });
    enhanceRows();
  }
})();
