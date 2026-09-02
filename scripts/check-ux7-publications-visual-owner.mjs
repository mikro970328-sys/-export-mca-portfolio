import fs from 'node:fs';

const files = {
  html: 'admin/publications.html',
  styles: 'admin/publications.css',
  owner: 'admin/publications.js',
  foundation: 'admin/embedded-foundation.css',
  api: 'api/publications.js',
  imageApi: 'api/publication-images.js',
  workflow: '.github/workflows/ux6b-embedded-foundation.yml'
};

const failures = [];
const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const requireText = (source, text, label = text) => {
  if (!source.includes(text)) failures.push(`falta ${label}`);
};
const forbid = (source, pattern, label) => {
  if (pattern.test(source)) failures.push(label);
};

for (const file of Object.values(files)) {
  if (!fs.existsSync(file)) failures.push(`falta ${file}`);
}

const html = read(files.html);
const styles = read(files.styles);
const owner = read(files.owner);
const foundation = read(files.foundation);
const api = read(files.api);
const imageApi = read(files.imageApi);
const workflow = read(files.workflow);

for (const text of [
  '<link rel="stylesheet" href="/admin/publications.css?v=20260902-ux7publications1">',
  '<link rel="stylesheet" href="/admin/embedded-foundation.css?v=20260902-ux6b3">',
  '<body class="erp-module-page erp-module-publications" data-owner="publications.js">',
  '<script src="/admin/publications.js?v=20260902-ux7publications1" defer></script>',
  'class="metrics publications-metrics"',
  'id="readOnlyNote"',
  'id="publicationDecision" class="modal hidden" role="alertdialog"',
  'aria-modal="true"',
  'aria-live="polite"',
  'rel="noopener"'
]) requireText(html, text, `HTML canónico ${text}`);

const ownerCssIndex = html.indexOf('/admin/publications.css?v=20260902-ux7publications1');
const foundationIndex = html.indexOf('/admin/embedded-foundation.css?v=20260902-ux6b3');
if (ownerCssIndex < 0 || foundationIndex < 0 || foundationIndex > ownerCssIndex) {
  failures.push('la base visual compartida debe cargar antes de publications.css');
}

forbid(html, /<style(?:\s|>)/i, 'publications.html conserva CSS incrustado');
forbid(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'publications.html conserva JavaScript incrustado');
forbid(html, /\sstyle\s*=/i, 'publications.html conserva estilos inline');
forbid(html, /\son(?:click|change|submit|load|error)\s*=/i, 'publications.html conserva handlers inline');
forbid(html, /font-family\s*:\s*Arial/i, 'Publicaciones vuelve a usar Arial');

for (const selector of [
  '.publications-hero',
  '.publications-metrics',
  '.publications-layout',
  '.publications-editor',
  '.publications-form-section',
  '.upload-box',
  '.photos',
  '.publications-list-card',
  '.publications-page-message',
  '.publications-read-only-note',
  '.publications-decision-card',
  '@media(max-width:1080px)',
  '@media(max-width:720px)',
  '@media(max-width:520px)'
]) requireText(styles, selector, `CSS propietario ${selector}`);

forbid(styles, /!important/i, 'publications.css usa sobrescrituras !important');
forbid(styles, /@import/i, 'publications.css depende de una importación tardía');
forbid(styles, /\b(?:fetch|MutationObserver|prompt|alert|confirm)\b/, 'publications.css mezcla comportamiento de JavaScript');
forbid(foundation, /erp-module-publications/, 'la base compartida conserva reglas propietarias de Publicaciones');

for (const text of [
  "owner: 'publications.js'",
  'const SAFE_PUBLICATION_ERRORS = new Set([',
  'function safePublicationMessage(',
  'PUBLICATIONS_UI_FAILED',
  'error.status = response.status',
  "error.endpoint = String(path).split('?')[0]",
  'result.capabilities?.write === true',
  'function applyWriteAccess()',
  'function openDeleteDecision(',
  'function closeDecision(',
  "setAttribute('aria-hidden', 'false')",
  'function renderMetrics()',
  'function publicationTable(',
  'function uploadPhotos(',
  'function savePublication('
]) requireText(owner, text, `owner de Publicaciones ${text}`);

if ((owner.match(/error\?\.message/g) || []).length !== 1) {
  failures.push('error?.message solo puede leerse dentro del traductor seguro de Publicaciones');
}
forbid(owner, /\berror\.message\b/, 'Publicaciones vuelve a renderizar error.message directamente');
forbid(owner, /\be\.message\b/, 'Publicaciones vuelve a renderizar e.message directamente');
forbid(owner, /\sstyle\s*=/i, 'publications.js conserva estilos inline');
forbid(owner, /\.style(?:\.|\[)/, 'publications.js vuelve a mutar estilos directamente');
forbid(owner, /document\.createElement\(['"]style['"]\)|style\.textContent/, 'publications.js vuelve a inyectar CSS');
forbid(owner, /\bMutationObserver\b/, 'publications.js vuelve a observar y recomponer el DOM');
forbid(owner, /\b(?:prompt|alert|confirm)\s*\(/, 'publications.js vuelve a usar diálogos nativos');

for (const text of [
  'async function canWritePublications(admin)',
  "permission_key=eq.publications.write",
  'capabilities:{ write:writeAccess }',
  "console.error('PUBLICATIONS_API_ERROR'",
  "status:500, message:'No se pudo procesar la publicación. Intenta nuevamente.'",
  "code:'PUBLICATION_UNEXPECTED_ERROR'"
]) requireText(api, text, `API segura de Publicaciones ${text}`);
forbid(api, /fail\(res,\s*400,\s*error\.message/, 'API de Publicaciones vuelve a devolver errores internos crudos');

for (const text of [
  "console.error('PUBLICATION_IMAGE_API_ERROR'",
  "status:500, message:'No se pudo procesar la imagen. Intenta nuevamente.'",
  "code:'PUBLICATION_IMAGE_UNEXPECTED_ERROR'"
]) requireText(imageApi, text, `API segura de imágenes ${text}`);
forbid(imageApi, /fail\(res,\s*400,\s*error\.message/, 'API de imágenes vuelve a devolver errores internos crudos');

for (const text of [
  "admin/publications.css",
  "admin/publications.js",
  "api/publications.js",
  "api/publication-images.js",
  'node scripts/check-ux7-publications-visual-owner.mjs',
  'node scripts/check-ux6b-embedded-foundation.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/audit-b9-api-boundaries.mjs',
  'node scripts/check-b9-public-boundaries.mjs'
]) requireText(workflow, text, `workflow ${text}`);

const openingBraces = (styles.match(/{/g) || []).length;
const closingBraces = (styles.match(/}/g) || []).length;
if (openingBraces !== closingBraces) failures.push(`publications.css está desbalanceado: ${openingBraces}/${closingBraces}`);

if (failures.length) {
  console.error('UX-7 Publications visual owner gate failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UX-7 Publications visual owner gate passed.');
console.log('- HTML, presentación y comportamiento viven en owners canónicos separados.');
console.log('- El editor respeta publications.write y usa una decisión accesible sin diálogos nativos.');
console.log('- Los fallos técnicos permanecen en diagnóstico y las APIs entregan respuestas operativas seguras.');
