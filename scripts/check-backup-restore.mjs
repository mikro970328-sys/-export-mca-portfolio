import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { createOperatorAcceptanceDb } from './lib/operator-acceptance-db.mjs';
import { operatorFixture } from './lib/operator-acceptance-fixture.mjs';
import { verifyPassword } from '../api/_lib.js';

// Synthetic drill only. Refuse anything except the named disposable CI services.
// No production credentials, cloud requests, uploads, notifications or artifacts.
function localUrl(value, name, port) {
  const u = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(u.protocol));
  assert.equal(u.hostname, '127.0.0.1');
  assert.equal(u.pathname, '/' + name);
  assert.equal(u.port, port);
  assert.equal(u.search, '');
  assert.equal(u.hash, '');
  return value;
}
const sourceUrl = localUrl(process.env.ERP_TEST_DATABASE_URL, 'erp_operator_qa', '5432');
const targetUrl = localUrl(process.env.ERP_RESTORE_DATABASE_URL, 'erp_operator_qa_restore', '5433');
assert.equal(process.env.ERP_BACKUP_DRILL, 'synthetic-only');
const sourceContainer = process.env.ERP_QA_SOURCE_CONTAINER;
const targetContainer = process.env.ERP_QA_TARGET_CONTAINER;
for (const id of [sourceContainer, targetContainer]) assert.match(id || '', /^[a-f0-9]{12,64}$/);
assert.notEqual(sourceContainer, targetContainer);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const ident = name => '"' + name.replaceAll('"', '""') + '"';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-backup-drill-'));
const archive = path.join(root, 'archive');
const restoredFiles = path.join(root, 'restored-files');
fs.mkdirSync(archive, {mode:0o700});
fs.mkdirSync(restoredFiles, {mode:0o700});
const docker = (container, args, input) => execFileSync('docker', ['exec', '-i', container, ...args],
  {input, maxBuffer:64*1024*1024, timeout:120000, stdio:['pipe','pipe','pipe']});
let source, sourceClosed = false;
const target = new pg.Pool({connectionString:targetUrl, options:'-c timezone=UTC -c statement_timeout=15000'});
let checks = 0;
const pass = label => {checks++; console.log('PASS ' + label);};
async function emptyTarget() {
  const {rows:[r]} = await target.query("select current_database() as name, (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public') as objects");
  assert.equal(r.name, 'erp_operator_qa_restore'); assert.equal(r.objects, 0);
}
async function state(db) {
  const rows = async sql => (await db.query(sql)).rows;
  const tables = await rows("select tablename from pg_tables where schemaname='public' order by tablename");
  const data = [];
  for (const {tablename} of tables) {
    const tableRows = await rows('select to_jsonb(t) as row from public.' + ident(tablename) + ' t order by to_jsonb(t)::text');
    data.push({table:tablename, count:tableRows.length, sha256:sha(JSON.stringify(tableRows))});
  }
  const sequences = [];
  for (const {sequencename} of await rows("select sequencename from pg_sequences where schemaname='public' order by sequencename")) {
    sequences.push({name:sequencename, ...(await rows('select last_value::text, is_called from public.' + ident(sequencename)))[0]});
  }
  return {
    data, sequences,
    // Logical dumps compact physical slots left by dropped columns; preserve visible order instead.
    columns:await rows("select table_name,column_name,(row_number() over(partition by table_name order by ordinal_position))::int as column_position,column_default,is_nullable,data_type,udt_name,numeric_precision,numeric_scale from information_schema.columns where table_schema='public' order by table_name,ordinal_position"),
    relations:await rows("select c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) as owner,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname"),
    functions:await rows("select p.proname,pg_get_function_identity_arguments(p.oid) as args,pg_get_functiondef(p.oid) as definition,pg_get_userbyid(p.proowner) as owner,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') order by p.proname,pg_get_function_identity_arguments(p.oid)"),
    constraints:await rows("select c.relname,k.conname,k.convalidated,pg_get_constraintdef(k.oid) as definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,k.conname"),
    triggers:await rows("select c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by c.relname,t.tgname"),
    indexes:await rows("select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by tablename,indexname"),
    policies:await rows("select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname"),
    views:await rows("select viewname,definition from pg_views where schemaname='public' order by viewname"),
    roles:await rows("select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls from pg_roles where rolname in ('postgres','anon','authenticated','service_role') order by rolname")
  };
}
function verifyBundle(manifest) {
  for (const file of manifest.files) {
    assert.match(file.name, /^(database\.dump|roles\.sql|object-[0-9]+\.bin)$/);
    const full = path.join(archive, file.name);
    assert.ok(fs.existsSync(full), 'Missing backup member');
    const bytes = fs.readFileSync(full);
    assert.equal(bytes.length, file.bytes, 'Backup size mismatch');
    assert.equal(sha(bytes), file.sha256, 'Backup checksum mismatch');
  }
}
function verifyDocuments(docs, directory, manifest) {
  for (const doc of docs) {
    const record = manifest.files.find(x => x.bucket === doc.storage_bucket && x.key === doc.storage_path);
    assert.ok(record, 'Document absent from object inventory');
    const bytes = fs.readFileSync(path.join(directory, record.name));
    assert.equal(bytes.length, Number(doc.file_size_bytes));
    assert.equal(sha(bytes), record.sha256, 'Restored object checksum mismatch');
    if (doc.generated) assert.equal(sha(bytes), doc.content_sha256, 'Document metadata checksum mismatch');
    else assert.equal(doc.content_sha256, null, 'Manual document metadata must retain its canonical shape');
  }
}
try {
  await emptyTarget();
  source = await createOperatorAcceptanceDb();
  const {f,users} = await operatorFixture(source);
  const so = await f.sale(), po = await f.purchase();
  const {load} = await f.fulfill(so, po);
  const inv = await f.invoice(so);
  await f.payment(inv, 400);
  const bill = await f.bill(po);
  await f.payBill(bill, 250);
  await f.cost(so, {amount:50});
  const financialBefore = await f.financial(inv);
  const apBefore = await f.ap(bill);
  const {rows:[ship]} = await source.query('select s.id as shipment_id,s.operation_id,s.bol_number from loads l join shipments s on s.id=l.shipment_id where l.id=$1', [load.id]);
  const files = [];
  for (const [i,type] of ['Packing List Cuba','Commercial Invoice Cuba'].entries()) {
    const bytes = Buffer.from('%PDF-1.4\nSynthetic recovery document ' + i + '\n%%EOF\n');
    const member = 'object-' + i + '.bin';
    const key = 'recovery-qa/' + crypto.randomUUID() + '/documento ' + i + '.pdf';
    fs.writeFileSync(path.join(archive, member), bytes, {mode:0o600});
    files.push({name:member, bucket:'erp-documents', key, bytes:bytes.length, sha256:sha(bytes)});
    const document = {client_id:f.client,shipment_id:ship.shipment_id,document_type:type,
      file_name:'synthetic-' + i + '.pdf',storage_bucket:'erp-documents',storage_path:key,
      mime_type:'application/pdf',file_size_bytes:bytes.length,uploaded_by_admin_id:users.master.id};
    if (i === 0) Object.assign(document, {document_type:'Packing List',generated:true,
      source_type:'load',source_id:load.id,load_id:load.id,operation_id:ship.operation_id,
      bol_number:ship.bol_number,content_sha256:sha(bytes),generated_at:new Date().toISOString()});
    await source.query('insert into documents(' + Object.keys(document).map(ident).join(',') +
      ') values(' + Object.keys(document).map((_,j)=>'$' + (j+1)).join(',') + ')',Object.values(document));
  }
  const receiptRequest = crypto.randomUUID();
  const receiptPayload = {warehouse_id:f.warehouse,supplier_id:f.supplier,reference_number:'QA-RESTORE-REPLAY',
    received_at:'2026-09-17T00:00:00Z',items:[{product_id:f.product,quantity:12,unit_cost:2.5,currency:'USD',entry_mode:'units'}]};
  const {rows:[receipt]} = await source.query('select * from create_warehouse_receipt_canonical($1::jsonb,$2,$3)',
    [JSON.stringify(receiptPayload),users.master.id,receiptRequest]);
  pass('synthetic commercial records and two separate document objects prepared');

  const before = await state(source);
  const backupStarted = Date.now();
  const dump = docker(sourceContainer, ['pg_dump','-U','postgres','-d','erp_operator_qa','--format=custom']);
  const roles = docker(sourceContainer, ['pg_dumpall','-U','postgres','--roles-only','--no-role-passwords']);
  for (const [name,bytes] of [['database.dump',dump],['roles.sql',roles]]) {
    fs.writeFileSync(path.join(archive,name),bytes,{mode:0o600});
    files.push({name,bytes:bytes.length,sha256:sha(bytes)});
  }
  const manifest = {scope:'synthetic-drill-only',created_at:new Date().toISOString(),files};
  fs.writeFileSync(path.join(archive,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
  verifyBundle(manifest);
  const backupMs = Date.now() - backupStarted;
  pass('native PostgreSQL backup and independent file checksums verified');

  const wrongDump = Buffer.from(dump); wrongDump[100] ^= 1;
  fs.writeFileSync(path.join(archive,'database.dump'),wrongDump);
  assert.throws(() => verifyBundle(manifest), /checksum/);
  await emptyTarget();
  fs.writeFileSync(path.join(archive,'database.dump'),dump);
  pass('corrupted database backup rejected before any restore');
  const firstObject = fs.readFileSync(path.join(archive,'object-0.bin'));
  fs.unlinkSync(path.join(archive,'object-0.bin'));
  assert.throws(() => verifyBundle(manifest), /Missing backup member/);
  await emptyTarget();
  fs.writeFileSync(path.join(archive,'object-0.bin'),firstObject,{mode:0o600});
  pass('missing document backup rejected before any restore');

  // Prove recovery uses the retained snapshot even if the source changes/disappears.
  await source.query("update clients set name='QA change after backup' where id=$1",[f.client]);
  await source.end(); sourceClosed = true;
  execFileSync('docker',['stop',sourceContainer],{timeout:30000,stdio:'pipe'});
  pass('source database unavailable during recovery; archive remains readable');

  const restoreStarted = Date.now();
  verifyBundle(manifest);
  await emptyTarget();
  docker(targetContainer,['psql','-U','qa_restore_admin','-d','erp_operator_qa_restore','-v','ON_ERROR_STOP=1'],fs.readFileSync(path.join(archive,'roles.sql')));
  docker(targetContainer,['pg_restore','-U','qa_restore_admin','--role=postgres','-d','erp_operator_qa_restore','--exit-on-error','--single-transaction'],fs.readFileSync(path.join(archive,'database.dump')));
  for (const file of files.filter(x => x.bucket)) fs.copyFileSync(path.join(archive,file.name),path.join(restoredFiles,file.name));
  const after = await state(target);
  for (const key of Object.keys(before)) {assert.deepEqual(after[key],before[key],key + ' changed during restore');pass('restored ' + key + ' matches retained snapshot');}
  const restoredDocs = (await target.query('select * from documents order by id')).rows;
  verifyDocuments(restoredDocs,restoredFiles,manifest);
  pass('both recovered documents match their database metadata and original bytes');
  fs.writeFileSync(path.join(restoredFiles,'object-0.bin'),Buffer.alloc(firstObject.length,88));
  assert.throws(() => verifyDocuments(restoredDocs,restoredFiles,manifest), /checksum/);
  fs.copyFileSync(path.join(archive,'object-0.bin'),path.join(restoredFiles,'object-0.bin'));
  verifyDocuments(restoredDocs,restoredFiles,manifest);
  pass('same-size file corruption detected; correct copy restores integrity');

  assert.deepEqual((await target.query('select * from invoice_financial_progress where invoice_id=$1',[inv.id])).rows[0],financialBefore);
  assert.deepEqual((await target.query('select * from supplier_bill_financial_progress where supplier_bill_id=$1',[bill.id])).rows[0],apBefore);
  pass('customer and supplier balances preserved');
  for (const user of Object.values(users)) {
    const {rows:[saved]} = await target.query('select password_salt,password_hash from admin_users where id=$1',[user.id]);
    assert.ok(verifyPassword(user.password,saved.password_salt,saved.password_hash));
  }
  pass('all three operator password verifiers preserved');
  const {rows:[grants]} = await target.query("select has_function_privilege('anon','public.create_warehouse_receipt_canonical(jsonb,uuid,uuid)','execute') as anon,has_function_privilege('authenticated','public.create_warehouse_receipt_canonical(jsonb,uuid,uuid)','execute') as authenticated,has_function_privilege('service_role','public.create_warehouse_receipt_canonical(jsonb,uuid,uuid)','execute') as service");
  assert.deepEqual(grants,{anon:false,authenticated:false,service:true});
  pass('backend-only execution privileges preserved');
  const originalIdentity = (await target.query('select id from warehouse_receipts where registration_request_id=$1',[receiptRequest])).rows[0].id;
  const beforeReplay = await state(target);
  await target.query('select * from create_warehouse_receipt_canonical($1::jsonb,$2,$3)',[JSON.stringify(receiptPayload),users.master.id,receiptRequest]);
  assert.deepEqual((await state(target)).data,beforeReplay.data);
  pass('retry identity survives restore without duplicate receipt, inventory or audit');
  await assert.rejects(() => target.query('update warehouse_receipts set registration_request_id=null,registration_request_payload=null where id=$1',[originalIdentity]),/WR_REQUEST_IDENTITY_IMMUTABLE/);
  pass('identity protection trigger still rejects changes after restore');
  const rowsBefore = Number((await target.query('select count(*) from warehouse_receipts')).rows[0].count);
  await target.query('select * from create_warehouse_receipt_canonical($1::jsonb,$2,$3)',[JSON.stringify({...receiptPayload,reference_number:'QA-NEW-AFTER-RESTORE'}),users.master.id,crypto.randomUUID()]);
  assert.equal(Number((await target.query('select count(*) from warehouse_receipts')).rows[0].count),rowsBefore+1);
  pass('new valid business write works after restore');

  console.log(JSON.stringify({scope:'SYNTHETIC ONLY; not a production backup restoration',checks,tables:before.data.length,
    rows:before.data.reduce((n,t)=>n+t.count,0),documents:restoredDocs.length,backupMs,restoreAndVerificationMs:Date.now()-restoreStarted,
    nativeDumpBytes:dump.length,archiveSha256:sha(dump),productionRestoration:'NOT_PERFORMED'}));
} finally {
  if (source && !sourceClosed) await source.end();
  await target.end();
  fs.rmSync(root,{recursive:true,force:true});
}
