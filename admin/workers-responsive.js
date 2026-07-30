(() => {
  if (window.__workersResponsiveInstalled) return;
  window.__workersResponsiveInstalled = true;

  const style = document.createElement('style');
  style.id = 'workersResponsiveStyles';
  style.textContent = `
    #workersSection{max-width:100%}
    #workers{min-width:0;overflow:visible}
    #workers .worker-table-wrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:10px}
    #workers table{width:100%;min-width:820px;table-layout:auto;margin-top:12px}
    #workers .actions{display:flex;gap:7px;align-items:center;justify-content:center;flex-wrap:nowrap}
    #workers .actions button{width:auto;min-width:0;padding:8px 10px;font-size:12px;white-space:nowrap}

    @media(max-width:700px){
      #workersSection .card{padding:16px!important;overflow:visible!important}
      #workers .section-head{align-items:flex-start}
      #workers .section-head>button{padding:9px 11px;font-size:12px}
      #workers .worker-table-wrap{margin-left:0;margin-right:0;padding-bottom:4px}
      #workers table{min-width:820px!important;display:table!important;white-space:nowrap!important}
      #workers thead{display:table-header-group!important}
      #workers tbody{display:table-row-group!important}
      #workers tr{display:table-row!important}
      #workers th,#workers td{display:table-cell!important;width:auto!important;padding:10px 12px!important;white-space:nowrap!important}
      #workers td:last-child,#workers th:last-child{position:sticky;right:0;background:#fff;z-index:4;box-shadow:-8px 0 12px rgba(6,32,74,.08)}
      #workers th:last-child{background:#f8fafc;z-index:5}
      #workers .pill{display:inline-flex}
    }
  `;
  document.head.appendChild(style);

  function wrapTables(){
    document.querySelectorAll('#workers table').forEach(table => {
      if (table.parentElement?.classList.contains('worker-table-wrap')) return;
      const wrap = document.createElement('div');
      wrap.className = 'worker-table-wrap';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }

  wrapTables();
  const observer = new MutationObserver(() => queueMicrotask(wrapTables));
  observer.observe(document.body,{childList:true,subtree:true});
})();