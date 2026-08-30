import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const apiDir = path.join(root, 'api');
const failures = [];

const walk = dir => fs.readdirSync(dir, { withFileTypes:true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});

const relative = file => path.relative(root, file).replaceAll('\\','/');
const exemptLegacy = new Set([
  'api/_lib.js',
  'api/login.js'
]);

for (const file of walk(apiDir).filter(file => file.endsWith('.js'))) {
  const rel = relative(file);
  const src = fs.readFileSync(file, 'utf8');
  if (!exemptLegacy.has(rel) && /\brequire(?:Master)?Admin\b/.test(src)) {
    failures.push(`${rel}: todavía usa requireAdmin/requireMasterAdmin legacy`);
  }
}

const lib = fs.readFileSync(path.join(apiDir, '_lib.js'), 'utf8');
for (const required of ['export async function authenticateAdmin','export async function authorizeAdmin','admin_effective_permissions']) {
  if (!lib.includes(required)) failures.push(`api/_lib.js: falta ${required}`);
}

for (const file of ['api/account.js','api/admins.js','api/access-control.js']) {
  const src = fs.readFileSync(path.join(root,file), 'utf8');
  if (!/\b(?:authenticateAdmin|authorizeAdmin)\b/.test(src)) failures.push(`${file}: no usa autorización dinámica P3`);
}

for (const migration of [
  'supabase/migrations/20260830090500_p3_access_control_foundation.sql',
  'supabase/migrations/20260830092000_p3_access_control_setters.sql'
]) {
  if (!fs.existsSync(path.join(root,migration))) failures.push(`${migration}: falta migración P3`);
}

if (failures.length) {
  console.error('P3 access-control check failed:\n' + failures.map(item => `- ${item}`).join('\n'));
  process.exit(1);
}

console.log('P3 access-control check passed.');
