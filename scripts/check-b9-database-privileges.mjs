import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const migrationsDir=path.join(root,'supabase','migrations');
const targetName='20260831002000_p15_database_privilege_hardening.sql';
const targetPath=path.join(migrationsDir,targetName);
const failures=[];

if(!fs.existsSync(targetPath)) failures.push(`${targetName}: falta migración P15`);

const normalize=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
const target=fs.existsSync(targetPath)?normalize(fs.readFileSync(targetPath,'utf8')):'';

for(const required of [
  'revoke all privileges on all tables in schema public from public, anon, authenticated;',
  'revoke all privileges on all sequences in schema public from public, anon, authenticated;',
  'revoke execute on all functions in schema public from public, anon, authenticated;',
  'drop policy if exists authenticated_access_documents on public.documents;',
  'drop policy if exists authenticated_access_expenses on public.expenses;',
  'drop policy if exists authenticated_access_importers on public.importers;',
  'drop policy if exists authenticated_access_operation_items on public.operation_items;',
  'drop policy if exists authenticated_access_operations on public.operations;',
  'drop policy if exists authenticated_access_products on public.products;',
  'drop policy if exists authenticated_access_suppliers on public.suppliers;',
  'alter function public.set_commercial_publications_updated_at() set search_path = public, pg_temp;',
  'alter default privileges for role postgres in schema public revoke all privileges on tables from public, anon, authenticated;',
  'alter default privileges for role postgres in schema public revoke all privileges on sequences from public, anon, authenticated;',
  'alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;'
]){
  if(!target.includes(required)) failures.push(`${targetName}: falta contrato: ${required}`);
}

if(/grant\s+all(?:\s+privileges)?[^;]*\bto\s+service_role\b/i.test(fs.existsSync(targetPath)?fs.readFileSync(targetPath,'utf8'):'')){
  failures.push(`${targetName}: no debe ampliar service_role con GRANT ALL; preservar mínimo privilegio existente`);
}

// From P15 forward, browser-role grants are forbidden unless a migration explicitly documents
// an intentional public exception immediately above the statement.
const migrationNames=fs.existsSync(migrationsDir)
  ? fs.readdirSync(migrationsDir).filter(name=>name.endsWith('.sql')&&name>=targetName).sort()
  : [];

for(const name of migrationNames){
  const lines=fs.readFileSync(path.join(migrationsDir,name),'utf8').split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(!/^\s*grant\b/i.test(line)) continue;
    let statement=line;
    let j=i+1;
    while(!statement.includes(';')&&j<lines.length) statement+=` ${lines[j++]}`;
    if(!/\bto\s+(?:public\s*,\s*)?(?:anon|authenticated)\b|\bto\s+(?:anon|authenticated)\s*,/i.test(statement)) continue;
    const previous=(lines[i-1]||'').trim();
    if(!/^--\s*p15-public-grant-allowlist:\s*\S+/i.test(previous)){
      failures.push(`${name}:${i+1}: grant directo a anon/authenticated sin allowlist explícita`);
    }
  }
}

if(failures.length){
  console.error('P15 database privilege gate failed:\n'+failures.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}

console.log(`P15 database privilege gate passed. Checked ${migrationNames.length} migration(s) from ${targetName} forward.`);
