import { readFile } from 'node:fs/promises';

const testPath = new URL('../e2e/browserstack/ux7-production-readonly.spec.cjs', import.meta.url);
const configPath = new URL('../e2e/browserstack/playwright.config.cjs', import.meta.url);
const packagePath = new URL('../e2e/browserstack/package.json', import.meta.url);
const workflowPath = new URL('../.github/workflows/browserstack-ios-certification.yml', import.meta.url);
const [testSource, configSource, packageSource, workflowSource] = await Promise.all([
  readFile(testPath, 'utf8'),
  readFile(configPath, 'utf8'),
  readFile(packagePath, 'utf8'),
  readFile(workflowPath, 'utf8')
]);

const requiredTestContracts = [
  "const ALLOWED_API_WRITES = new Set(['POST /api/login'])",
  "const CERT_SCOPE = process.env.ERP_CERT_SCOPE || 'all'",
  'if (RUN_CORE)',
  'if (RUN_COSTS)',
  "const PROFITABILITY_STATUS_ATTRIBUTE = 'data-profitability-probe-status'",
  "const PROFITABILITY_STATE_ATTRIBUTE = 'data-profitability-probe-state'",
  'async function installProfitabilityProbe(frameElement)',
  'new win.MutationObserver',
  "frame.setAttribute('data-profitability-probe-status', status)",
  "frame.setAttribute('data-profitability-probe-state', JSON.stringify(state))",
  'const profitabilityProbe = await installProfitabilityProbe(frameElement)',
  'toHaveAttribute(PROFITABILITY_STATUS_ATTRIBUTE, /^(?:ready|error|timeout)$/',
  "JSON.parse(profitabilityRawState || '{}')",
  'profitabilityState.timedOut',
  'JSON.stringify(profitabilityState)',
  'diagnostics.blockedWrites.push(signature)',
  "openSection(page, 'containersSection')",
  "openSection(page, 'registerContainerSection')",
  "openSection(page, 'publicationsSection')",
  'Navigation uses one canonical SVG icon system',
  'navigation-icons-iphone-safari',
  "state.owner !== 'ui-icon-system.js'",
  "page.locator('#notificationInboxBell')",
  'state.dashboardDistinctIcons < 8',
  'legacyGlyphs: false',
  "openSection(page, 'invoicesSection')",
  "openSection(page, 'payablesSection')",
  "openSection(page, 'suppliersSection')",
  "openSection(page, 'productsSection')",
  "openSection(page, 'adminsSection')",
  "openSection(page, 'reportsSection')",
  "openSection(page, 'costsSection')",
  "detailAction = actualActions.includes('info')",
  'submitted: false',
  'COSTS_INITIAL_LOAD_FAILED',
  'PROFITABILITY_LOAD_FAILED',
  "CostsModule?.openProfitability('sales_orders')",
  "state?.heading === 'Costos y rentabilidad'",
  'profitabilityState.metricCount !== 4',
  'scrollWidth !== geometry.clientWidth',
  "getAttribute('class')",
  'inputValue()',
  'frame.contentDocument',
  'invoices-form-iphone-safari',
  'Suppliers has one visual owner and a responsive directory',
  'suppliers-iphone-safari',
  "suppliersState.owner !== 'suppliers.js'",
  'suppliersState.metricCount !== 4',
  'Products has one visual owner and a responsive catalog',
  'products-iphone-safari',
  "productsState.owner !== 'products.js'",
  'productsState.metricCount !== 5',
  'Access control has one visual owner and a responsive directory',
  'access-control-iphone-safari',
  "accessState.owner !== 'access-control-administration.js'",
  'accessState.metricCount !== 4',
  'Reports has one visual owner and a contained result region',
  'reports-iphone-safari',
  "reportsState.owner !== 'reports.js'",
  'reportsState.metricCount !== 5',
  'reportsState.datasetCount !== 6',
  'owner: doc?.body?.dataset?.owner',
  'INVOICES_UI_FAILED',
  'PAYABLES_UI_FAILED',
  'SUPPLIERS_[A-Z_]+_FAILED',
  'PRODUCTS_[A-Z_]+_FAILED',
  'ACCESS_CONTROL_UI_FAILED',
  'REPORTS_UI_FAILED'
];

const forbiddenInteractionPatterns = [
  /locator\(['"]#saveShipment['"]\)\.click\(/,
  /locator\(['"]#saveInvoice['"]\)\.click\(/,
  /getElementById\(['"]saveInvoice['"]\)\?*\.click\(/,
  /locator\(['"]#saveBill['"]\)\.click\(/,
  /getElementById\(['"]saveBill['"]\)\?*\.click\(/,
  /locator\(['"]#savePayment['"]\)\.click\(/,
  /locator\(['"]#saveSupplier['"]\)\.click\(/,
  /locator\(['"]#saveProduct['"]\)\.click\(/,
  /locator\(['"]#saveBtn['"]\)\.click\(/,
  /locator\(['"]#newCharge['"]\)\.click\(/,
  /data-container-action=["'](?:edit|assign_client|manual_update|release|deliver|reactivate|delete)/,
  /request\.(?:post|put|patch|delete)\(/i,
  /\.toHaveClass\(/,
  /\.toHaveValue\(/,
  /\.frameLocator\(/,
  /frameElement\.evaluate\(async/,
  /waitForEmbeddedState\(page,\s*frameElement,\s*['"]Profitability view/
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
  'github.rest.repos.listDeploymentStatuses',
  'fail-fast: false',
  'scope: [core, costs]',
  'Run ${{ matrix.scope }} read-only certification on real iPhone Safari',
  'npm run test:ios:${{ matrix.scope }}'
];
const missingWorkflowContracts = requiredWorkflowContracts.filter(contract => !workflowSource.includes(contract));
const requiredPackageContracts = [
  '"test:ios": "npm run test:ios:core && npm run test:ios:costs"',
  '"test:ios:core": "ERP_CERT_SCOPE=core',
  '"test:ios:costs": "ERP_CERT_SCOPE=costs'
];
const missingPackageContracts = requiredPackageContracts.filter(contract => !packageSource.includes(contract));
const missingConfigContracts = [
  'timeout: 12 * 60 * 1000',
  'actionTimeout: 20 * 1000',
  'navigationTimeout: 45 * 1000'
].filter(contract => !configSource.includes(contract));

if (missing.length || forbidden.length || missingSecrets.length || missingWorkflowContracts.length || missingPackageContracts.length || missingConfigContracts.length) {
  console.error(JSON.stringify({ missing, forbidden: forbidden.map(String), missingSecrets, missingWorkflowContracts, missingPackageContracts, missingConfigContracts }, null, 2));
  process.exit(1);
}

console.log('BrowserStack iOS read-only contract OK');
