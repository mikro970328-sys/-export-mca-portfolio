import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260728_architecture_v1_core.sql';
const architecturePath = 'docs/ARCHITECTURE_V1.md';

const migration = fs.readFileSync(migrationPath, 'utf8');
const architecture = fs.readFileSync(architecturePath, 'utf8');

const errors = [];
const requiredMigrationFragments = [
  'create table if not exists public.companies',
  'create table if not exists public.profiles',
  'create table if not exists public.roles',
  'create table if not exists public.permissions',
  'create table if not exists public.client_contacts',
  'create table if not exists public.client_assignments',
  "to_regclass('public.clients')",
  "to_regclass('public.audit_log')",
  'alter table public.clients add column if not exists company_id',
  'alter table public.audit_log add column if not exists company_id',
  'create or replace function public.current_company_id()',
  'enable row level security'
];

for (const fragment of requiredMigrationFragments) {
  if (!migration.toLowerCase().includes(fragment.toLowerCase())) {
    errors.push(`Falta en la migración: ${fragment}`);
  }
}

const forbiddenMigrationFragments = [
  'create table if not exists public.customers',
  'create table if not exists public.audit_logs',
  'drop table public.clients',
  'drop table public.shipments',
  'drop table public.audit_log',
  'alter table public.clients enable row level security',
  'alter table public.shipments enable row level security',
  'alter table public.audit_log enable row level security'
];

for (const fragment of forbiddenMigrationFragments) {
  if (migration.toLowerCase().includes(fragment.toLowerCase())) {
    errors.push(`Patrón incompatible detectado: ${fragment}`);
  }
}

const createTriggerMatches = migration.match(/create trigger\s+[a-zA-Z0-9_]+/gi) || [];
const triggerNames = createTriggerMatches.map((entry) => entry.split(/\s+/).at(-1).toLowerCase());
const duplicateTriggers = triggerNames.filter((name, index) => triggerNames.indexOf(name) !== index);
if (duplicateTriggers.length) {
  errors.push(`Triggers duplicados: ${[...new Set(duplicateTriggers)].join(', ')}`);
}

const requiredDocFragments = [
  'Conserva como tablas operativas principales',
  '`clients`',
  '`shipments`',
  '`shipment_history`',
  '`audit_log`',
  'No se crea una tabla paralela `customers`'
];
for (const fragment of requiredDocFragments) {
  if (!architecture.includes(fragment)) {
    errors.push(`Falta en documentación: ${fragment}`);
  }
}

if (errors.length) {
  console.error('Validación fallida:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Validación estática superada.');
console.log('- No se crean tablas paralelas customers/audit_logs.');
console.log('- Se conservan clients, shipments, shipment_history y audit_log.');
console.log('- La migración añade el núcleo multiempresa, roles, permisos y asignaciones.');
console.log('- No se endurece RLS en las tablas productivas actuales.');
