(() => {
  if (window.__clientExtraFieldsInstalled) return;
  window.__clientExtraFieldsInstalled = true;

  const $ = id => document.getElementById(id);
  const token = () => localStorage.getItem('export_mca_token') || '';
  const IMPORTER_LABEL = 'Importadora por la que importa';

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token()}`,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.details || 'Error');
    return data;
  }

  function removeLegacyImporterField() {
    const importer = $('clientImporter');
    if (!importer) return;
    const label = importer.previousElementSibling;
    if (label?.tagName === 'LABEL') label.remove();
    importer.remove();
  }

  function applyLabels() {
    const company = $('clientCompany');
    const label = company?.previousElementSibling;
    if (label?.tagName === 'LABEL') label.textContent = IMPORTER_LABEL;

    document.querySelectorAll('#clients thead th').forEach(header => {
      if (header.textContent.trim() === 'Empresa') header.textContent = IMPORTER_LABEL;
    });
  }

  function installFields() {
    removeLegacyImporterField();
    applyLabels();

    const company = $('clientCompany');
    if (!company || $('clientMipyme')) return;
    company.insertAdjacentHTML('afterend', `
      <label>Nombre de la MIPYME</label>
      <input id="clientMipyme" placeholder="Opcional, si el cliente tiene MIPYME">
    `);
  }

  function overrideSave() {
    const oldButton = $('saveClient');
    if (!oldButton || oldButton.dataset.extraFields === '1') return;
    const button = oldButton.cloneNode(true);
    button.dataset.extraFields = '1';
    oldButton.replaceWith(button);
    button.onclick = async () => {
      try {
        button.disabled = true;
        const result = await request('/api/clients', {
          method: 'POST',
          body: JSON.stringify({
            name: $('clientName')?.value,
            company: $('clientCompany')?.value,
            mipyme_name: $('clientMipyme')?.value,
            phone: $('clientPhone')?.value,
            email: $('clientEmail')?.value
          })
        });
        if (typeof window.note === 'function') {
          window.note('clientMsg', result.welcome?.status === 'sent' ? 'Cliente guardado y bienvenida enviada.' : 'Cliente guardado. Bienvenida pendiente de plantilla.', true);
        }
        ['clientName','clientCompany','clientMipyme','clientPhone','clientEmail'].forEach(id => { if ($(id)) $(id).value = ''; });
        if (typeof window.loadAll === 'function') await window.loadAll();
      } catch (error) {
        if (typeof window.note === 'function') window.note('clientMsg', error.message);
        else alert(error.message);
      } finally {
        button.disabled = false;
      }
    };
  }

  window.editClient = async id => {
    const list = Array.isArray(window.clients) ? window.clients : [];
    let client = list.find(item => item.id === id);
    if (!client) {
      const data = await request('/api/clients');
      client = (data.clients || []).find(item => item.id === id);
    }
    if (!client) return alert('Cliente no encontrado');

    const name = prompt('Nombre', client.name || '');
    if (name === null) return;
    const company = prompt(IMPORTER_LABEL, client.company || '');
    if (company === null) return;
    const mipyme_name = prompt('Nombre de la MIPYME', client.mipyme_name || '');
    if (mipyme_name === null) return;
    const phone = prompt('WhatsApp', client.phone || '');
    if (phone === null) return;
    const email = prompt('Correo', client.email || '');
    if (email === null) return;

    await request('/api/clients', {
      method: 'PATCH',
      body: JSON.stringify({ id, name, company, mipyme_name, phone, email })
    });
    if (typeof window.loadAll === 'function') await window.loadAll();
  };

  installFields();
  overrideSave();
  const observer = new MutationObserver(() => {
    installFields();
    overrideSave();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
