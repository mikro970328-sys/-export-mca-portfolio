// Produces an isolated, read-only UI fixture. No server, credentials or database.
// Usage: node scripts/preview-ux8-dashboard-navigation.mjs file:///absolute/repo/path/
// Outputs JSON { desktop, mobile }; materialize as HTML in a temporary workspace.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.argv[2] || pathToFileURL(`${process.cwd()}/`).href;
const index = fs.readFileSync('admin/index.html', 'utf8');
const nav = fs.readFileSync('admin/navigation-shell.js', 'utf8');
const shell = index.slice(index.indexOf('<aside id="sidebar"'), index.indexOf('<section id="dashboardSection"'));
const ids = new Set([...index.matchAll(/data-section="([^"]+)"/g), ...nav.matchAll(/\{ id:'([^']+)'/g)].map(match => match[1]));
ids.add('tasksSection');
ids.add('accountSection');
const asset = name => new URL(name, root).href;
const esc = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const styles = ['platform-theme.css', 'navigation-shell.css', 'dashboard-executive.css'];
const scripts = ['scripts/lib/ux8-browser-harness.js', 'admin/ui-icon-system.js', 'admin/dashboard-operational-state.js', 'admin/navigation-shell.js'];
const desktop = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src file: 'unsafe-inline'; style-src file: 'unsafe-inline'; img-src file: data:; connect-src 'none'; frame-src 'none'">
<title>ERP UX8 — prueba aislada, datos ficticios</title>
${styles.map(name => `<link rel="stylesheet" href="${asset(`admin/${name}`)}">`).join('')}
<style>.qa-note{padding:12px 16px;margin-bottom:18px;border:1px solid #d69824;border-radius:10px;background:#fff8e8;color:#573b03;font-size:12px}.qa-note button{margin:8px 8px 0 0}#qaResults{white-space:pre-wrap;line-height:1.7}.qa-placeholder{padding:24px;background:white;border:1px solid #ccc;border-radius:12px}</style>
</head><body><div id="appShell">${shell.replaceAll('src="/admin/', `src="${asset('admin/')}`)}
<div class="qa-note"><b>PRUEBA AISLADA · DATOS FICTICIOS</b><div>Interfaz real; API, permisos y destinos simulados. Sin conexión a producción.</div><button id="qaRun" type="button">Ejecutar comprobaciones</button><button id="qaReset" type="button">Restablecer vista</button><div id="qaResults" role="status"></div></div>
${[...ids].map(id => `<section id="${id}" class="app-section${id === 'dashboardSection' ? '' : ' hidden'}">${id === 'dashboardSection' ? '' : `<div class="qa-placeholder">Destino de prueba: ${id}. No se cargan datos ni formularios reales.</div>`}</section>`).join('')}
</main></div></div>${scripts.map(src => `<script src="${asset(src)}"></script>`).join('')}</body></html>`;
const mobile = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>ERP UX8 — viewport móvil de 390 px</title></head><body style="margin:0;background:#e9edf2;padding:20px;font-family:system-ui"><p>Prueba responsive de 390 × 844 px · Chrome, no dispositivo iPhone real</p><iframe title="ERP móvil de prueba" style="width:390px;height:844px;border:1px solid #a5afbd" srcdoc="${esc(desktop)}"></iframe></body></html>`;
console.log(JSON.stringify({ desktop, mobile }));
