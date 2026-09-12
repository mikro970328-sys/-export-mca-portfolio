import fs from 'node:fs';

const files = {
  spec:'e2e/browserstack/ux7-operations-readonly.spec.cjs',
  package:'e2e/browserstack/package.json',
  workflow:'.github/workflows/browserstack-ios-operations-certification.yml'
};
const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireFile=file=>{if(!fs.existsSync(file))failures.push(`falta ${file}`);};
Object.values(files).forEach(requireFile);

if(!failures.length){
  const spec=read(files.spec);
  const pkg=read(files.package);
  const workflow=read(files.workflow);

  for(const required of [
    "const ALLOWED_API_WRITES = new Set(['POST /api/login'])",
    "openSection(page, 'clientsSection')",
    "sectionId:'salesSection'",
    "sectionId:'purchasesSection'",
    "sectionId:'warehouseSection'",
    "sectionId:'inventorySection'",
    "sectionId:'loadsSection'",
    "owner:'sales.js'",
    "owner:'purchases.js'",
    "owner:'warehouse.js'",
    "owner:'inventory.js'",
    "owner:'loads.js'",
    "state.owner !== 'clients-module.js'",
    'diagnostics.blockedWrites.length',
    'serverFailures.length',
    'diagnostics.failedRequests.length',
    'diagnostics.pageErrors.length',
    'visibleFrames !== 1',
    'visibleFrames !== 0',
    'scrollWidth !== state.clientWidth',
    'attachScreenshot(page, testInfo'
  ]) if(!spec.includes(required))failures.push(`spec operaciones: falta ${required}`);

  for(const forbidden of [
    /request\.(?:post|put|patch|delete)\(/i,
    /locator\([^\n]*#(?:save|new|delete|cancel|dispatch|receive)[^\n]*\)\.click\(/i,
    /getElementById\([^\n]*(?:save|delete|cancel|dispatch|receive)[^\n]*\)\?*\.click\(/i
  ]) if(forbidden.test(spec))failures.push(`spec operaciones: interacción de escritura prohibida ${forbidden}`);

  if(!pkg.includes('"test:ios:operations": "npx browserstack-node-sdk playwright test ux7-operations-readonly.spec.cjs --config=playwright.config.cjs"')) {
    failures.push('package BrowserStack: falta test:ios:operations aislado');
  }

  for(const required of [
    'name: BrowserStack iOS UX-7 Operations Certification',
    "- 'e2e/browserstack/ux7-operations-readonly.spec.cjs'",
    "- 'scripts/check-browserstack-operations-readonly.mjs'",
    'node scripts/check-browserstack-operations-readonly.mjs',
    'BROWSERSTACK_USERNAME',
    'BROWSERSTACK_ACCESS_KEY',
    'ERP_E2E_USERNAME',
    'ERP_E2E_PASSWORD',
    'Wait for the matching production deployment',
    'github.rest.repos.listDeployments',
    'github.rest.repos.listDeploymentStatuses',
    'npm run test:ios:operations'
  ]) if(!workflow.includes(required))failures.push(`workflow operaciones: falta ${required}`);

  if(!workflow.includes("github.event_name == 'workflow_dispatch' || github.event_name == 'push'")) {
    failures.push('workflow operaciones: la sesión real debe correr solo contra producción exacta o dispatch explícito');
  }
}

if(failures.length){
  console.error('BrowserStack operations read-only gate failed:');
  failures.forEach(item=>console.error(`- ${item}`));
  process.exit(1);
}
console.log('BrowserStack operations read-only contract OK');
