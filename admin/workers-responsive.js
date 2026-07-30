(() => {
  if (window.__workersResponsiveInstalled) return;
  window.__workersResponsiveInstalled = true;

  const style = document.createElement('style');
  style.id = 'workersResponsiveStyles';
  style.textContent = `
    #workersSection,#workersSection *{max-width:100%}
    #workers{min-width:0;overflow:visible}
    #workers table{width:100%;table-layout:auto}
    #workers .actions{display:flex;gap:7px;align-items:center;flex-wrap:nowrap}
    #workers .actions button{width:auto;min-width:0;padding:8px 10px;font-size:12px;white-space:nowrap}

    @media(max-width:700px){
      #workersSection .card{padding:16px!important;overflow:hidden}
      #workers .section-head{align-items:flex-start}
      #workers .section-head>button{padding:9px 11px;font-size:12px}
      #workers table{display:block!important;width:100%!important;min-width:760px!important;overflow-x:auto!important;white-space:nowrap!important;-webkit-overflow-scrolling:touch}
      #workers thead,#workers tbody{display:table;width:100%;table-layout:auto}
      #workers tr{display:table-row}
      #workers th,#workers td{display:table-cell;width:auto;padding:10px 7px;white-space:nowrap}
      #workers td:last-child,#workers th:last-child{position:sticky;right:0;background:#fff;z-index:2;box-shadow:-8px 0 12px rgba(6,32,74,.05)}
      #workers th:last-child{background:#f8fafc;z-index:3}
      #workers .actions{justify-content:center}
      #workers .pill{display:inline-flex}
    }
  `;
  document.head.appendChild(style);
})();