import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {createOperatorAcceptanceDb} from '../../scripts/lib/operator-acceptance-db.mjs';
import {applyTrackingWorkflowAcceptanceSchema} from '../../scripts/lib/tracking-workflow-acceptance-db.mjs';
import {operatorFixture} from '../../scripts/lib/operator-acceptance-fixture.mjs';
import {startBrowserAcceptanceServer,root} from './server.mjs';
import {documentStorage} from './document-storage.mjs';

test('tracking workflow: two real sessions, document tasks, personal inbox and live updates',async({browser},info)=>{
  test.setTimeout(300_000);process.chdir(root);
  const db=await createOperatorAcceptanceDb(),contexts=[],pages={},nativeFetch=globalThis.fetch;
  const evidence={checkpoints:[],errors:[],serverErrors:[],external:[],navigations:{a:0,b:0}};
  let api;
  try {
    await applyTrackingWorkflowAcceptanceSchema(db);
    await db.exec(`alter table clients add column phone text,add column email text,add column welcome_status text default 'pending',add column created_at timestamptz default now();
      alter table importers add column address text,add column country text default 'Cuba',add column email text,add column phone text,add column normalized_name text,add column created_at timestamptz default now(),add column updated_at timestamptz default now();
      alter table client_importers add column created_at timestamptz default now();
      alter table shipments add column release_method text,add column released_by_admin_id uuid,add column released_by_username text,add column release_notification_status text default 'pending',add column release_notification_error text;
      grant select on documents,load_expediente_documents,load_traceability_sources,load_traceability_summary,notifications,webhook_events to service_role;`);
    await db.exec(fs.readFileSync('supabase/migrations/20260831235500_ux5_shipment_action_capabilities.sql','utf8'));
    const {f,users}=await operatorFixture(db);
    await db.exec('update importers set normalized_name=upper(btrim(name))');
    await db.query("update workflow_task_routes set assigned_admin_id=$1 where workflow_key='shipment_cuba_documents'",[users.b.id]);
    const shipment=await f.one("insert into shipments(container_number,client_id,importer_id,departure_date) values('QA-WORK-001',$1,$2,current_date) returning *",[f.client,f.importer]);
    const task=await f.one("select * from operational_tasks where entity_id=$1 and workflow_key='shipment_cuba_documents'",[shipment.id]);
    const storage=documentStorage();api=await startBrowserAcceptanceServer({storageHandler:storage.handle});
    const allowed=new Set([api.base,new URL(process.env.ERP_TEST_POSTGREST_URL).origin]);
    globalThis.fetch=(input,options)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!allowed.has(url.origin)){evidence.external.push(url.origin+url.pathname);throw Error('QA refuses external backend traffic');}return nativeFetch(input,options);};
    await api.ready(db);
    const master=await api.request('login',{method:'POST',body:{username:users.master.username,password:users.master.password}});expect(master.status).toBe(200);
    for(const key of ['a','b']){
      const permissions=['logistics.read','documents.read','documents.write','clients.read','tasks.read','tasks.write','notifications.read',...(key==='a'?['tasks.manage','logistics.write']:[])];
      const role=await api.request('access-control?resource=roles',{method:'PATCH',token:master.body.token,body:{id:users[key].access_role_id,permission_keys:permissions}});expect(role.status,JSON.stringify(role.body)).toBe(200);
      const use=info.project.use;
      const context=await browser.newContext({viewport:use.viewport,userAgent:use.userAgent,isMobile:use.isMobile,hasTouch:use.hasTouch,deviceScaleFactor:use.deviceScaleFactor,locale:'es-US',serviceWorkers:'allow'});contexts.push(context);
      await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===api.base||['data:','blob:','about:'].includes(url.protocol))return route.continue();evidence.external.push(url.origin+url.pathname);return route.abort();});
      const page=await context.newPage();pages[key]=page;page.setDefaultTimeout(25_000);
      page.on('pageerror',e=>evidence.errors.push({operator:key,message:e.message}));
      page.on('framenavigated',frame=>{if(frame===page.mainFrame())evidence.navigations[key]++;});
      page.on('response',response=>{const url=new URL(response.url());if(url.pathname.startsWith('/api/')&&response.status()>=500)evidence.serverErrors.push({operator:key,path:url.pathname,status:response.status()});});
      await page.goto(`${api.base}/admin/pwa.html`);await page.locator('#username').fill(users[key].username);await page.locator('#password').fill(users[key].password);await page.locator('#login').click();await expect(page.locator('#loginPage')).toBeHidden();
      await page.waitForFunction(()=>window.NavigationShell?.owner==='navigation-shell.js'&&window.TasksWorkspace&&window.NotificationInbox);
    }
    const a=pages.a,b=pages.b,navigations={...evidence.navigations};
    const navigate=async(page,section)=>{
      const button=page.locator(`[data-section="${section}"]`).first();
      if(info.project.use.isMobile&&!await page.locator('#sidebar').evaluate(el=>el.classList.contains('mobile-open')))await page.locator('#mobileMenuBtn').click();
      if(!await button.isVisible())await button.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," nav-group ")]').locator('.nav-group-btn').click();
      await button.click();await expect(page.locator(`#${section}`)).toBeVisible();
    };
    const card=page=>page.locator('.tasks-card').filter({has:page.locator(`[data-task-action="open"][data-id="${task.id}"]`)});
    const step=async(name,fn)=>test.step(name,async()=>{await fn();evidence.checkpoints.push(name);});
    const openInbox=async page=>{await page.locator('#notificationInboxBell').click();await expect(page.locator('#notificationInboxOverlay')).toBeVisible();};
    const upload=async(key,name)=>{
      const chooser=a.waitForEvent('filechooser');await a.locator(`[data-customs-upload="${key}"]`).click();await(await chooser).setFiles({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nQA workflow\n%%EOF\n')});
      await expect(a.locator('.container-customs')).toContainText(name);await expect(a.locator('#containerCustomsFeedback')).toContainText('actualizado correctamente');
    };
    await navigate(a,'containersSection');await a.locator(`[data-shipment-row="${shipment.id}"]:visible`).first().click();await expect(a.locator('.container-customs')).toBeVisible();
    await navigate(b,'tasksSection');await b.locator('[data-task-action="clear"]').first().click();
    await step('TW-01 assigned operator sees pending task and personal notice',async()=>{
      await expect(card(b).locator('.tasks-status')).toHaveText('Pendiente');
      await card(b).locator('[data-task-action="open"]').click();await expect(b.locator('#tasksModal')).toBeVisible();
      await expect(b.locator('[data-task-action="edit-detail"]')).toHaveCount(0);await b.locator('[data-task-modal-close]').click();
      await openInbox(b);
      const notice=await f.one("select id from notification_inbox_items where source_id=$1 and recipient_admin_id=$2 and source_event_type='task_assignment'",[task.id,users.b.id]);
      expect(notice).toBeTruthy();
      await b.locator(`[data-notification-action="mark_read"][data-notification-id="${notice.id}"]`).click();
      await expect(b.locator(`[data-notification-action="mark_unread"][data-notification-id="${notice.id}"]`)).toBeVisible();
      await b.locator('#notificationClose').click();
    });
    await step('TW-02 uploads complete the other operators task without reload',async()=>{
      await upload('packing_list_cuba','qa-work-packing.pdf');await expect(card(b).locator('.tasks-status')).toHaveText('Pendiente');
      await upload('commercial_invoice_cuba','qa-work-invoice.pdf');
      await expect(card(b).locator('.tasks-status')).toHaveText('Completada',{timeout:45_000});
      expect((await f.one('select status from operational_tasks where id=$1',[task.id])).status).toBe('completed');
    });
    await step('TW-03 retiring a document reopens the same task live',async()=>{
      const doc=await f.one("select id from documents where shipment_id=$1 and document_type='Packing List Cuba' and superseded_at is null",[shipment.id]);
      await a.locator(`[data-customs-delete="${doc.id}"]`).click();await a.locator('[data-decision-yes]').click();await expect(a.locator('#containerCustomsFeedback')).toContainText('Documento retirado del ERP');
      await expect(card(b).locator('.tasks-status')).toHaveText('Pendiente',{timeout:45_000});
      expect((await f.rows("select id from operational_tasks where entity_id=$1 and workflow_key='shipment_cuba_documents'",[shipment.id])).map(x=>x.id)).toEqual([task.id]);
      expect((await f.one("select count(*)::int as count from notification_inbox_items where source_id=$1 and recipient_admin_id=$2 and source_event_type='task_assignment'",[task.id,users.b.id])).count).toBe(1);
    });
    await step('TW-04 UI reassignment removes task from former operator and notifies new owner',async()=>{
      await a.locator('#closeModal').click();await navigate(a,'tasksSection');await a.locator('[data-task-action="clear"]').first().click();
      await card(a).locator('[data-task-action="open"]').click();await a.locator('[data-task-action="edit-detail"]').click();await a.locator('#tasksFormAssignee').selectOption(users.a.id);
      await a.locator('#tasksModalActions').getByRole('button',{name:'Guardar cambios',exact:true}).click();
      await expect(a.locator('#tasksModalBody')).toContainText('QA operator a');await a.locator('[data-task-modal-close]').click();
      await expect(card(b)).toHaveCount(0,{timeout:45_000});await openInbox(a);
      await expect.poll(async()=>f.one("select id from notification_inbox_items where source_id=$1 and recipient_admin_id=$2 and source_event_type='task_assignment'",[task.id,users.a.id])).toBeTruthy();
      const notice=await f.one("select id from notification_inbox_items where source_id=$1 and recipient_admin_id=$2 and source_event_type='task_assignment'",[task.id,users.a.id]);
      await expect(a.locator(`[data-notification-open="${notice.id}"]`)).toBeVisible();await a.locator('#notificationClose').click();
    });
    await step('TW-05 tracking status changed through UI produces the other users notice',async()=>{
      await navigate(a,'containersSection');await a.locator(`[data-container-menu="${shipment.id}"]:visible`).click();await a.locator('[data-container-action="manual_update"]').click();
      await a.locator('[name="manualTrackingEvent"][value="arrived"]').check();await a.locator('#manualTrackingLocation').fill('Mariel QA');await a.locator('.manual-track-confirm').click();await expect(a.locator('[data-manual-track]')).toHaveCount(0);
      await expect(a.locator(`[data-shipment-row="${shipment.id}"]:visible`).first()).toContainText('Llegó al puerto');
      await openInbox(b);await expect(b.locator('.notification-item').filter({hasText:'Tracking actualizado'}).filter({hasText:'Llegó al puerto'})).toBeVisible();await b.locator('#notificationClose').click();
      expect((await f.one("select count(*)::int as count from shipment_history where shipment_id=$1 and event_type='manual_arrv'",[shipment.id])).count).toBe(1);
    });
    expect(evidence.navigations).toEqual(navigations);expect(evidence.errors).toEqual([]);expect(evidence.serverErrors).toEqual([]);expect(evidence.external).toEqual([]);
  } finally {
    fs.mkdirSync(info.outputDir,{recursive:true});
    for(const[key,page]of Object.entries(pages))await page.screenshot({path:info.outputPath(`tracking-workflow-${key}.png`),fullPage:true,timeout:5000}).catch(()=>{});
    fs.writeFileSync(info.outputPath('tracking-workflow-evidence.json'),JSON.stringify(evidence,null,2));
    for(const context of contexts)await context.close().catch(()=>{});
    globalThis.fetch=nativeFetch;if(api)await api.close();await db.end();
  }
});
