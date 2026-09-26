import {test,expect} from '@playwright/test';
import {tasksWorkersFixture} from '../../scripts/lib/figma-tasks-workers-fixture.mjs';
async function open(page,module,options={}){
 const url='https://erp-visual.invalid/',html=tasksWorkersFixture({module,...options});
 await page.route('**/*',route=>route.request().url()===url?route.fulfill({contentType:'text/html',body:html}):route.abort());
 await page.goto(url);await page.evaluate(()=>document.fonts.ready);
 if(!options.failRead)await expect(page.locator(module==='tasks'?'#taskMetricPending strong':'#workersMetricTotal strong')).toHaveText(module==='tasks'?'2':'3');
}
const writes=page=>page.evaluate(()=>window.__fixtureCalls.filter(c=>c.method!=='GET'));
async function shot(page,info,name,fullPage=false){const path=info.outputPath(name+'.png');await page.screenshot({path,fullPage,animations:'disabled',scale:'css'});await info.attach(name,{path,contentType:'image/png'});}
async function fits(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);}
async function hit(page,selector){const n=page.locator(selector);await n.scrollIntoViewIfNeeded();expect(await n.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;})).toBe(true);}
async function primaryContrast(page,selector){
 const button=page.locator(selector);await button.hover();
 const contrast=await button.evaluate(el=>{const s=getComputedStyle(el);const l=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);const a=l(s.color),b=l(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
 expect(contrast).toBeGreaterThanOrEqual(4.5);
}
const taskDetail=async page=>{await page.locator('[data-task-action="open"][data-id="task-0"]').click();await expect(page.locator('#tasksModalTitle')).toHaveText('Revisar documentación del contenedor');};
for(const width of [1440,390]){
 test(`Tasks: queue metrics, keyboard filtering and linked context at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:'dark'});await open(page,'tasks');await fits(page);await expect(page.locator('.tasks-card')).toHaveCount(2);await shot(page,info,'tareas',true);
  await page.locator('#taskMetricBlocked').focus();await page.keyboard.press('Enter');await expect(page.locator('#taskMetricBlocked')).toBeFocused();await expect(page.locator('.tasks-card')).toHaveCount(1);await expect(page.locator('.tasks-card')).toContainText('Resolver documento');
  await page.locator('[data-task-action="clear"]').first().click();await expect(page.locator('#tasksSearch')).toBeFocused();await expect(page.locator('.tasks-card')).toHaveCount(5);
  await page.locator('#tasksTeamFilter').selectOption('team-1');await expect(page.locator('.tasks-card')).toHaveCount(1);await expect(page.locator('.tasks-card')).toContainText('Ana Pérez');await page.locator('#tasksSearch').fill('SO-DEMO-019');await expect(page.locator('.tasks-card')).toHaveCount(1);
  await page.locator('#tasksPriorityFilter').selectOption('critical');await expect(page.locator('.tasks-empty')).toContainText('No hay tareas');expect(await writes(page)).toEqual([]);
 });
 test(`Workers: status tabs, search and history at ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await open(page,'workers');await fits(page);await shot(page,info,'trabajadores',true);
  await page.locator('[data-worker-filter="active"]').focus();await page.keyboard.press('End');await expect(page.locator('[data-worker-filter="inactive"]')).toBeFocused();await expect(page.locator('.workers-card')).toHaveCount(1);await expect(page.locator('.workers-card')).toContainText('Ausencia temporal');
  await page.keyboard.press('Home');await expect(page.locator('.workers-card')).toHaveCount(2);await page.locator('#workersSearch').fill('Comercial');await expect(page.locator('.workers-card')).toHaveCount(1);
  await page.locator('[data-worker-action="clear"]').first().click();await expect(page.locator('#workersSearch')).toBeFocused();await page.locator('[data-worker-action="history"][data-worker-id="worker-0"]').click();await expect(page.locator('#workerHistoryContent')).toContainText('Reincorporación al equipo');await shot(page,info,'historial-trabajador');
  await page.keyboard.press('Escape');await expect(page.locator('[data-worker-action="history"][data-worker-id="worker-0"]')).toBeFocused();expect(await writes(page)).toEqual([]);
 });
}
for(const viewport of [{width:1440,height:700},{width:390,height:500}]){
 test(`Task creation: assignment validation and failed save preserve work at ${viewport.width}`,async({page},info)=>{
  await page.setViewportSize(viewport);await open(page,'tasks');await page.locator('[data-task-action="create"]').click();await expect(page.locator('#tasksEditForm [name="title"]')).toBeFocused();
  await page.locator('#tasksModalActions .tasks-primary').click();expect(await writes(page)).toEqual([]);
  await page.locator('[name="title"]').fill('Coordinar entrega nueva');await page.locator('[name="description"]').fill('Comprobar documentos y confirmar con el equipo.');await page.locator('[name="priority"]').selectOption('high');await page.locator('[name="due_at"]').fill('2026-09-30T16:00');
  await page.locator('#tasksFormTeam').selectOption('team-0');await expect(page.locator('#tasksFormAssignee option')).toHaveCount(2);await page.locator('#tasksFormAssignee').selectOption('operator-0');await page.locator('#tasksFormTeam').selectOption('team-1');await expect(page.locator('#tasksFormAssignee')).toHaveValue('');await page.locator('#tasksFormAssignee').selectOption('operator-1');
  await page.locator('[name="entity_type"]').selectOption('shipment');await page.locator('[name="entity_id"]').fill('10000000-0000-4000-8000-000000000001');await hit(page,'[name="entity_id"]');await fits(page);await primaryContrast(page,'#tasksModalActions .tasks-primary');await shot(page,info,'nueva-tarea');
  await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#tasksModalActions .tasks-primary').click();await expect(page.locator('#tasksModalError')).toContainText('No se pudo crear');await expect(page.locator('[name="title"]')).toHaveValue('Coordinar entrega nueva');
  await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#tasksModalActions .tasks-primary').click();await expect(page.locator('#tasksModal')).toBeHidden();await expect(page.locator('#taskMetricPending strong')).toHaveText('3');
  const sent=await writes(page);expect(sent).toHaveLength(2);expect(sent[1].body).toMatchObject({action:'create',title:'Coordinar entrega nueva',priority:'high',assigned_team_id:'team-1',assigned_admin_id:'operator-1',entity_type:'shipment',entity_id:'10000000-0000-4000-8000-000000000001'});
  expect(sent[1].body.due_at).toBe(await page.evaluate(()=>new Date('2026-09-30T16:00').toISOString()));
 });
 test(`Worker creation: required fields, focus and safe retry at ${viewport.width}`,async({page},info)=>{
  await page.setViewportSize(viewport);await open(page,'workers');await page.locator('#workersCreateButton').click();await expect(page.locator('#workerName')).toBeFocused();await page.locator('#saveWorker').click();expect(await writes(page)).toEqual([]);
  await page.locator('#workerName').fill('María de ejemplo');await page.locator('#workerPhone').fill('+530000000003');await page.locator('#workerPosition').fill('Almacén');await hit(page,'#workerPosition');await fits(page);await primaryContrast(page,'#saveWorker');await shot(page,info,'nuevo-trabajador');
  await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#saveWorker').click();await expect(page.locator('#workerMsg')).toContainText('No se pudo guardar');await expect(page.locator('#workerName')).toHaveValue('María de ejemplo');await expect(page.locator('#workerPhone')).toBeEnabled();
  await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#saveWorker').click();await expect(page.locator('#workersModal')).toBeHidden();await expect(page.locator('#workersMetricTotal strong')).toHaveText('4');expect((await writes(page)).at(-1).body).toEqual({full_name:'María de ejemplo',phone:'+530000000003',position:'Almacén'});
 });
}
test('Task detail: transitions require reasons, preserve history and retain failed comments',async({page},info)=>{
 await open(page,'tasks');await taskDetail(page);await expect(page.locator('[data-task-transition="cancelled"]')).toBeVisible();await shot(page,info,'detalle-tarea');
 await page.locator('[data-task-transition="blocked"]').click();await expect(page.locator('[name="reason"]')).toBeFocused();await page.locator('#tasksModalActions .tasks-primary').click();await expect(page.locator('#tasksModalError')).toHaveText('Escribe el motivo.');expect(await writes(page)).toEqual([]);
 await page.locator('[name="reason"]').fill('Falta confirmar un documento');await shot(page,info,'bloquear-tarea');await page.locator('#tasksModalActions .tasks-primary').click();await expect(page.locator('.tasks-meta-item').first()).toContainText('Bloqueada');await expect(page.locator('.tasks-history')).toContainText('Cambio de estado');
 await page.locator('[data-task-action="dependencies"]').click();await page.locator('[name="task_dependency"][value="task-4"]').check();await shot(page,info,'dependencias-tarea');await page.locator('#tasksModalActions .tasks-primary').click();await expect(page.locator('.tasks-dependency-list').first()).toContainText('Verificar datos del cliente');
 await page.locator('#tasksCommentForm textarea').fill('Conservar este comentario si falla');await page.evaluate(()=>window.__fixtureRejectWrites=true);await page.locator('#tasksCommentForm button').click();await expect(page.locator('#tasksModalError')).toContainText('No se pudo agregar');await expect(page.locator('#tasksCommentForm textarea')).toHaveValue('Conservar este comentario si falla');
 await page.evaluate(()=>window.__fixtureRejectWrites=false);await page.locator('#tasksCommentForm button').click();await expect(page.locator('.tasks-comment-list')).toContainText('Conservar este comentario si falla');
 await page.evaluate(()=>window.__fixtureBlockCompletion=true);await page.locator('[data-task-transition="completed"]').click();await expect(page.locator('#tasksModalError')).toContainText('Completa primero las dependencias');await expect(page.locator('.tasks-meta-item').first()).toContainText('Bloqueada');
 await page.evaluate(()=>window.__fixtureBlockCompletion=false);await page.locator('[data-task-transition="completed"]').click();await expect(page.locator('.tasks-meta-item').first()).toContainText('Completada');await expect(page.locator('[data-task-transition="pending"]')).toHaveText('Reabrir');
 expect((await writes(page)).find(c=>c.body?.action==='transition').body).toEqual({action:'transition',task_id:'task-0',status:'blocked',reason:'Falta confirmar un documento'});
});
test('Task editing retains ID, values and detail navigation',async({page})=>{
 await open(page,'tasks');await taskDetail(page);await page.locator('[data-task-action="edit-detail"]').click();await expect(page.locator('[name="title"]')).toBeFocused();await page.locator('[name="title"]').fill('Revisar documentación final');await page.locator('#tasksModalActions .tasks-primary').click();await expect(page.locator('#tasksModalTitle')).toHaveText('Revisar documentación final');expect((await writes(page))[0]).toMatchObject({method:'PATCH',body:{id:'task-0',title:'Revisar documentación final',entity_id:'shipment-0'}});
});
test('Task read-only access hides mutations and protects restricted dependencies',async({page})=>{
 await open(page,'tasks',{writable:false,restricted:true});await expect(page.locator('[data-task-action="create"],#tasksAssigneeFilter')).toHaveCount(0);await taskDetail(page);await expect(page.locator('.tasks-action-strip button,#tasksCommentForm')).toHaveCount(0);await expect(page.locator('.tasks-dependency-list')).toContainText('Hay dependencias fuera de tu acceso');expect(await writes(page)).toEqual([]);
});
test('Worker editing retains identity and existing fields',async({page})=>{
 await open(page,'workers');await page.locator('[data-worker-action="edit"][data-worker-id="worker-0"]').click();await expect(page.locator('#editWorkerName')).toBeFocused();await page.locator('#editWorkerPosition').fill('Coordinación comercial');await page.locator('#confirmWorkerEdit').click();await expect(page.locator('#workersModal')).toBeHidden();expect((await writes(page))[0].body).toEqual({id:'worker-0',full_name:'Ana Pérez',phone:'+530000000000',position:'Coordinación comercial'});
});
test('Worker deactivation and reactivation retain explicit confirmation and history',async({page},info)=>{
 await open(page,'workers');const trigger=page.locator('[data-worker-action="deactivate"][data-worker-id="worker-0"]');await trigger.click();await expect(page.locator('#workerDeactivationReason')).toBeFocused();await page.locator('[data-worker-modal-close]').last().click();await expect(trigger).toBeFocused();expect(await writes(page)).toEqual([]);
 await trigger.click();await page.locator('#workerDeactivationReason').fill('Ausencia temporal acordada');await shot(page,info,'desactivar-trabajador');await page.locator('#confirmWorkerDeactivate').click();await expect(page.locator('#workersModal')).toBeHidden();await page.locator('[data-worker-filter="inactive"]').click();await expect(page.locator('.workers-card').filter({hasText:'Ana Pérez'})).toContainText('Ausencia temporal acordada');
 await page.locator('[data-worker-action="reactivate"][data-worker-id="worker-0"]').click();await page.locator('#workerReactivationReason').fill('Reincorporación confirmada');await page.locator('#confirmWorkerReactivate').click();await expect(page.locator('#workersModal')).toBeHidden();await page.locator('[data-worker-filter="active"]').click();await page.locator('[data-worker-action="history"][data-worker-id="worker-0"]').click();await expect(page.locator('#workerHistoryContent')).toContainText('Ausencia temporal acordada');await expect(page.locator('#workerHistoryContent')).toContainText('Reincorporación confirmada');
 expect((await writes(page)).map(c=>c.body)).toEqual([{id:'worker-0',is_active:false,deactivation_reason:'Ausencia temporal acordada'},{id:'worker-0',is_active:true,reactivation_reason:'Reincorporación confirmada'}]);
});
test('Worker read-only access exposes history without mutation controls',async({page})=>{
 await open(page,'workers',{writable:false});await expect(page.locator('#workersCreateButton')).toBeHidden();await expect(page.locator('#workersReadOnlyNote')).toBeVisible();await expect(page.locator('[data-worker-action="edit"],[data-worker-action="deactivate"],[data-worker-action="reactivate"]')).toHaveCount(0);await page.locator('[data-worker-action="history"]').first().click();await expect(page.locator('#workerHistoryContent')).toContainText('Reincorporación');expect(await writes(page)).toEqual([]);
});
for(const module of ['tasks','workers'])test(`${module}: failed reads expose a safe recovery route`,async({page})=>{
 await open(page,module,{failRead:true});await expect(page.locator('.'+module+'-empty')).toBeVisible();await expect(page.locator('body')).not.toContainText('Internal fixture');await page.evaluate(()=>window.__fixtureReadError=false);await page.locator('.'+module+'-empty button').click();await expect(page.locator('.'+module+'-card')).toHaveCount(2);expect(await writes(page)).toEqual([]);
});
