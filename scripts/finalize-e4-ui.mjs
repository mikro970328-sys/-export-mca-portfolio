import fs from 'node:fs';
const path = 'admin/expedientes-module.js';
let source = fs.readFileSync(path, 'utf8');
function replaceOnce(from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: se esperaba 1 coincidencia y hubo ${count}`);
  source = source.replace(from, to);
}
replaceOnce("    if (isFinalized(operation)) return 'Entregado';", "    if (isFinalized(operation)) return 'Finalizado';", 'estado Finalizado');
replaceOnce("<div class=\"exp-summary-actions\"><button id=\"manageExpContainers\" class=\"alt\" type=\"button\">Gestionar contenedores</button><button id=\"toggleExpDelivered\" class=\"${delivered ? 'alt' : 'orange'}\" type=\"button\">${delivered ? 'Reabrir expediente' : 'Marcar entregado'}</button></div>", "<div class=\"exp-summary-actions\"><button id=\"manageExpContainers\" class=\"alt\" type=\"button\">Gestionar contenedores</button></div>", 'quitar control manual');
replaceOnce("    const statusButton=byId('toggleExpDelivered'); if (statusButton) statusButton.onclick=() => setOperationStatus(operation,isFinalized(operation) ? 'draft' : 'delivered');\n", "", 'quitar binding manual');
fs.writeFileSync(path, source);
console.log('Cierre visual UX-E4 aplicado');
