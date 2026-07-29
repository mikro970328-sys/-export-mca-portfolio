(() => {
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
  let current = null;
  let dirty = false;
  let saving = false;
  let timelineEvents = [];
  let timelineFilter = 'all';
  let timelineLoaded = false;
  let sendingTemplate = false;

  function styles() {
    if (byId('shipmentEditorStyles')) return;
    const s = document.createElement('style');
    s.id = 'shipmentEditorStyles';
    s.textContent = `
      #modal.shipment-editor-modal{backdrop-filter:blur(5px);background:rgba(5,18,42,.58)}
      #modal.shipment-editor-modal .modalbox{max-width:1080px;width:min(96vw,1080px);max-height:92vh;padding:0;overflow:hidden;box-shadow:0 24px 70px rgba(5,18,42,.32)}
      .shipment-editor-head{padding:22px 24px 18px;border-bottom:1px solid var(--line);background:linear-gradient(135deg,#fff,#f7f9fc)}
      .shipment-editor-title{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.shipment-editor-title h2{margin:0;color:var(--navy);font-size:22px}.shipment-editor-code{font-size:13px;color:var(--muted);margin-top:5px}
      .shipment-editor-tabs{display:flex;gap:6px;padding:12px 24px;border-bottom:1px solid var(--line);background:#fff;overflow:auto}.shipment-editor-tab{background:#fff;color:var(--muted);border:1px solid transparent;white-space:nowrap}.shipment-editor-tab.active{color:var(--navy);background:#edf3ff;border-color:#c9d8f2}
      .shipment-editor-body{padding:22px 24px;overflow:auto;max-height:62vh;background:#fff}.shipment-editor-panel{display:none}.shipment-editor-panel.active{display:block}
      .shipment-editor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 18px}.shipment-editor-grid .full{grid-column:1/-1}.shipment-editor-grid label{margin-top:0}
      .shipment-editor-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 24px;border-top:1px solid var(--line);background:#f8fafc}.shipment-editor-actions{display:flex;gap:10px;flex-wrap:wrap}
      .editor-info-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.editor-info-card{border:1px solid var(--line);border-radius:10px;padding:14px;background:#fff}.editor-info-card b{display:block;color:var(--navy);margin-bottom:5px}
      .editor-error,.editor-success,.editor-warning{padding:11px 13px;border-radius:8px;margin-bottom:15px}.editor-error{background:#fff0ef;border:1px solid #efb0aa;color:var(--bad)}.editor-success{background:#edf9f0;border:1px solid #9bd3aa;color:var(--ok)}.editor-warning{background:#fff8e8;border:1px solid #f3d59c;color:#7a5200}
      .wa-test-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:16px}.wa-test-card{border:1px solid var(--line);border-radius:12px;padding:16px;background:#fff;box-shadow:0 2px 8px rgba(16,24,40,.04)}.wa-test-card h3{margin:0 0 6px;color:var(--navy);font-size:15px}.wa-test-card p{margin:0 0 13px;color:var(--muted);font-size:12px}.wa-test-card button{width:100%}.wa-test-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}.wa-test-fields label{margin-top:0}.wa-test-meta{font-size:12px;color:var(--muted);margin-top:12px}.wa-test-status{margin-top:14px}
      .timeline-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px}.timeline-filters{display:flex;gap:7px;flex-wrap:wrap}.timeline-filter{background:#fff;color:var(--muted);border:1px solid var(--line);padding:8px 11px;font-size:12px}.timeline-filter.active{background:var(--navy);color:#fff;border-color:var(--navy)}
      .timeline-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:18px}.timeline-summary-card{border:1px solid var(--line);border-radius:10px;padding:12px;background:#f8fafc}.timeline-summary-card b{display:block;font-size:20px;color:var(--navy)}
      .timeline-pro{position:relative;padding-left:34px}.timeline-pro:before{content:'';position:absolute;left:12px;top:10px;bottom:12px;width:2px;background:#dce3ec}.timeline-event{position:relative;padding:0 0 22px 14px}.timeline-dot{position:absolute;left:-29px;top:3px;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px #cfd7e3;background:#98a2b3}.timeline-event.success .timeline-dot{background:#17a34a;box-shadow:0 0 0 2px #a7e0b8}.timeline-event.warning .timeline-dot{background:#f59e0b;box-shadow:0 0 0 2px #f8d99a}.timeline-event.error .timeline-dot{background:#d92d20;box-shadow:0 0 0 2px #f1b5b0}.timeline-event.info .timeline-dot{background:#2563eb;box-shadow:0 0 0 2px #b6cdfb}
      .timeline-card{border:1px solid var(--line);border-radius:11px;padding:14px 15px;background:#fff;box-shadow:0 2px 8px rgba(16,24,40,.04)}.timeline-head{display:flex;justify-content:space-between;gap:12px}.timeline-title{font-weight:800;color:var(--navy)}.timeline-badge{border-radius:999px;padding:4px 8px;font-size:10px;font-weight:800;text-transform:uppercase;white-space:nowrap;background:#f2f4f7;color:#475467}.timeline-badge.tracking{background:#edf3ff;color:#174ea6}.timeline-badge.whatsapp{background:#edf9f0;color:#117a37}.timeline-badge.manual{background:#fff8e8;color:#9a6700}.timeline-badge.error{background:#fff0ef;color:#b42318}.timeline-details{margin-top:7px;color:#344054;white-space:pre-wrap;word-break:break-word}.timeline-meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:9px;color:var(--muted);font-size:11px}.timeline-empty{padding:28px;text-align:center;border:1px dashed var(--line);border-radius:10px;color:var(--muted)}
      @media(max-width:700px){.shipment-editor-grid,.editor-info-grid,.wa-test-grid,.wa-test-fields{grid-template-columns:1fr}.shipment-editor-grid .full{grid-column:auto}.shipment-editor-head,.shipment-editor-tabs,.shipment-editor-body,.shipment-editor-footer{padding-left:16px;padding-right:16px}.shipment-editor-footer{align-items:flex-start;flex-direction:column}.shipment-editor-actions{width:100%}.shipment-editor-actions button{flex:1}.timeline-summary{grid-template-columns:repeat(2,1fr)}}`;
    document.head.appendChild(s);
  }

  const options = selected => (clients || []).map(c => `<option value="${esc(c.id)}" ${String(c.id)===String(selected)?'selected':''}>${esc(c.name)}${c.company?' · '+esc(c.company):''}</option>`).join('');
  const statuses = currentStatus => [...new Set([currentStatus,'Registrado','Booking confirmado','Cargado','En tránsito','En destino','Esperando liberación','Liberado','Entregado'].filter(Boolean))].map(v=>`<option ${v===currentStatus?'selected':''}>${esc(v)}</option>`).join('');

  function html(x) {
    const c = x.clients || {};
    const testStatus = x.last_status || x.operational_status || 'En tránsito';
    const testLocation = x.last_location || 'Puerto de origen';
    return `<div class="shipment-editor-head"><div class="shipment-editor-title"><div><h2>Editar contenedor</h2><div class="shipment-editor-code">${esc(x.container_number)} · ${esc(x.carrier||'Sin naviera')}</div></div><button id="shipmentEditorClose" class="alt">Cerrar</button></div></div>
      <div class="shipment-editor-tabs">
        <button class="shipment-editor-tab active" data-editor-tab="general">General</button>
        <button class="shipment-editor-tab" data-editor-tab="tracking">Tracking</button>
        <button class="shipment-editor-tab" data-editor-tab="client">Cliente</button>
        <button class="shipment-editor-tab" data-editor-tab="whatsapp">WhatsApp</button>
        <button class="shipment-editor-tab" data-editor-tab="history">Historial</button>
      </div>
      <div class="shipment-editor-body"><div id="shipmentEditorMessage"></div>
        <section class="shipment-editor-panel active" data-editor-panel="general"><div class="shipment-editor-grid"><div><label>Cliente *</label><select id="editorClient"><option value="">Seleccionar cliente</option>${options(x.client_id)}</select></div><div><label>Número de contenedor *</label><input id="editorContainer" value="${esc(x.container_number)}" maxlength="11"></div><div><label>Producto</label><input id="editorProduct" value="${esc(x.product||'')}"></div><div><label>Naviera</label><input id="editorCarrier" value="${esc(x.carrier||'')}"></div><div><label>Booking</label><input id="editorBooking" value="${esc(x.booking_number||'')}"></div><div><label>Bill of Lading (B/L)</label><input id="editorBol" value="${esc(x.bol_number||'')}"></div><div class="full"><label>Estado operativo</label><select id="editorStatus">${statuses(x.operational_status||x.last_status||'Registrado')}</select></div></div></section>
        <section class="shipment-editor-panel" data-editor-panel="tracking">${x.shipsgo_error?`<div class="editor-error"><b>Error de ShipsGo</b><div>${esc(x.shipsgo_error)}</div></div>`:''}<div class="editor-info-grid"><div class="editor-info-card"><b>Estado de tracking</b><div>${esc(x.shipsgo_status||'pending')}</div></div><div class="editor-info-card"><b>ID de ShipsGo</b><div>${esc(x.shipsgo_tracking_id||'-')}</div></div><div class="editor-info-card"><b>Última ubicación</b><div>${esc(x.last_location||'-')}</div></div><div class="editor-info-card"><b>Último evento</b><div>${esc(x.last_status||x.operational_status||'-')}</div></div><div class="editor-info-card"><b>Última actualización</b><div>${x.updated_at?new Date(x.updated_at).toLocaleString('es-US'):'-'}</div></div><div class="editor-info-card"><b>Modo de vínculo</b><div>${esc(x.shipsgo_link_mode||'-')}</div></div></div><div style="margin-top:16px"><button id="editorRetryShipsGo" class="alt">Actualizar / reintentar ShipsGo</button></div></section>
        <section class="shipment-editor-panel" data-editor-panel="client"><div class="editor-info-grid"><div class="editor-info-card"><b>Nombre</b><div>${esc(c.name||'-')}</div></div><div class="editor-info-card"><b>Empresa</b><div>${esc(c.company||'-')}</div></div><div class="editor-info-card"><b>WhatsApp</b><div>${esc(c.phone||'-')}</div></div><div class="editor-info-card"><b>Correo</b><div>${esc(c.email||'-')}</div></div></div><div style="margin-top:16px"><button id="editorOpenClient" class="alt">Abrir historial del cliente</button></div></section>
        <section class="shipment-editor-panel" data-editor-panel="whatsapp">
          <div class="editor-warning"><b>Modo de prueba manual</b><div>Estos botones envían las plantillas reales al WhatsApp del cliente, pero no cambian el estado del contenedor. Así puedes probar el ciclo completo sin esperar eventos de ShipsGo.</div></div>
          <div class="editor-info-grid"><div class="editor-info-card"><b>Destinatario</b><div>${esc(c.name||'-')} · ${esc(c.phone||'Sin teléfono')}</div></div><div class="editor-info-card"><b>Contenedor</b><div>${esc(x.container_number)}</div></div></div>
          <div class="wa-test-fields"><div><label>Estado para prueba de tracking</label><input id="waTestStatus" value="${esc(testStatus)}"></div><div><label>Ubicación para prueba de tracking</label><input id="waTestLocation" value="${esc(testLocation)}"></div></div>
          <div class="wa-test-grid">
            <article class="wa-test-card"><h3>1. Bienvenida</h3><p>Envía la plantilla de bienvenida al cliente.</p><button class="alt" data-send-template="welcome">Enviar bienvenida</button></article>
            <article class="wa-test-card"><h3>2. Contenedor registrado</h3><p>Confirma que el contenedor fue registrado.</p><button class="alt" data-send-template="registered">Enviar contenedor registrado</button></article>
            <article class="wa-test-card"><h3>3. En tránsito</h3><p>Usa el estado y la ubicación escritos arriba.</p><button class="alt" data-send-template="tracking">Enviar actualización de tracking</button></article>
            <article class="wa-test-card"><h3>4. Disponible en Cuba</h3><p>Envía la plantilla de mercancía liberada o disponible.</p><button class="alt" data-send-template="release">Enviar mercancía disponible</button></article>
          </div>
          <div id="waTestStatusMessage" class="wa-test-status"></div>
          <div class="wa-test-meta">Cada envío queda registrado en el Centro de notificaciones y en el historial del contenedor.</div>
        </section>
        <section class="shipment-editor-panel" data-editor-panel="history"><div id="shipmentTimelineRoot" class="timeline-empty">Abre esta pestaña para cargar el historial.</div></section>
      </div>
      <div class="shipment-editor-footer"><div class="muted">Los cambios y envíos se registran en la auditoría del ERP.</div><div class="shipment-editor-actions"><button id="shipmentEditorCancel" class="alt">Cancelar</button><button id="shipmentEditorSave" class="orange">Guardar cambios</button></div></div>`;
  }

  function setMessage(type, text) {
    const t = byId('shipmentEditorMessage');
    if (!t) return;
    t.className = type ? `editor-${type}` : '';
    t.textContent = text || '';
  }

  function setWhatsAppMessage(type, text) {
    const t = byId('waTestStatusMessage');
    if (!t) return;
    t.className = type ? `wa-test-status editor-${type}` : 'wa-test-status';
    t.textContent = text || '';
  }

  const norm = v => String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');

  function validate() {
    const client = byId('editorClient').value;
    const container = norm(byId('editorContainer').value);
    if (!client) return 'Selecciona un cliente.';
    if (!/^[A-Z]{4}\d{7}$/.test(container)) return 'El contenedor debe tener 4 letras y 7 números.';
    if ((shipments||[]).some(s=>s.id!==current.id&&norm(s.container_number)===container)) return 'Ese número de contenedor ya está registrado.';
    return '';
  }

  function payload() {
    return {
      id: current.id,
      client_id: byId('editorClient').value,
      container_number: norm(byId('editorContainer').value),
      product: byId('editorProduct').value.trim(),
      carrier: byId('editorCarrier').value.trim(),
      booking_number: byId('editorBooking').value.trim(),
      bol_number: byId('editorBol').value.trim(),
      operational_status: byId('editorStatus').value.trim()
    };
  }

  function classify(e) {
    const a = (String(e.event_type||'')+' '+String(e.title||'')+' '+String(e.status||e.delivery_status||'')).toLowerCase();
    const source = String(e.source||'').toLowerCase();
    if (/fail|error|undelivered/.test(a)) return {group:'errors',tone:'error',label:'Error',cls:'error'};
    if (source==='shipsgo'||/shipsgo|tracking|ubicación|location|tránsito|transit/.test(a)) return {group:'tracking',tone:'info',label:'Tracking',cls:'tracking'};
    if (e.channel==='whatsapp'||source==='whatsapp'||/whatsapp|notification|mensaje/.test(a)) return {group:'whatsapp',tone:/pending|queued/.test(a)?'warning':'success',label:'WhatsApp',cls:'whatsapp'};
    return {group:'manual',tone:/created|updated|released|delivered|reactivated/.test(a)?'success':'warning',label:'Manual',cls:'manual'};
  }

  function renderTimeline() {
    const root = byId('shipmentTimelineRoot');
    if (!root) return;
    const filtered = timelineFilter==='all' ? timelineEvents : timelineEvents.filter(e=>classify(e).group===timelineFilter);
    const counts = {tracking:0,whatsapp:0,manual:0,errors:0};
    timelineEvents.forEach(e=>counts[classify(e).group]++);
    root.innerHTML = `<div class="timeline-toolbar"><div class="timeline-filters">${[['all','Todos'],['tracking','Tracking'],['manual','Cambios manuales'],['whatsapp','WhatsApp'],['errors','Errores']].map(([k,l])=>`<button class="timeline-filter ${timelineFilter===k?'active':''}" data-timeline-filter="${k}">${l}</button>`).join('')}</div><button id="timelineRefresh" class="alt">Actualizar</button></div><div class="timeline-summary"><div class="timeline-summary-card"><span>Total</span><b>${timelineEvents.length}</b></div><div class="timeline-summary-card"><span>Tracking</span><b>${counts.tracking}</b></div><div class="timeline-summary-card"><span>WhatsApp</span><b>${counts.whatsapp}</b></div><div class="timeline-summary-card"><span>Errores</span><b>${counts.errors}</b></div></div>${filtered.length?`<div class="timeline-pro">${filtered.map(e=>{const m=classify(e);return`<article class="timeline-event ${m.tone}"><span class="timeline-dot"></span><div class="timeline-card"><div class="timeline-head"><div class="timeline-title">${esc(e.title||e.action||'Evento')}</div><span class="timeline-badge ${m.cls}">${m.label}</span></div>${e.details?`<div class="timeline-details">${esc(e.details)}</div>`:''}<div class="timeline-meta"><span>${e.created_at?new Date(e.created_at).toLocaleString('es-US'):'-'}</span><span>Origen: ${esc(e.actor||e.username||e.source||'Sistema')}</span></div></div></article>`}).join('')}</div>`:'<div class="timeline-empty">No hay eventos para este filtro.</div>'}`;
    root.querySelectorAll('[data-timeline-filter]').forEach(b=>b.onclick=()=>{timelineFilter=b.dataset.timelineFilter;renderTimeline();});
    byId('timelineRefresh').onclick=()=>loadTimeline(true);
  }

  async function loadTimeline(force=false) {
    if (timelineLoaded&&!force) return;
    const root = byId('shipmentTimelineRoot');
    if (!root) return;
    root.className='timeline-empty';
    root.textContent='Cargando historial...';
    try {
      const r = await api('/api/history?shipment_id='+encodeURIComponent(current.id));
      timelineEvents = [
        ...(r.events||[]),
        ...(r.notifications||[]).map(n=>({...n,title:'WhatsApp · '+(n.event_type||n.event_status||'Notificación'),details:n.error_message||n.status||n.delivery_status||'',source:'whatsapp'})),
        ...(r.audit_events||[]).map(a=>({...a,title:a.title||a.action||'Cambio administrativo',details:typeof a.details==='string'?a.details:JSON.stringify(a.details||{}),source:'admin'}))
      ].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
      timelineLoaded=true;
      root.className='';
      renderTimeline();
    } catch (e) {
      root.innerHTML=`<div class="editor-error"><b>No se pudo cargar el historial</b><div>${esc(e.message)}</div></div><button id="timelineRetry" class="alt">Reintentar</button>`;
      byId('timelineRetry').onclick=()=>loadTimeline(true);
    }
  }

  async function sendTemplate(type, button) {
    if (sendingTemplate) return;
    const labels = {welcome:'bienvenida',registered:'contenedor registrado',tracking:'actualización de tracking',release:'mercancía disponible'};
    const label = labels[type] || type;
    if (!confirm(`¿Enviar ahora la plantilla de ${label} al WhatsApp del cliente?`)) return;
    sendingTemplate = true;
    const original = button.textContent;
    document.querySelectorAll('[data-send-template]').forEach(b=>b.disabled=true);
    button.textContent='Enviando...';
    setWhatsAppMessage('', '');
    try {
      const result = await api('/api/shipments', {
        method: 'PATCH',
        body: JSON.stringify({
          id: current.id,
          action: 'manual_notification',
          notification_type: type,
          status: byId('waTestStatus')?.value?.trim() || current.last_status || current.operational_status || 'En tránsito',
          location: byId('waTestLocation')?.value?.trim() || current.last_location || 'No disponible'
        })
      });
      setWhatsAppMessage('success', `${result.label || label} enviada. Estado: ${result.status || 'queued'} · SID: ${result.sid || '-'}`);
      timelineLoaded = false;
      if (window.loadNotifications) window.loadNotifications();
    } catch (e) {
      setWhatsAppMessage('error', e.message);
    } finally {
      sendingTemplate = false;
      document.querySelectorAll('[data-send-template]').forEach(b=>b.disabled=false);
      button.textContent=original;
    }
  }

  function closeEditor(force=false) {
    if (!force&&dirty&&!confirm('Hay cambios sin guardar. ¿Cerrar de todas formas?')) return;
    dirty=false;
    current=null;
    timelineLoaded=false;
    timelineEvents=[];
    byId('modal')?.classList.remove('shipment-editor-modal');
    closeModal();
  }

  function bind() {
    byId('shipmentEditorClose').onclick=()=>closeEditor();
    byId('shipmentEditorCancel').onclick=()=>closeEditor();
    document.querySelectorAll('[data-editor-tab]').forEach(b=>b.onclick=()=>{
      document.querySelectorAll('[data-editor-tab]').forEach(x=>x.classList.toggle('active',x===b));
      document.querySelectorAll('[data-editor-panel]').forEach(p=>p.classList.toggle('active',p.dataset.editorPanel===b.dataset.editorTab));
      if (b.dataset.editorTab==='history') loadTimeline();
    });
    document.querySelectorAll('#modal input,#modal select').forEach(f=>f.addEventListener('input',()=>{
      if (!['waTestStatus','waTestLocation'].includes(f.id)) dirty=true;
      setMessage('','');
    }));
    document.querySelectorAll('[data-send-template]').forEach(button=>button.onclick=()=>sendTemplate(button.dataset.sendTemplate,button));

    byId('editorRetryShipsGo').onclick=async()=>{
      const b=byId('editorRetryShipsGo');
      b.disabled=true;
      b.textContent='Actualizando...';
      try {
        await api('/api/shipments',{method:'PATCH',body:JSON.stringify({id:current.id,action:'retry_shipsgo'})});
        setMessage('success','ShipsGo fue actualizado correctamente.');
        await loadAll();
      } catch(e) {
        setMessage('error',e.message);
      } finally {
        b.disabled=false;
        b.textContent='Actualizar / reintentar ShipsGo';
      }
    };

    byId('editorOpenClient').onclick=()=>{
      const c=(clients||[]).find(x=>String(x.id)===String(current.client_id));
      closeEditor(true);
      if(c) clientHistory(c.id,c.name);
    };

    byId('shipmentEditorSave').onclick=async()=>{
      if(saving) return;
      const error=validate();
      if(error) return setMessage('error',error);
      saving=true;
      const b=byId('shipmentEditorSave');
      b.disabled=true;
      b.textContent='Guardando...';
      try {
        await api('/api/shipments',{method:'PATCH',body:JSON.stringify(payload())});
        dirty=false;
        setMessage('success','Cambios guardados correctamente.');
        await loadAll();
        setTimeout(()=>closeEditor(true),450);
      } catch(e) {
        setMessage('error',e.message);
      } finally {
        saving=false;
        b.disabled=false;
        b.textContent='Guardar cambios';
      }
    };
  }

  function install() {
    if(typeof window.api!=='function'||typeof window.openModal!=='function'){
      setTimeout(install,100);
      return;
    }
    styles();
    window.editShipment=id=>{
      const x=(shipments||[]).find(s=>String(s.id)===String(id));
      if(!x) return alert('No se encontró el contenedor.');
      current=x;
      dirty=false;
      timelineLoaded=false;
      timelineFilter='all';
      openModal('',html(x));
      byId('modalTitle').parentElement.style.display='none';
      byId('modal').classList.add('shipment-editor-modal');
      bind();
      setTimeout(()=>byId('editorContainer')?.focus(),50);
    };
    const original=window.closeModal;
    window.closeModal=()=>byId('modal')?.classList.contains('shipment-editor-modal')&&current?closeEditor():original();
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&byId('modal')?.classList.contains('shipment-editor-modal')){
        e.preventDefault();
        closeEditor();
      }
    });
  }

  install();
})();
