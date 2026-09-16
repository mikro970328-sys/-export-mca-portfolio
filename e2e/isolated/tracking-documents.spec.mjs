import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createOperatorAcceptanceDb } from '../../scripts/lib/operator-acceptance-db.mjs';
import { operatorFixture } from '../../scripts/lib/operator-acceptance-fixture.mjs';
import { startBrowserAcceptanceServer, root } from './server.mjs';
import { documentStorage } from './document-storage.mjs';

test('tracking documents: versions, readiness, reader and lost confirmations',async({browser},info)=>{
  test.setTimeout(240_000);process.chdir(root);
  const db=await createOperatorAcceptanceDb(),contexts=[],nativeFetch=globalThis.fetch;
  const evidence={checkpoints:[],errors:[],serverErrors:[],external:[],storage:'explicit in-memory substitute; real handlers/auth/PostgreSQL'};
  let api;
  try{
    await db.exec(`alter table clients add column phone text,add column email text,add column welcome_status text default 'pending',add column created_at timestamptz default now();
      alter table importers add column address text,add column country text default 'Cuba',add column email text,add column phone text,add column normalized_name text,add column created_at timestamptz default now(),add column updated_at timestamptz default now();
      alter table client_importers add column created_at timestamptz default now();
      grant select on documents,load_expediente_documents,load_traceability_sources,load_traceability_summary to service_role;`);
    await db.exec(fs.readFileSync('supabase/migrations/20260831235500_ux5_shipment_action_capabilities.sql','utf8'));
    const {f,users}=await operatorFixture(db);
    await db.exec('update importers set normalized_name=upper(btrim(name))');
    const shipment=await f.one("insert into shipments(container_number,client_id,importer_id,departure_date) values('QA-DOC-001',$1,$2,current_date) returning *",[f.client,f.importer]);
    const storage=documentStorage(),cuts={finalize:false,remove:false,finalizeCount:0,removeCount:0};
    api=await startBrowserAcceptanceServer({storageHandler:storage.handle,dropApiResponse:(req,url,body)=>{
      if(url.pathname!=='/api/shipment-documents')return false;
      let payload;try{payload=JSON.parse(String(body));}catch{return false;}
      if(cuts.finalize&&req.method==='POST'&&payload.document){cuts.finalize=false;cuts.finalizeCount++;return true;}
      if(cuts.remove&&req.method==='DELETE'&&payload.deleted){cuts.remove=false;cuts.removeCount++;return true;}
      return false;
    }});
    const allowed=new Set([api.base,new URL(process.env.ERP_TEST_POSTGREST_URL).origin]);
    globalThis.fetch=(input,options)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!allowed.has(url.origin))throw Error('QA refuses external backend traffic');return nativeFetch(input,options);};
    await api.ready(db);
    const master=await api.request('login',{method:'POST',body:{username:users.master.username,password:users.master.password}});expect(master.status).toBe(200);
    for(const key of ['a','b']){
      const permissions=['logistics.read','documents.read','clients.read',...(key==='a'?['documents.write']:[])];
      const role=await api.request('access-control?resource=roles',{method:'PATCH',token:master.body.token,body:{id:users[key].access_role_id,permission_keys:permissions}});expect(role.status,JSON.stringify(role.body)).toBe(200);
    }
    const pages={};
    for(const key of ['a','b']){
      const use=info.project.use;
      const context=await browser.newContext({viewport:use.viewport,userAgent:use.userAgent,isMobile:use.isMobile,hasTouch:use.hasTouch,deviceScaleFactor:use.deviceScaleFactor,locale:'es-US',serviceWorkers:'allow'});contexts.push(context);
      await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===api.base||['data:','blob:','about:'].includes(url.protocol))return route.continue();evidence.external.push(url.origin+url.pathname);return route.abort();});
      const page=await context.newPage();pages[key]=page;page.on('pageerror',e=>evidence.errors.push(e.message));page.setDefaultTimeout(20_000);
      page.on('response',response=>{const url=new URL(response.url());if(url.pathname.startsWith('/api/')&&response.status()>=500)evidence.serverErrors.push({path:url.pathname,status:response.status()});});
      await page.goto(`${api.base}/admin/pwa.html`);await page.locator('#username').fill(users[key].username);await page.locator('#password').fill(users[key].password);
      await page.locator('#login').click();await expect(page.locator('#loginPage')).toBeHidden();
      await page.waitForFunction(()=>window.NavigationShell?.owner==='navigation-shell.js');
      const button=page.locator('[data-section="containersSection"]').first();
      if(use.isMobile&&!await page.locator('#sidebar').evaluate(el=>el.classList.contains('mobile-open')))await page.locator('#mobileMenuBtn').click();
      if(!await button.isVisible())await button.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," nav-group ")]').locator('.nav-group-btn').click();
      await button.click();await expect(page.locator('#containersSection')).toBeVisible();
      await page.locator(`[data-shipment-row="${shipment.id}"]:visible`).first().click();await expect(page.locator('.container-customs')).toBeVisible();
    }
    const writer=pages.a,reader=pages.b;
    const step=async(name,fn)=>test.step(name,async()=>{await fn();evidence.checkpoints.push(name);});
    const refreshReader=async()=>{await reader.locator('#closeModal').click();await reader.locator(`[data-shipment-row="${shipment.id}"]:visible`).first().click();await expect(reader.locator('.container-customs')).toBeVisible();};
    const pdf=version=>Buffer.from(`%PDF-1.4\nQA document ${version}\n%%EOF\n`);
    const upload=async(key,version)=>{
      const chooser=writer.waitForEvent('filechooser');await writer.locator(`[data-customs-upload="${key}"]`).click();
      await (await chooser).setFiles({name:`qa-${version}.pdf`,mimeType:'application/pdf',buffer:pdf(version)});
      // WebKit may deliver the input change after setFiles resolves. The previous
      // success message is not evidence that this new upload has completed.
      await expect(writer.locator('.container-customs')).toContainText(`qa-${version}.pdf`);
      await expect(writer.locator('#containerCustomsFeedback')).toContainText(/actualizado correctamente|quedó guardado correctamente/);
    };
    const rows=()=>f.rows('select * from documents where shipment_id=$1 order by document_type,version',[shipment.id]);
    await step('DOC-01 reader has no document mutation controls',async()=>{
      await expect(reader.locator('[data-customs-upload]')).toHaveCount(0);await expect(reader.locator('[data-customs-delete]')).toHaveCount(0);
    });
    await step('DOC-02 first upload visible to reader with partial readiness',async()=>{
      await upload('packing_list_cuba','packing-v1');await refreshReader();await expect(reader.locator('.container-customs')).toContainText('qa-packing-v1.pdf');
      const docs=await rows();expect(docs).toHaveLength(1);expect(storage.objects.get(docs[0].storage_path)).toEqual(pdf('packing-v1'));
      const ready=await f.one('select * from shipment_customs_document_readiness where shipment_id=$1',[shipment.id]);expect(ready.missing_documents).toContain('Commercial Invoice Cuba');
    });
    await step('DOC-03 second type completes readiness; signed download has exact bytes',async()=>{
      await upload('commercial_invoice_cuba','invoice-v1');await refreshReader();
      const ready=await f.one('select * from shipment_customs_document_readiness where shipment_id=$1',[shipment.id]);expect(ready.missing_documents).toEqual([]);
      const doc=(await rows()).find(x=>x.document_type==='Commercial Invoice Cuba');
      const payload=await api.request(`shipment-documents?shipment_id=${shipment.id}`,{token:master.body.token});expect(payload.status).toBe(200);
      const signed=payload.body.documents.find(x=>x.id===doc.id).signed_url;
      const response=await reader.request.get(signed);expect(response.status()).toBe(200);expect(await response.body()).toEqual(pdf('invoice-v1'));
    });
    await step('DOC-04 lost finalization response recovers committed version without duplicate',async()=>{
      cuts.finalize=true;
      await upload('packing_list_cuba','packing-v2');expect(cuts.finalizeCount).toBe(1);
      const packing=(await rows()).filter(x=>x.document_type==='Packing List Cuba');expect(packing).toHaveLength(2);expect(packing[0].superseded_at).toBeTruthy();expect(packing[1].superseded_at).toBeNull();
      await refreshReader();await expect(reader.locator('.container-customs')).toContainText('qa-packing-v2.pdf');await expect(reader.locator('.container-customs-versions')).toContainText('qa-packing-v1.pdf');
    });
    await step('DOC-05 lost delete response recovers retirement and readiness without repeating',async()=>{
      const current=(await rows()).find(x=>x.document_type==='Packing List Cuba'&&!x.superseded_at);
      cuts.remove=true;
      await writer.locator(`[data-customs-delete="${current.id}"]`).click();await writer.locator('[data-decision-yes]').click();
      await expect(writer.locator('#containerCustomsFeedback')).toContainText('Documento retirado del ERP');expect(cuts.removeCount).toBe(1);
      expect((await rows()).find(x=>x.id===current.id).deleted_at).toBeTruthy();expect(storage.objects.has(current.storage_path)).toBe(false);
      const ready=await f.one('select * from shipment_customs_document_readiness where shipment_id=$1',[shipment.id]);expect(ready.missing_documents).toContain('Packing List Cuba');
      await refreshReader();await expect(reader.locator('.container-customs')).toContainText('qa-packing-v2.pdf');
      expect((await rows()).filter(x=>x.document_type==='Packing List Cuba')).toHaveLength(2);
    });
    await step('DOC-06 parallel registrations of one object return one document',async()=>{
      const concurrent=await f.one("insert into shipments(container_number) values('QA-DOC-CONCURRENT') returning id");
      const sql="select * from create_shipment_customs_document($1,null,'Packing List Cuba','parallel.pdf','erp-documents','qa/parallel.pdf','application/pdf',10,null,null,null)";
      const results=await Promise.all([db.query(sql,[concurrent.id]),db.query(sql,[concurrent.id])]);
      expect(results[0].rows).toEqual(results[1].rows);
      expect(Number((await f.one('select count(*) from documents where shipment_id=$1',[concurrent.id])).count)).toBe(1);
    });
    expect(evidence.serverErrors).toEqual([]);expect(evidence.errors).toEqual([]);expect(evidence.external).toEqual([]);
    await writer.screenshot({path:info.outputPath('tracking-documents.png'),fullPage:true});
  }finally{
    fs.mkdirSync(info.outputDir,{recursive:true});fs.writeFileSync(info.outputPath('tracking-documents-evidence.json'),JSON.stringify(evidence,null,2));
    for(const context of contexts)await context.close().catch(()=>{});
    globalThis.fetch=nativeFetch;if(api)await api.close();await db.end();
  }
});
