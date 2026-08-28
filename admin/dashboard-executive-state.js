(() => {
  if (window.__b8ExecutiveDashboardInstalled) return;
  window.__b8ExecutiveDashboardInstalled = true;

  const byId = id => document.getElementById(id);
  const money = (value, currency) => `${currency || ''} ${Number(value || 0).toLocaleString('en-US',{ minimumFractionDigits:2, maximumFractionDigits:2 })}`.trim();
  const pct = value => value === null || value === undefined ? '—' : `${Number(value).toLocaleString('en-US',{ maximumFractionDigits:2 })}%`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const discoveredCurrencies = new Set();
  let loading = false;

  function openSection(id) {
    const control = document.querySelector(`[data-section="${CSS.escape(id)}"]`);
    if (control) return control.click();
    if (typeof window.showSection === 'function') window.showSection(id);
  }

  function ensureStyles() {
    if (byId('b8ExecutiveDashboardStyles')) return;
    const style = document.createElement('style');
    style.id = 'b8ExecutiveDashboardStyles';
    style.textContent = `
      .b8-exec{margin-bottom:18px}.b8-exec-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:12px}.b8-exec-head h2{margin:0;color:var(--navy);font-size:20px}.b8-exec-head p{margin:4px 0 0;color:var(--muted);font-size:12px}.b8-filter{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr)) auto;gap:8px;align-items:end;padding:12px;border:1px solid var(--line);border-radius:12px;background:#fbfcfe;margin-bottom:12px}.b8-filter label{margin:0 0 5px;font-size:10px;text-transform:uppercase;color:var(--muted)}.b8-filter input,.b8-filter select{padding:9px;background:#fff}.b8-filter-actions{display:flex;gap:7px}.b8-filter-note{grid-column:1/-1;color:var(--muted);font-size:11px}.b8-currency-band{border:1px solid var(--line);border-radius:13px;background:#fff;overflow:hidden;margin-top:10px}.b8-currency-title{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 13px;background:#f7f9fc;border-bottom:1px solid var(--line)}.b8-currency-title b{color:var(--navy);font-size:14px}.b8-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:0}.b8-kpi{padding:13px;border-right:1px solid #edf0f4;border-bottom:1px solid #edf0f4;cursor:pointer;min-height:88px}.b8-kpi:nth-child(4n){border-right:0}.b8-kpi:hover{background:#fafcff}.b8-kpi small{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;font-weight:800}.b8-kpi strong{display:block;color:var(--navy);font-size:18px;margin-top:6px}.b8-kpi span{display:block;color:var(--muted);font-size:10px;margin-top:4px}.b8-snapshot-label{font-size:10px;color:var(--muted);font-weight:800;text-transform:uppercase}.b8-exceptions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.b8-exception{border:1px solid var(--line);border-radius:999px;padding:7px 10px;background:#fff;color:#475467;font-size:11px}.b8-exception.attention{border-color:#f1c9a4;background:#fff8ee;color:#8a4d00}.b8-empty{padding:18px;border:1px dashed var(--line);border-radius:12px;color:var(--muted);text-align:center}.b8-filter-loading{opacity:.6;pointer-events:none}
      @media(max-width:1000px){.b8-kpis{grid-template-columns:repeat(2,1fr)}.b8-kpi:nth-child(4n){border-right:1px solid #edf0f4}.b8-kpi:nth-child(2n){border-right:0}.b8-filter{grid-template-columns:repeat(2,1fr)}}
      @media(max-width:560px){.b8-kpis,.b8-filter{grid-template-columns:1fr}.b8-kpi{border-right:0}.b8-filter-actions{grid-column:1}.b8-filter-actions button{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function ensureStructure() {
    const dashboard = byId('dashboardSection');
    if (!dashboard) return null;
    let section = byId('b8ExecutiveDashboard');
    if (section) return section;
    section = document.createElement('section');
    section.id = 'b8ExecutiveDashboard';
    section.className = 'card b8-exec';
    section.innerHTML = `
      <div class="b8-exec-head"><div><h2>Resumen ejecutivo</h2><p>Ventas, caja, cuentas por cobrar/pagar y margen, siempre separados por moneda.</p></div><span class="pill">B8 · Fuente financiera backend</span></div>
      <div class="b8-filter" id="b8ExecutiveFilter">
        <div><label>Desde</label><input id="b8StartDate" type="date"></div>
        <div><label>Hasta</label><input id="b8EndDate" type="date"></div>
        <div><label>Moneda</label><select id="b8Currency"><option value="">Todas por separado</option></select></div>
        <div><label>Vista</label><input value="Actividad + saldos actuales" disabled></div>
        <div class="b8-filter-actions"><button id="b8Apply" type="button">Aplicar</button><button id="b8Clear" class="alt" type="button">Limpiar</button></div>
        <div class="b8-filter-note">Las fechas filtran la actividad del período. AR/AP se muestran como saldo actual y nunca se convierten entre monedas.</div>
      </div>
      <div id="b8ExecutiveContent"></div>
      <div id="b8ExecutiveExceptions" class="b8-exceptions"></div>`;
    const operationalCounters = byId('stats');
    if (operationalCounters?.parentNode === dashboard) operationalCounters.insertAdjacentElement('afterend', section);
    else dashboard.prepend(section);
    bindFilters();
    return section;
  }

  function renderCurrencyOptions(executive) {
    [...(executive?.activity_by_currency || []), ...(executive?.balances_by_currency || [])].forEach(row => {
      if (row?.currency) discoveredCurrencies.add(String(row.currency).toUpperCase());
    });
    const select = byId('b8Currency');
    if (!select) return;
    const current = executive?.period?.currency || '';
    select.innerHTML = '<option value="">Todas por separado</option>' + [...discoveredCurrencies].sort().map(currency => `<option value="${esc(currency)}">${esc(currency)}</option>`).join('');
    select.value = current;
  }

  function syncFilters(executive) {
    if (!executive?.period) return;
    if (byId('b8StartDate')) byId('b8StartDate').value = executive.period.start_date || '';
    if (byId('b8EndDate')) byId('b8EndDate').value = executive.period.end_date || '';
    renderCurrencyOptions(executive);
  }

  function clickableCard(label, value, sub, sectionId) {
    return `<div class="b8-kpi" data-b8-open="${esc(sectionId)}" tabindex="0" role="link"><small>${esc(label)}</small><strong>${esc(value)}</strong><span>${esc(sub)}</span></div>`;
  }

  function renderBand(currency, activity = {}, balance = {}) {
    const marginSub = Number(activity.margin_eligible_invoice_count || 0) > 0
      ? `${activity.margin_eligible_invoice_count} factura${Number(activity.margin_eligible_invoice_count) === 1 ? '' : 's'} con costo completo`
      : `${activity.margin_incomplete_invoice_count || 0} factura${Number(activity.margin_incomplete_invoice_count || 0) === 1 ? '' : 's'} sin margen elegible`;
    const cards = [
      clickableCard('Ventas emitidas',money(activity.issued_sales,currency),`${activity.issued_invoice_count || 0} facturas emitidas`,'invoicesSection'),
      clickableCard('Cash collected',money(activity.cash_collected,currency),`${activity.customer_payment_count || 0} cobros posted`,'invoicesSection'),
      clickableCard('Cash paid',money(activity.cash_paid,currency),`${activity.supplier_payment_count || 0} pagos a proveedor`,'payablesSection'),
      clickableCard('Margen bruto elegible',money(activity.gross_margin,currency),`${pct(activity.gross_margin_pct)} · ${marginSub}`,'costsSection'),
      clickableCard('PO comprometidas',money(activity.po_committed_value,currency),`${activity.po_committed_count || 0} comprometidas · ${activity.po_draft_count || 0} draft`,'purchasesSection'),
      clickableCard('Sales Orders confirmadas',money(activity.booked_sales_order_value,currency),`${activity.so_confirmed_count || 0} confirmadas · ${activity.so_draft_count || 0} draft`,'salesSection'),
      clickableCard('AR actual',money(balance.ar_balance,currency),`${balance.open_ar_invoice_count || 0} facturas abiertas · ${balance.overdue_ar_count || 0} vencidas`,'invoicesSection'),
      clickableCard('AP actual',money(balance.ap_balance,currency),`${balance.open_ap_bill_count || 0} bills abiertos · ${balance.overdue_ap_count || 0} vencidos`,'payablesSection')
    ].join('');
    return `<div class="b8-currency-band"><div class="b8-currency-title"><b>${esc(currency)}</b><span class="b8-snapshot-label">AR/AP = snapshot actual</span></div><div class="b8-kpis">${cards}</div></div>`;
  }

  function renderExceptions(executive) {
    const target = byId('b8ExecutiveExceptions');
    if (!target) return;
    const x = executive?.exceptions || {};
    const rows = [
      ['AR vencido',x.overdue_ar_count,'invoicesSection'],
      ['AP vencido',x.overdue_ap_count,'payablesSection'],
      ['Margen incompleto',x.invoice_profitability_incomplete_count,'costsSection'],
      ['Pago proveedor no aplicado',x.supplier_unapplied_payment_count,'payablesSection'],
      ['PO con exceso recibido',x.po_receipt_excess_count,'purchasesSection'],
      ['PO con valor incompleto',x.po_order_value_incomplete_count,'purchasesSection'],
      ['SO despacho parcial',x.sales_order_partial_dispatch_count,'salesSection']
    ];
    target.innerHTML = rows.map(([label,count,section]) => `<button type="button" class="b8-exception ${Number(count || 0) ? 'attention' : ''}" data-b8-open="${esc(section)}">${esc(label)} · ${Number(count || 0)}</button>`).join('');
  }

  function bindContextLinks(root = document) {
    root.querySelectorAll('[data-b8-open]').forEach(node => {
      if (node.dataset.b8Bound === '1') return;
      node.dataset.b8Bound = '1';
      const go = () => openSection(node.dataset.b8Open);
      node.addEventListener('click', go);
      node.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        go();
      });
    });
  }

  function renderExecutive(executive = {}) {
    ensureStyles();
    ensureStructure();
    syncFilters(executive);
    const target = byId('b8ExecutiveContent');
    if (!target) return;
    const activities = new Map((executive.activity_by_currency || []).map(row => [String(row.currency), row]));
    const balances = new Map((executive.balances_by_currency || []).map(row => [String(row.currency), row]));
    const currencies = [...new Set([...activities.keys(), ...balances.keys()])].sort();
    target.innerHTML = currencies.length
      ? currencies.map(currency => renderBand(currency, activities.get(currency) || {}, balances.get(currency) || {})).join('')
      : '<div class="b8-empty">No hay actividad financiera ni saldos para estos filtros.</div>';
    renderExceptions(executive);
    bindContextLinks(byId('b8ExecutiveDashboard'));
  }

  async function applyFilters(clear = false) {
    if (loading) return;
    const filter = byId('b8ExecutiveFilter');
    const params = new URLSearchParams();
    if (!clear) {
      const start = byId('b8StartDate')?.value || '';
      const end = byId('b8EndDate')?.value || '';
      const currency = byId('b8Currency')?.value || '';
      if (start) params.set('start_date',start);
      if (end) params.set('end_date',end);
      if (currency) params.set('currency',currency);
    }
    loading = true;
    filter?.classList.add('b8-filter-loading');
    try {
      if (typeof window.api !== 'function') throw new Error('API administrativa no disponible.');
      const payload = await window.api(`/api/dashboard${params.toString() ? `?${params}` : ''}`);
      window.renderStats(payload);
    } catch (error) {
      alert(error.message || 'No se pudo actualizar el resumen ejecutivo.');
    } finally {
      loading = false;
      filter?.classList.remove('b8-filter-loading');
    }
  }

  function bindFilters() {
    byId('b8Apply')?.addEventListener('click',() => applyFilters(false));
    byId('b8Clear')?.addEventListener('click',() => applyFilters(true));
  }

  const baseRenderStats = window.renderStats;
  if (typeof baseRenderStats === 'function') {
    window.renderStats = payload => {
      baseRenderStats(payload);
      window.__lastDashboardPayload = payload || {};
      renderExecutive(payload?.executive || {});
    };
  }

  window.DashboardExecutiveState = Object.freeze({ render:renderExecutive, reload:applyFilters });
  ensureStyles();
  ensureStructure();
  if (window.__lastDashboardPayload?.executive) renderExecutive(window.__lastDashboardPayload.executive);
})();
