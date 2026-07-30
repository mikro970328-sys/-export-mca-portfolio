(() => {
  if (window.__workersResponsiveInstalled) return;
  window.__workersResponsiveInstalled = true;

  const style = document.createElement('style');
  style.id = 'workersResponsiveStyles';
  style.textContent = `
    #workersSection,#workersSection *{max-width:100%}
    #workers{min-width:0;overflow:hidden}
    #workers table{width:100%;table-layout:auto}
    #workers .actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
    #workers .actions button{width:auto;min-width:0;padding:8px 10px;font-size:12px;white-space:nowrap}

    @media(max-width:700px){
      #workersSection .card{padding:16px!important;overflow:hidden}
      #workers .section-head{align-items:flex-start}
      #workers .section-head>button{padding:9px 11px;font-size:12px}
      #workers table,#workers thead,#workers tbody,#workers tr,#workers th,#workers td{display:block;width:100%}
      #workers table{overflow:visible!important;white-space:normal!important;margin-top:12px}
      #workers thead{display:none}
      #workers tbody{display:grid;gap:12px}
      #workers tr{border:1px solid var(--line);border-radius:13px;padding:13px;background:#fff;box-shadow:0 6px 18px rgba(6,32,74,.05)}
      #workers td{border:0;padding:5px 0;text-align:left;white-space:normal;overflow-wrap:anywhere}
      #workers td:nth-child(1) b{display:block;font-size:16px;color:var(--navy);margin-bottom:2px}
      #workers td:nth-last-child(2){padding-top:8px}
      #workers td:last-child{padding-top:10px}
      #workers .actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%}
      #workers .actions button{width:100%;min-height:42px;padding:9px 8px;font-size:12px}
      #workers .actions .danger,#workers .actions .success{grid-column:1/-1}
      #workers .pill{display:inline-flex}
    }
  `;
  document.head.appendChild(style);
})();