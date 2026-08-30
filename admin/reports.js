(() => {
  'use strict';
  if(window.__executiveReportsInstalled)return;
  window.__executiveReportsInstalled=true;

  const $=id=>document.getElementById(id);
  const state={dataset:'sales',datasets:[],columns:[],rows:[],options:null,dimensions:new Set(),basis:'period_activity',loading:false};
  const token=()=>localStorage.getItem('export_mca_token')||'';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const MONEY_FIELDS=new Set(['order_total','attributed_sales_revenue','unattributed_order_value','recognized_merchandise_cogs','gross_margin','direct_cost_amount','contribution_margin','invoice_total','paid_amount','balance_due','bill_total','amount']);
  const PERCENT_FIELDS=new Set(['gross_margin_pct','contribution_margin_pct']);
  const NUMBER_FIELDS=new Set(['item_count','costed_item_count','physical_quantity','reserved_quantity','available_quantity','physical_pallets','reserved_pallets','available_pallets']);

  async function request(url,options={}){
    const response=await fetch(url,{...options,headers:{...(token()?{Authorization:`Bearer ${token()}`}:{ } ),...(options.headers||{})}});
    if(options.raw)return response;
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'No se pudo cargar Reportes');
    return data;
  }

  function optionHtml(rows,labeler){return (rows||[]).map(row=>`<option value="${esc(row.id)}">${esc(labeler(row))}</option>`).join('');}
  function populateOptions(options={}){
    state.options=options;
    $('currency').innerHTML='<option value="">Todas, separadas</option>'+((options.currencies||[]).map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join(''));
    $('clientId').innerHTML='<option value="">Todos</option>'+optionHtml(options.clients,row=>row.company?`${row.name} · ${row.company}`:row.name);
    $('supplierId').innerHTML='<option value="">Todos</option>'+optionHtml(options.suppliers,row=>row.legal_name?`${row.name} · ${row.legal_name}`:row.name);
    $('productId').innerHTML='<option value="">Todos</option>'+optionHtml(options.products,row=>[row.sku,row.name,row.brand].filter(Boolean).join(' · '));
  }

  function renderTabs(){
    $('datasetTabs').innerHTML=state.datasets.map(item=>`<button type="button" class="dataset-tab ${item.key===state.dataset?'active':''}" data-dataset="${esc(item.key)}">${esc(item.label)}</button>`).join('');
    $('datasetTabs').querySelectorAll('[data-dataset]').forEach(button=>button.addEventListener('click',()=>switchDataset(button.dataset.dataset)));
  }

  function setDimensions(dimensions,basis){
    state.dimensions=new Set(dimensions||[]);
    state.basis=basis||'period_activity';
    document.querySelectorAll('[data-filter-dimension]').forEach(label=>label.classList.toggle('dimension-hidden',!state.dimensions.has(label.dataset.filterDimension)));
    if(!state.dimensions.has('period')){$('startDate').value='';$('endDate').value='';}
    if(!state.dimensions.has('currency'))$('currency').value='';
    if(!state.dimensions.has('client'))$('clientId').value='';
    if(!state.dimensions.has('supplier'))$('supplierId').value='';
    if(!state.dimensions.has('product'))$('productId').value='';
  }

  function filters(){
    return {
      start_date:$('startDate').value,
      end_date:$('endDate').value,
      currency:$('currency').value,
      client_id:$('clientId').value,
      supplier_id:$('supplierId').value,
      product_id:$('productId').value,
      limit:$('rowLimit').value
    };
  }

  function buildUrl(format='json',includeOptions=true){
    const params=new URLSearchParams({dataset:state.dataset,limit:$('rowLimit').value});
    const current=filters();
    for(const [key,value] of Object.entries(current)){
      if(key==='limit'||!value)continue;
      params.set(key,value);
    }
    if(format==='csv')params.set('format','csv');
    if(!includeOptions)params.set('include_options','0');
    return `/api/reports?${params.toString()}`;
  }

  function formatValue(row,key){
    const value=row?.[key];
    if(value===null||value===undefined||value==='')return '—';
    if(typeof value==='boolean')return value?'Sí':'No';
    if(key==='direction')return value==='in'?'Entrada':value==='out'?'Salida':String(value);
    if(PERCENT_FIELDS.has(key))return `${Number(value).toLocaleString('es-US',{minimumFractionDigits:1,maximumFractionDigits:2})}%`;
    if(MONEY_FIELDS.has(key)){
      const currency=row?.currency||'';
      const amount=Number(value);
      if(currency){try{return new Intl.NumberFormat('es-US',{style:'currency',currency:String(currency).toUpperCase(),maximumFractionDigits:2}).format(amount);}catch{}}
      return amount.toLocaleString('es-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    }
    if(NUMBER_FIELDS.has(key))return Number(value).toLocaleString('es-US',{maximumFractionDigits:4});
    return String(value);
  }

  function renderMeta(payload){
    const filters=payload.filters||{};
    const chips=[
      `${payload.row_count||0} fila(s)`,
      state.basis==='current_snapshot'?'Base: snapshot actual':'Base: actividad del período',
      'FX: no se aplica'
    ];
    if(filters.start_date||filters.end_date)chips.push(`Período: ${filters.start_date||'…'} → ${filters.end_date||'…'}`);
    if(filters.currency)chips.push(`Moneda: ${filters.currency}`);
    if(Number(payload.row_count||0)>=Number(payload.limit||0))chips.push(`Límite alcanzado: ${payload.limit}`);
    $('reportMeta').innerHTML=chips.map((value,index)=>`<span class="meta-chip ${index===1&&state.basis==='current_snapshot'?'snapshot-note':''}">${esc(value)}</span>`).join('');
  }

  function renderTable(){
    const target=$('reportTable');
    if(!state.rows.length){target.innerHTML='<div class="empty">No hay filas para los filtros seleccionados.</div>';return;}
    const header=state.columns.map(column=>`<th>${esc(column.label)}</th>`).join('');
    const body=state.rows.map(row=>`<tr>${state.columns.map(column=>{
      const raw=row?.[column.key];
      const numeric=MONEY_FIELDS.has(column.key)||PERCENT_FIELDS.has(column.key)||NUMBER_FIELDS.has(column.key);
      const negative=numeric&&Number(raw)<0;
      return `<td class="${numeric?'numeric':''} ${negative?'negative':''}">${esc(formatValue(row,column.key))}</td>`;
    }).join('')}</tr>`).join('');
    target.innerHTML=`<table class="report-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function setMessage(message,bad=false){const node=$('reportMessage');node.textContent=message||'';node.className=`report-message ${message&&bad?'bad':''}`;}
  function setLoading(value){state.loading=value;for(const id of ['refreshReport','exportReport','clearFilters','applyFilters']){const node=$(id);if(node)node.disabled=value;}}

  async function loadReport(includeOptions=false){
    if(state.loading)return;
    setLoading(true);setMessage('');
    try{
      const data=await request(buildUrl('json',includeOptions||!state.options));
      state.datasets=Array.isArray(data.datasets)?data.datasets:state.datasets;
      state.columns=Array.isArray(data.report?.columns)?data.report.columns:[];
      state.rows=Array.isArray(data.rows)?data.rows:[];
      setDimensions(data.report?.dimensions||[],data.report?.basis);
      if(data.filter_options)populateOptions(data.filter_options);
      renderTabs();renderMeta(data);renderTable();
      parent?.dispatchEvent?.(new CustomEvent('export-mca:data-loaded'));
    }catch(error){setMessage(error.message||'No se pudo cargar el reporte.',true);$('reportTable').innerHTML='<div class="empty">No se pudo cargar el reporte.</div>';}
    finally{setLoading(false);}
  }

  async function switchDataset(dataset){
    if(!dataset||dataset===state.dataset)return;
    state.dataset=dataset;
    const config=state.datasets.find(item=>item.key===dataset);
    if(config)setDimensions(config.dimensions,config.basis);
    renderTabs();
    await loadReport(false);
  }

  function clearFilters(){
    for(const id of ['startDate','endDate','currency','clientId','supplierId','productId'])$(id).value='';
    $('rowLimit').value='1000';
    loadReport(false);
  }

  function filenameFromDisposition(header){
    const match=String(header||'').match(/filename="?([^";]+)"?/i);
    return match?.[1]||`export-mca-${state.dataset}.csv`;
  }

  async function exportCsv(){
    if(state.loading)return;
    setLoading(true);setMessage('');
    try{
      const response=await request(buildUrl('csv',false),{raw:true});
      if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'No se pudo exportar CSV');}
      const blob=await response.blob();
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;link.download=filenameFromDisposition(response.headers.get('Content-Disposition'));document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
    }catch(error){setMessage(error.message||'No se pudo exportar CSV.',true);}
    finally{setLoading(false);}
  }

  $('refreshReport').addEventListener('click',()=>loadReport(false));
  $('applyFilters').addEventListener('click',()=>loadReport(false));
  $('clearFilters').addEventListener('click',clearFilters);
  $('exportReport').addEventListener('click',exportCsv);
  loadReport(true);
  window.ExecutiveReports=Object.freeze({refresh:()=>loadReport(false),owner:'reports.js',source:'api/reports.js'});
})();
