(() => {
  const $id = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
  let activeShipmentId = null;
  let allEvents = [];
  let activeFilter = 'all';
  let loading = false;

  function addStyles() {
    if ($id('shipmentTimelineStyles')) return;
    const style = document.createElement('style');
    style.id = 'shipmentTimelineStyles';
    style.textContent = `
      .timeline-pro-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px}
      .timeline-pro-filters{display:flex;gap:7px;flex-wrap:wrap}
      .timeline-filter{background:#fff;color:var(--muted);border:1px solid var(--line);padding:8px 11px;font-size:12px}
      .timeline-filter.active{background:var(--navy);color:#fff;border-color:var(--navy)}
      .timeline-refresh{background:#fff;color:var(--navy);border:1px solid var(--navy)}
      .timeline-pro{position:relative;padding-left:34px}
      .timeline-pro::before{content:'';position:absolute;left:12px;top:10px;bottom:12px;width:2px;background:#dce3ec}
      .timeline-event{position:relative;padding:0 0 22px 14px}
      .timeline-dot{position:absolute;left:-29px;top:3px;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px #cfd7e3;background:#98a2b3}
      .timeline-event.success .timeline-dot{background:#17a34a;box-shadow:0 0 0 2px #a7e0b8}
      .timeline-event.warning .timeline-dot{background:#f59e0b;box-shadow:0 0 0 2px #f8d99a}
      .timeline-event.error .timeline-dot{background:#d92d20;box-shadow:0 0 0 2px #f1b5b0}
      .timeline-event.info .timeline-dot{background:#2563eb;box-shadow:0 0 0 2px #b6cdfb}
      .timeline-card{border:1px solid var(--line);border-radius:11px;padding:14px 15px;background:#fff;box-shadow:0 2px 8px rgba(16,24,40,.04)}
      .timeline-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
      .timeline-card-title{font-weight:800;color:var(--navy);font-size:14px}
      .timeline-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:800;text-transform:uppercase;white-space:nowrap;background:#f2f4f7;color:#475467}
      .timeline-badge.tracking{background:#edf3ff;color:#174ea6}.timeline-badge.whatsapp{background:#edf9f0;color:#117a37}.timeline-badge.manual{background:#fff8e8;color:#9a6700}.timeline-badge.error{background:#fff0ef;color:#b42318}
      .timeline-details{margin-top:7px;color:#344054;white-space:pre-wrap;word-break:break-word}
      .timeline-meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:9px;color:var(--muted);font-size:11px}
      .timeline-empty{padding:28px;text-align:center;border:1px dashed var(--line);border-radius:10px;color:var(--muted)}
      .timeline-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:18px}
      .timeline-summary-card{border:1px solid var(--line);border-radius:10px;padding:12px;background:#f8fafc}.timeline-summary-card b{display:block;font-size:20px;color:var(--navy)}
      @media(max-width:700px){.timeline-summary{grid-template-columns:repeat(2,1fr)}.timeline-pro{padding-left:28px}.timeline-dot{left:-23px}.timeline-pro::before{left:10px}}
    `;
    document.head.appendChild(style);
  }

  function classifyEvent(event) {
    const type = String(event.event_type || event.type || '').toLowerCase();
    const source = String(event.source || '').toLowerCase();
    const title = String(event.title || event.action || '').toLowerCase();
    const status = String(event.status || event.delivery_status || '').toLowerCase();
    if (/fail|error|undelivered/.test(type + title + status)) return { group:'errors', tone:'error', badge:'Error', badgeClass:'error' };
    if (source === 'shipsgo' || /shipsgo|tracking|location|ubicación|transit|tránsito/.test(type + title)) return { group:'tracking', tone:'info', badge:'Tracking', badgeClass:'tracking' };
    if (/whatsapp|notification|mensaje|release/.test(type + title) || event.channel === 'whatsapp') return { group:'whatsapp', tone: /pending|queued/.test(status) ? 'warning' : 'success', badge:'WhatsApp', badgeClass:'whatsapp' };
    return { group:'manual', tone: /delivered|released|created|updated|reactivated/.test(type) ? 'success' : 'warning', badge:'Manual', badgeClass:'manual' };
  }

  function normalizeEvents(result) {
    const events = (result.events || []).map(item => ({ ...item, _kind:'event' }));
    const notifications = (result.notifications || []).map(item => ({
      ...item,
      _kind:'notification',
      title: `WhatsApp · ${item.event_type || item.event_status || 'Notificación'}`,
      details: item.error_message || item.status || item.delivery_status || '',
      source: 'whatsapp'
    }));
    const audit = (result.audit_events || []).map(item => ({
      ...item,
      _kind:'audit',
      title: item.title || item.action || 'Cambio administrativo',
      details: typeof item.details === 'string' ? item.details : JSON.stringify(item.details || {}),
      source: 'admin'
    }));
    return [...events, ...notifications, ...audit].sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }

  function dateText(value) {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('es-US', { dateStyle:'medium', timeStyle:'short' });
  }

  function render() {
    const target = $id('shipmentTimelineList');
    if (!target) return;
    const filtered = activeFilter === 'all' ? allEvents : allEvents.filter(event => classifyEvent(event).group === activeFilter);
    document.querySelectorAll('[data-timeline-filter]').forEach(button => button.classList.toggle('active', button.dataset.timelineFilter === activeFilter));
    const counts = { tracking:0, whatsapp:0, manual:0, errors:0 };
    allEvents.forEach(event => counts[classifyEvent(event).group]++);
    const summary = $id('shipmentTimelineSummary');
    if (summary) summary.innerHTML = `
      <div class="timeline-summary-card"><span>Total</span><b>${allEvents.length}</b></div>
      <div class="timeline-summary-card"><span>Tracking</span><b>${counts.tracking}</b></div>
      <div class="timeline-summary-card"><span>WhatsApp</span><b>${counts.whatsapp}</b></div>
      <div class="timeline-summary-card"><span>Errores</span><b>${counts.errors}</b></div>`;
    if (!filtered.length) {
      target.innerHTML = '<div class="timeline-empty">No hay eventos para este filtro.</div>';
      return;
    }
    target.innerHTML = `<div class="timeline-pro">${filtered.map(event => {
      const meta = classifyEvent(event);
      const actor = event.actor || event.created_by || event.username || event.source || 'Sistema';
      return `<article class="timeline-event ${meta.tone}"><span class="timeline-dot"></span><div class="timeline-card"><div class="timeline-card-head"><div class="timeline-card-title">${esc(event.title || event.action || 'Evento')}</div><span class="timeline-badge ${meta.badgeClass}">${meta.badge}</span></div>${event.details ? `<div class="timeline-details">${esc(event.details)}</div>` : ''}<div class="timeline-meta"><span>${dateText(event.created_at)}</span><span>Origen: ${esc(actor)}</span></div></div></article>`;
    }).join('')}</div>`;
  }

  async function loadTimeline(force = false) {
    const panel = document.querySelector('[data-editor-panel="history"]');
    if (!panel || !activeShipmentId || loading) return;
    if (!force && panel.dataset.loadedFor === String(activeShipmentId)) return;
    loading = true;
    panel.dataset.loadedFor = String(activeShipmentId);
    panel.innerHTML = '<div class="timeline-empty">Cargando historial...</div>';
    try {
      const result = await api('/api/history?shipment_id=' + encodeURIComponent(activeShipmentId));
      allEvents = normalizeEvents(result);
      panel.innerHTML = `<div class="timeline-pro-toolbar"><div class="timeline-pro-filters"><button class="timeline-filter active" data-timeline-filter="all">Todos</button><button class="timeline-filter" data-timeline-filter="tracking">Tracking</button><button class="timeline-filter" data-timeline-filter="manual">Cambios manuales</button><button class="timeline-filter" data-timeline-filter="whatsapp">WhatsApp</button><button class="timeline-filter" data-timeline-filter="errors">Errores</button></div><button id="shipmentTimelineRefresh" class="timeline-refresh">Actualizar</button></div><div id="shipmentTimelineSummary" class="timeline-summary"></div><div id="shipmentTimelineList"></div>`;
      panel.querySelectorAll('[data-timeline-filter]').forEach(button => button.onclick = () => { activeFilter = button.dataset.timelineFilter; render(); });
      $id('shipmentTimelineRefresh').onclick = () => loadTimeline(true);
      render();
    } catch (error) {
      panel.innerHTML = `<div class="editor-error"><b>No se pudo cargar el historial</b><div>${esc(error.message)}</div></div><button id="shipmentTimelineRetry" class="alt">Reintentar</button>`;
      $id('shipmentTimelineRetry').onclick = () => loadTimeline(true);
    } finally { loading = false; }
  }

  function detectEditor() {
    const modal = $id('modal');
    const historyTab = document.querySelector('[data-editor-tab="history"]');
    const containerInput = $id('editorContainer');
    if (!modal?.classList.contains('shipment-editor-modal') || !historyTab || !containerInput) return;
    const shipment = (window.shipments || shipments || []).find(item => String(item.container_number || '').toUpperCase() === String(containerInput.value || '').toUpperCase());
    if (shipment) activeShipmentId = shipment.id;
    historyTab.addEventListener('click', () => setTimeout(() => loadTimeline(), 0), { once:false });
  }

  addStyles();
  const observer = new MutationObserver(detectEditor);
  observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
  document.addEventListener('DOMContentLoaded', detectEditor);
})();