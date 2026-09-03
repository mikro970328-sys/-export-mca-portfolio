import { readFile } from 'node:fs/promises';

const testPath = new URL('../e2e/browserstack/ux7-production-readonly.spec.cjs', import.meta.url);
const workflowPath = new URL('../.github/workflows/browserstack-ios-certification.yml', import.meta.url);
const [testSource, workflowSource] = await Promise.all([
  readFile(testPath, 'utf8'),
  readFile(workflowPath, 'utf8')
]);

const requiredTestContracts = [
  "const ALLOWED_API_WRITES = new Set(['POST /api/login'])",
  'diagnostics.blockedWrites.push(signature)',
  "openSection(page, 'containersSection')",
  "openSection(page, 'registerContainerSection')",
  "openSection(page, 'publicationsSection')",
  "openSection(page, 'invoicesSection')",
  "openSection(page, 'payablesSection')",
  "openSection(page, 'costsSection')",
  "detailAction = actualActions.includes('info')",
  'submitted: false',
  'COSTS_INITIAL_LOAD_FAILED',
  'scrollWidth !== geometry.clientWidth',
  "getAttribute('class')",
  'inputValue()',
  'frame.contentDocument',
  'invoices-form-iphone-safari',
  'owner: doc?.body?.dataset?.owner',
  'INVOICES_UI_FAILED',
  'PAYABLES_UI_FAILED'
];

const forbiddenInteractionPatterns = [
  /locator\(['"]#saveShipment['"]\)\.click\(/,
  /locator\(['"]#saveInvoice['"]\)\.click\(/,
  /getElementById\(['"]saveInvoice['"]\)\?*\.click\(/,
  /locator\(['"]#saveBill['"]\)\.click\(/,
  /getElementById\(['"]saveBill['"]\)\?*\.click\(/,
  /locator\(['"]#savePayment['"]\)\.click\(/,
  /locator\(['"]#saveBtn['"]\)\.click\(/,
  /locator\(['"]#newCharge['"]\)\.click\(/,
  /data-container-action=["'](?:edit|assign_client|manual_update|release|deliver|reactivate|delete)/,
  /request\.(?:post|put|patch|delete)\(/i,
  /\.toHaveClass\(/,
  /\.toHaveValue\(/,
  /\.frameLocator\(/
];

const missing = requiredTestContracts.filter(contract => !testSource.includes(contract));
const forbidden = forbiddenInteractionPatterns.filter(pattern => pattern.test(testSource));
const requiredWorkflowSecrets = [
  'BROWSERSTACK_USERNAME',
  'BROWSERSTACK_ACCESS_KEY',
  'ERP_E2E_USERNAME',
  'ERP_E2E_PASSWORD'
];
const missingSecrets = requiredWorkflowSecrets.filter(secret => !workflowSource.includes(`secrets.${secret}`));
const requiredWorkflowContracts = [
  'push:',
  "github.event_name == 'push'",
  'Wait for the matching production deployment',
  'github.rest.repos.listDeployments',
  'github.rest.repos.listDeploymentStatuses'
];
const missingWorkflowContracts = requiredWorkflowContracts.filter(contract => !workflowSource.includes(contract));

if (missing.length || forbidden.length || missingSecrets.length || missingWorkflowContracts.length) {
  console.error(JSON.stringify({ missing, forbidden: forbidden.map(String), missingSecrets, missingWorkflowContracts }, null, 2));
  process.exit(1);
}

console.log('BrowserStack iOS read-only contract OK');
