import fs from 'node:fs';
const path='admin/expedientes-module.js';
let source=fs.readFileSync(path,'utf8');
const block=`  async function setOperationStatus(operation,status) {\n    const button=byId('toggleExpDelivered'); if (button?.disabled) return; button.disabled=true;\n    try { await api('/api/operations',{ method:'PATCH',body:JSON.stringify({ action:'set_status',operation_id:operation.id,status }) }); state.tab=status === 'delivered' ? 'delivered' : 'active'; await loadData(); updateTabs(); if (typeof window.closeModal === 'function') window.closeModal(); }\n    catch (error) { button.disabled=false; alert(error.message || 'No se pudo actualizar el estado del expediente.'); }\n  }\n`;
const count=source.split(block).length-1;
if(count!==1) throw new Error(`setOperationStatus: se esperaba 1 coincidencia y hubo ${count}`);
source=source.replace(block,'');
fs.writeFileSync(path,source);
console.log('Código muerto UX-E4 eliminado');
