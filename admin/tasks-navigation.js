(() => {
  'use strict';
  if (window.__tasksNavigationInstalled) return;
  window.__tasksNavigationInstalled = true;

  let workspaceWrapped=false;

  function bindSection() {
    const button=document.querySelector('[data-section="tasksSection"]');
    if(!button)return false;
    button.onclick=event=>{
      event.preventDefault();
      if(typeof window.showSection==='function') window.showSection('tasksSection');
    };
    return true;
  }

  function taskFor(id) {
    return (window.TasksWorkspace?.state?.tasks||[]).find(task=>String(task.id)===String(id))||null;
  }

  function workError(message) {
    const body=document.getElementById('tasksModalBody');
    if(!body)return;
    let node=document.getElementById('tasksWorkError');
    if(!node){
      node=document.createElement('div');
      node.id='tasksWorkError';
      node.className='tasks-message bad';
      body.prepend(node);
    }
    node.textContent=message||'No se pudo abrir el trabajo relacionado.';
  }

  function decorate(taskId) {
    const task=taskFor(taskId),modal=document.getElementById('tasksModal'),actions=document.getElementById('tasksModalActions');
    if(!task||!actions||modal?.classList.contains('hidden'))return false;
    actions.querySelector('[data-task-open-work]')?.remove();
    document.getElementById('tasksWorkError')?.remove();
    if(!task.entity_type||!task.entity_id)return false;
    const button=document.createElement('button');
    button.type='button';
    button.dataset.taskOpenWork=task.id;
    button.className='success';
    button.textContent='Abrir trabajo';
    button.addEventListener('click',async()=>{
      button.disabled=true;
      try{
        const nav=window.OperationalNavigation;
        if(!nav?.openWork)throw new Error('La navegación operativa todavía no está disponible.');
        const opened=await nav.openWork(task);
        if(opened===false)throw new Error('No se pudo localizar el trabajo relacionado.');
        document.getElementById('tasksModal')?.classList.add('hidden');
      }catch(error){
        workError(error.message||'No se pudo abrir el trabajo relacionado.');
      }finally{button.disabled=false;}
    });
    actions.prepend(button);
    return true;
  }

  function wrapWorkspace() {
    const workspace=window.TasksWorkspace;
    if(!workspace||workspaceWrapped)return Boolean(workspace);
    const originalOpen=workspace.open?.bind(workspace);
    if(typeof originalOpen!=='function')return false;
    const open=async id=>{
      const result=await originalOpen(id);
      decorate(id);
      return result;
    };
    window.TasksWorkspace=Object.freeze({...workspace,open,openWork:async id=>{
      const task=taskFor(id);
      if(!task)throw new Error('Tarea no encontrada.');
      return window.OperationalNavigation?.openWork?.(task);
    }});
    workspaceWrapped=true;
    return true;
  }

  function interceptTaskOpen(event) {
    const target=event.target instanceof Element?event.target:null;
    if(!target||!target.closest('#tasksSection'))return;
    const action=target.closest('[data-task-action="open"]');
    const row=target.closest('[data-task-open]');
    const id=action?.dataset.id||row?.dataset.taskOpen;
    if(!id)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    Promise.resolve(window.TasksWorkspace?.open?.(id)).catch(error=>console.error('[task navigation]',error));
  }

  function install() {
    bindSection();
    if(!wrapWorkspace())return false;
    document.addEventListener('click',interceptTaskOpen,true);
    return true;
  }

  if(!install()) window.addEventListener('export-mca:admin-ready',install,{once:true});
})();
