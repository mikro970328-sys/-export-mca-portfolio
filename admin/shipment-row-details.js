(() => {
  if (window.__shipmentRowDetailsInstalled) return;
  window.__shipmentRowDetailsInstalled = true;

  const token = () => localStorage.getItem('export_mca_token') || '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => value ? new Date(value).toLocaleString('es-US') : 'No disponible';

  async function request(path) {
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token()}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los detalles');
    return data;
  }

  function detailRow(label, value) {
    return `<div style="padding:11px 0;border-bottom:1px solid #e6ebf2"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#667085;margin-bottom:4px">${esc(label)}</div><div style="font-size:15px;color:#152238;word-break:break-word">${esc(value || 'No disponible')}</div></div>`;
  }

  function openDetails(shipment, client) {
    const mode = shipment.shipsgo_status === 'manual' ? 'Seguimiento manual' : shipment.shipsgo_status === 'active' ? 'ShipsGo automático' : 'ShipsGo pendiente o con error';
    const html = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
        <section>
          <h3 style="margin:0 0 8px;color:#06204a">Cliente</h3>
          ${detailRow('Nombre', client.name)}
          ${detailRow('Empresa', client.company)}
          ${detailRow('Nombre de la MIPYME', client.mipyme_name)}
          ${detailRow('Importadora por la que importa', client.importer_name)}
          ${detailRow('Teléfono / WhatsApp', client.phone)}
          ${detailRow('Correo', client.email)}
          ${detailRow('Estado de bienvenida', client.welcome_status)}
        </section>
        <section>
          <h3 style="margin:0 0 8px;color:#06204a">Contenedor</h3>
          ${detailRow('Número de contenedor', shipment.container_number)}
          ${detailRow('Booking', shipment.booking_number)}
          ${detailRow('B/L', shipment.bol_number)}
          ${detailRow('Naviera', shipment.carrier)}
          ${detailRow('Producto', shipment.product)}
          ${detailRow('Estado operativo', shipment.operational_status || shipment.last_status)}
          ${detailRow('Ubicación', shipment.last_location)}
          ${detailRow('Modo de tracking', mode)}
          ${detailRow('Creado', fmt(shipment.created_at))}
          ${detailRow('Última actualización', fmt(shipment.updated_at))}
        </section>
      </div>`;

    if (typeof window.openModal === 'function') {
      window.openModal(`Detalles · ${shipment.container_number}`, html);
      return;
    }
    alert(`${shipment.container_number}\nCliente: ${client.name || '-'}\nMIPYME: ${client.mipyme_name || '-'}\nImportadora: ${client.importer_name || '-'}\nTeléfono: ${client.phone || '-'}\nCreado: ${fmt(shipment.created_at)}`);
  }

  async function bindRows() {
    const container = document.getElementById('shipments');
    if (!container || container.dataset.rowDetailsBinding === '1') return;
    container.dataset.rowDetailsBinding = '1';
    try {
      const [shipmentData, clientData] = await Promise.all([request('/api/shipments'), request('/api/clients')]);
      const shipments = shipmentData.shipments || [];
      const clients = clientData.clients || [];
      const clientsById = new Map(clients.map(c => [String(c.id), c]));
      const byNumber = new Map(shipments.map(s => [String(s.container_number || '').trim(), s]));
      container.querySelectorAll('tbody tr').forEach(row => {
        if (row.dataset.rowDetailsBound === '1') return;
        const number = row.querySelector('td:first-child b')?.textContent?.trim();
        const shipment = byNumber.get(number);
        if (!shipment) return;
        const client = clientsById.get(String(shipment.client_id)) || shipment.clients || {};
        row.style.cursor = 'pointer';
        row.title = 'Tocar para ver todos los detalles';
        row.addEventListener('click', event => {
          if (event.target.closest('button,a,input,select,textarea,.shipment-menu,.shipment-menu-toggle')) return;
          openDetails(shipment, client);
        });
        row.dataset.rowDetailsBound = '1';
      });
    } catch (error) {
      console.warn('SHIPMENT_ROW_DETAILS_FAILED', error.message);
    } finally {
      container.dataset.rowDetailsBinding = '0';
    }
  }

  bindRows();
  const observer = new MutationObserver(bindRows);
  observer.observe(document.body, { childList: true, subtree: true });
})();