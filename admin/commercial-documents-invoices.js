(() => {
  if (window.__b7InvoiceDocumentsInstalled) return;
  window.__b7InvoiceDocumentsInstalled = true;

  const token = localStorage.getItem('export_mca_token') || '';
  const generatedLabel = 'Factura comercial';

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers:{ 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo generar la Factura Comercial');
    return data;
  }

  function notice(message, document = null, error = false) {
    document?.getElementById?.('b7InvoiceNotice')?.remove?.();
    const box = window.document.createElement('div');
    box.id = 'b7InvoiceNotice';
    box.style.cssText = `position:fixed;right:18px;bottom:18px;z-index:1000;max-width:390px;padding:12px 14px;border-radius:10px;background:${error ? '#fff0f0' : '#f0f7ff'};border:1px solid ${error ? '#efc0bc' : '#bfd1e8'};box-shadow:0 12px 32px rgba(6,32,74,.18);font:12px Arial;color:#152238`;
    const link = document?.signed_url ? `<a href="${String(document.signed_url).replace(/"/g,'&quot;')}" target="_blank" rel="noopener" style="display:inline-block;margin-top:7px;color:#06204a;font-weight:800">Ver PDF</a>` : '';
    box.innerHTML = `<b>${error ? 'No se pudo generar' : 'Documento actualizado'}</b><div style="margin-top:4px">${String(message).replace(/[&<>]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]))}</div>${link}`;
    window.document.body.appendChild(box);
    setTimeout(() => box.remove(), 9000);
  }

  async function generate(invoiceId, button) {
    const original = button.textContent;
    try {
      button.disabled = true;
      button.textContent = 'Revisando…';
      const versions = await request(`/api/commercial-documents?source_type=invoice&source_id=${encodeURIComponent(invoiceId)}`);
      const latest = (versions.documents || []).filter(row => row.document_type === generatedLabel).sort((a,b) => Number(b.version || 0) - Number(a.version || 0))[0];
      if (latest && !confirm(`Ya existe la versión v${latest.version}. ¿Generar una nueva versión desde la factura emitida actual?`)) return;
      button.textContent = 'Generando…';
      const result = await request('/api/commercial-documents', { method:'POST', body:JSON.stringify({ action:'generate_invoice', invoice_id:invoiceId }) });
      notice(`Factura Comercial v${result.document?.version || 1} generada y guardada en Documentos.`, result.document);
    } catch (error) {
      notice(error.message || 'No se pudo generar la Factura Comercial.', null, true);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function eligible(row) {
    const label = row.querySelector('.pill')?.textContent?.trim().toLowerCase() || '';
    return label && !label.includes('borrador') && !label.includes('anulada');
  }

  function enhance() {
    window.document.querySelectorAll('#invoiceList .row').forEach(row => {
      if (row.dataset.b7CommercialInvoice === '1') return;
      const detail = row.querySelector('[data-detail]');
      const actions = row.querySelector('.actions');
      if (!detail || !actions || !eligible(row)) return;
      row.dataset.b7CommercialInvoice = '1';
      const button = window.document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.textContent = 'Factura Comercial';
      button.title = 'Generar PDF versionado desde la factura emitida';
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        generate(detail.dataset.detail, button);
      };
      actions.appendChild(button);
    });
  }

  const target = window.document.getElementById('invoiceList');
  if (target) {
    new MutationObserver(enhance).observe(target, { childList:true, subtree:true });
    enhance();
  }
})();
