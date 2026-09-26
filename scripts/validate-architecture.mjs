import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260728_architecture_v1_core.sql';
const architecturePath = 'docs/ARCHITECTURE_V1.md';

const migration = fs.readFileSync(migrationPath, 'utf8');
const architecture = fs.readFileSync(architecturePath, 'utf8');
const migrationLower = migration.toLowerCase();

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
  if (!migrationLower.includes(fragment.toLowerCase())) {
    errors.push(`Falta en la migración: ${fragment}`);
  }
}

const forbiddenRegexes = [
  /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.customers\s*\(/i,
  /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.audit_logs\s*\(/i,
  /drop\s+table\s+(?:if\s+exists\s+)?public\.clients\b/i,
  /drop\s+table\s+(?:if\s+exists\s+)?public\.shipments\b/i,
  /drop\s+table\s+(?:if\s+exists\s+)?public\.audit_log\b/i,
  /alter\s+table\s+public\.clients\s+enable\s+row\s+level\s+security/i,
  /alter\s+table\s+public\.shipments\s+enable\s+row\s+level\s+security/i,
  /alter\s+table\s+public\.audit_log\s+enable\s+row\s+level\s+security/i
];

for (const pattern of forbiddenRegexes) {
  if (pattern.test(migration)) {
    errors.push(`Patrón incompatible detectado: ${pattern}`);
  }
}

const createTriggerMatches = migration.match(/create trigger\s+[a-zA-Z0-9_]+/gi) || [];
const triggerNames = createTriggerMatches.map((entry) => entry.split(/\s+/).at(-1).toLowerCase());
const duplicateTriggers = triggerNames.filter((name, index) => triggerNames.indexOf(name) !== index);
if (duplicateTriggers.length) {
  errors.push(`Triggers duplicados: ${[...new Set(duplicateTriggers)].join(', ')}`);
}

const requiredDocFragments = [
  'conserva como tablas operativas principales',
  '`clients`',
  '`shipments`',
  '`shipment_history`',
  '`audit_log`',
  'no se crea una tabla paralela `customers`'
];
const architectureLower = architecture.toLowerCase();
for (const fragment of requiredDocFragments) {
  if (!architectureLower.includes(fragment.toLowerCase())) {
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
