(() => {
  'use strict';
  if (window.__tasksNavigationInstalled) return;
  window.__tasksNavigationInstalled = true;

  function bind() {
    const button=document.querySelector('[data-section="tasksSection"]');
    if(!button)return false;
    button.onclick=event=>{
      event.preventDefault();
      if(typeof window.showSection==='function') window.showSection('tasksSection');
    };
    return true;
  }

  if(!bind()) window.addEventListener('export-mca:admin-ready',bind,{once:true});
})();
