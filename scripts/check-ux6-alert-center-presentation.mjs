import fs from 'node:fs';

const source = fs.readFileSync('admin/operational-alert-center.js','utf8');
const failures=[];
const requireText=(text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(pattern,label)=>{if(pattern.test(source))failures.push(label);};

forbid(/\b(?:confirm|alert|prompt)\s*\(/,'el centro de alertas no puede usar diálogos nativos');
forbid(/setFeedback\s*\(\s*error(?:\?\.)?\.message/,'no se puede mostrar error.message crudo en feedback');
forbid(/esc\s*\(\s*error(?:\?\.)?\.message/,'no se puede renderizar error.message crudo');
forbid(/No se pudieron cargar las alertas:\s*\$\{/,'el estado de carga no puede interpolar errores técnicos');
forbid(/Handoff sin routing|\(legacy\)|Tracking legacy|\bcanónicas\b/,'quedan etiquetas técnicas/legacy visibles');

requireText('function retryMessageDialog(row)','modal controlado para reintento');
requireText('data-message-retry-confirm','acción explícita de reintento');
requireText("await patchAlert(id,'retry')",'reintento conserva owner backend');
requireText("console.error('MESSAGE_RETRY_FAILED',error)",'diagnóstico técnico de reintento');
requireText('No se pudo reintentar el mensaje. Intenta nuevamente.','mensaje operativo de fallo de reintento');
requireText("console.error('OPERATIONAL_ALERT_ACTION_FAILED',error)",'diagnóstico técnico de acción de alerta');
requireText('No se pudo actualizar la alerta. Intenta nuevamente.','mensaje operativo de acción fallida');
requireText("console.error('UNIFIED_ALERT_CENTER_LOAD_ERROR',error)",'diagnóstico técnico de carga');
requireText('No se pudieron actualizar las alertas y mensajes. Intenta nuevamente.','feedback operativo de carga');
requireText('No se pudieron actualizar las alertas en este momento.','empty state estable de carga');
requireText("workflow_route_invalid:'Flujo de trabajo sin destino'",'traducción de routing');
requireText("shipment_customs_documents_missing:'Documentos Cuba pendientes'",'retiro de etiqueta legacy documentos');
requireText("tracking_stale:'Tracking sin actualización'",'retiro de etiqueta tracking legacy');

requireText("['pending','snoozed'].includes(alertStatus(row))",'lifecycle activo P9');
requireText("patchAlert(id,action",'mutación de alertas por owner existente');
requireText("notification_scope==='operational'",'separación de alertas operativas');
requireText('Alertas = excepciones. Tareas = trabajo. Mensajes = entrega al cliente.','separación TASK/ALERT/NOTIFICATION');

if(failures.length){
  console.error('UX6 alert center presentation gate failed:\n'+failures.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}
console.log('UX6 alert center presentation gate passed.');
