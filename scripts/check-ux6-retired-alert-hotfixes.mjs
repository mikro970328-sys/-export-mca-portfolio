import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const erp = read('admin/erp.js');
const failures = [];
const fail = message => failures.push(message);

const retired = [
  'admin/tracking-alert-center.js',
  'admin/phase4-hotfix-navigation-bell.js',
  'admin/phase4-operational-indicators.js'
];
for (const path of retired) {
  if (fs.existsSync(path)) fail(`retired compensator still exists: ${path}`);
  if (erp.includes(path.replace('admin/','/admin/'))) fail(`ERP boot still references retired compensator: ${path}`);
}

for (const owner of [
  '/admin/operational-alert-center.js',
  '/admin/operational-navigation.js',
  '/admin/containers-module.js'
]) {
  if (!erp.includes(owner)) fail(`modern owner missing from ERP boot: ${owner}`);
}

if (!erp.includes("loadScript('/admin/operational-alert-center.js")) fail('operational alerts must be booted explicitly');
if (!erp.includes("loadScript('/admin/operational-navigation.js")) fail('operational navigation must be booted explicitly');
if (!erp.includes("loadScript('/admin/containers-module.js")) fail('container registration/tracking owner must be booted explicitly');

if (failures.length) {
  console.error('UX6 retired alert hotfix gate failed:\n' + failures.map(x => `- ${x}`).join('\n'));
  process.exit(1);
}
console.log('UX6 retired alert hotfix gate passed.');
