(() => {
  if (window.__clientExtraFieldsInstalled) return;
  window.__clientExtraFieldsInstalled = true;

  const $ = id => document.getElementById(id);
  const token = () => localStorage.getItem('export_mca_token') || '';

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

  function relabelClientFields() {
    const company = $('clientCompany');
    if (company) {
      const companyLabel = company.previousElementSibling;
      if (companyLabel?.tagName === 'LABEL') companyLabel.textContent = 'Importadora por la que importa';
      company.placeholder = 'Ejemplo: Quimimport, Consumimport...';
    }

    const importer = $('clientImporter');
    if (importer) {
      const importerLabel = importer.previousElementSibling;
      if (importerLabel?.tagName === 'LABEL') importerLabel.textContent = 'Identificador interno';
      importer.placeholder = 'Apodo o referencia interna del cliente';
    }

    document.querySelectorAll('#clients th').forEach(header => {
      if (header.textContent.trim().toLowerCase() === 'empresa') header.textContent = 'Importadora';
    });
  }

  function installFields() {
    const company = $('clientCompany');
    if (!company) return;

    if (!$('clientMipyme')) {
      company.insertAdjacentHTML('afterend', `
        <label>Nombre de la MIPYME</label>
        <input id="clientMipyme" placeholder="Opcional, si el cliente tiene MIPYME">
        <label>Identificador interno</label>
        <input id="clientImporter" placeholder="Apodo o referencia interna del cliente">
      `);
    }

    relabelClientFields();
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
            importer_name: $('clientImporter')?.value,
            phone: $('clientPhone')?.value,
            email: $('clientEmail')?.value
          })
        });
        if (typeof window.note === 'function') {
          window.note('clientMsg', result.welcome?.status === 'sent' ? 'Cliente guardado y bienvenida enviada.' : 'Cliente guardado. Bienvenida pendiente de plantilla.', true);
        }
        ['clientName','clientCompany','clientMipyme','clientImporter','clientPhone','clientEmail'].forEach(id => { if ($(id)) $(id).value = ''; });
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
    const company = prompt('Importadora por la que importa', client.company || '');
    if (company === null) return;
    const mipyme_name = prompt('Nombre de la MIPYME', client.mipyme_name || '');
    if (mipyme_name === null) return;
    const importer_name = prompt('Identificador interno', client.importer_name || '');
    if (importer_name === null) return;
    const phone = prompt('WhatsApp', client.phone || '');
    if (phone === null) return;
    const email = prompt('Correo', client.email || '');
    if (email === null) return;

    await request('/api/clients', {
      method: 'PATCH',
      body: JSON.stringify({ id, name, company, mipyme_name, importer_name, phone, email })
    });
    if (typeof window.loadAll === 'function') await window.loadAll();
  };

  installFields();
  overrideSave();
  const observer = new MutationObserver(() => {
    installFields();
    overrideSave();
    relabelClientFields();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();