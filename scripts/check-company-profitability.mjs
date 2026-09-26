import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {costsFixture} from './lib/figma-costs-fixture.mjs';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const period=`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;

async function checkSchema(){
  const db=new PGlite();
  try{
    await db.exec(`create table public.clients(id uuid primary key default gen_random_uuid(),company text,mipyme_name text);
      insert into public.clients(company,mipyme_name) values(null,'Comercial Uno');`);
    await db.exec(await readFile('supabase/migrations/20260926182551_client_nit_duplicate_protection.sql','utf8'));
    const client=await db.query('select company,nit_normalized from public.clients limit 1');
    assert.equal(client.rows[0].company,'Comercial Uno','Legacy MIPYME company name is preserved');
    await db.query("insert into public.clients(company,nit) values('Cliente A','99-AB 23')");
    const normalized=await db.query("select nit_normalized from public.clients where nit='99-AB 23'");
    assert.equal(normalized.rows[0].nit_normalized,'99AB23');
    await assert.rejects(()=>db.query("insert into public.clients(company,nit) values('Cliente B','99.AB/23')"),error=>error.code==='23505');

    await db.exec(`create table public.admin_users(id uuid primary key,username text);
      create table public.workers(id uuid primary key,full_name text,position text,is_active boolean default true);
      create function public.set_erp_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
      insert into public.admin_users values('00000000-0000-4000-8000-000000000001','qa');
      insert into public.workers values('00000000-0000-4000-8000-000000000002','Trabajador QA','Operaciones',true);`);
    await db.exec(await readFile('supabase/migrations/20260926184210_worker_monthly_payroll.sql','utf8'));
    const base="worker_id,period_start,salary_amount,tips_amount,currency,created_by,updated_by";
    const values="'00000000-0000-4000-8000-000000000002','2026-09-01',1200,25,'USD','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'";
    await db.query(`insert into public.worker_monthly_payroll(${base}) values(${values})`);
    await assert.rejects(()=>db.query(`insert into public.worker_monthly_payroll(${base}) values(${values})`),error=>error.code==='23505');
    await assert.rejects(()=>db.query("update public.worker_monthly_payroll set status='void',voided_at=now()"),error=>error.code==='23514');
    await db.query("update public.worker_monthly_payroll set status='void',voided_at=now(),voided_by='00000000-0000-4000-8000-000000000001'");
    await db.query(`insert into public.worker_monthly_payroll(${base}) values(${values})`);
  }finally{await db.close();}
}

async function checkPayrollPrivacy(){
  const source=await readFile('api/payroll.js','utf8');
  assert.match(source,/authorizeAdmin\(req, res, req\.method === 'GET' \? 'finance\.read' : 'finance\.write'\)/);
  assert.match(source,/workers:writeAccess \? workers \|\| \[\] : \[\]/);
  assert.match(source,/entries:writeAccess \? entries \|\| \[\] : \[\]/);
  assert.match(source,/company_totals:/);
}

async function checkCompanyResult({companyPending=false,writable=true}={}){
  const dom=new JSDOM(costsFixture({companyPending,writable}),{url:'https://erp-visual.invalid/',runScripts:'dangerously',pretendToBeVisual:true});
  try{
    const document=dom.window.document;
    await wait(25);
    document.querySelector('[data-view="profitability"]').click();
    await wait(25);
    document.querySelector('[data-profit-subview="company"]').click();
    await wait(25);
    const row=()=>document.querySelector('.company-month-table tbody tr');
    if(companyPending){
      assert.match(row()?.textContent||'',/Pendiente de costo/);
      assert.match(document.querySelector('.company-annual-card')?.textContent||'',/costo de mercancía incompleto/);
      return;
    }
    assert.match(row()?.textContent||'',/125\.00/,'Salary and tips reduce monthly profit; void payroll is excluded');
    if(!writable){
      assert.equal(document.querySelectorAll('.payroll-row').length,0,'Read-only finance users do not receive individual payroll rows');
      assert.equal(document.querySelector('[data-payroll-add]'),null,'Read-only finance users cannot register payroll');
      assert.match(document.querySelector('.payroll-section')?.textContent||'',/detalle por trabajador requiere permiso/);
      return;
    }
    document.querySelector('[data-payroll-add]').click();
    document.querySelector('#payrollPeriod').value=period;
    document.querySelector('#payrollSalary').value='300';
    document.querySelector('#payrollTips').value='50';
    document.querySelector('#savePayroll').click();
    await wait(40);
    assert.match(row()?.textContent||'',/225\.00/,'New salary and tips reduce profit');
    assert.match(row()?.querySelector('td:last-child')?.className||'',/company-net-negative/);
    document.querySelector('[data-payroll-void="fixture-payroll-created"]').click();
    await wait(10);
    document.querySelector('#costDecisionAccept').click();
    await wait(40);
    assert.match(row()?.textContent||'',/125\.00/,'Voiding a payroll record restores the prior result');
  }finally{dom.window.close();}
}

await checkSchema();
await checkPayrollPrivacy();
await checkCompanyResult();
await checkCompanyResult({writable:false});
await checkCompanyResult({companyPending:true});
console.log('ERP business workflows: NIT duplicate protection, payroll constraints, company profit, salary/tips deductions, void history, and incomplete-cost warning passed.');
