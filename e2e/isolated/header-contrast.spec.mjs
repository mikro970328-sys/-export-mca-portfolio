import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Presentation-only browser acceptance. Use authored markup and stylesheet order,
// with all business scripts removed. No credentials, server or database.
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => readFileSync(`${root}${path}`, 'utf8');
const modules = ['sales', 'purchases', 'warehouse', 'inventory', 'loads', 'publications', 'suppliers', 'products', 'invoices', 'payables', 'costs', 'reports'];
const shellScripts = ['scripts/lib/ux8-browser-harness.js', 'admin/ui-icon-system.js', 'admin/dashboard-operational-state.js', 'admin/navigation-shell.js'];

function isolatedHtml(html, scripts = []) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  doc.querySelectorAll('script, meta[http-equiv], link:not([rel="stylesheet"]), img').forEach(node => node.remove());
  doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
    const path = new URL(link.getAttribute('href'), 'https://erp-visual.invalid/').pathname.slice(1);
    const style = doc.createElement('style');
    style.textContent = read(path);
    link.replaceWith(style);
  });
  const csp = doc.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:";
  doc.head.prepend(csp);
  if (doc.body.classList.contains('erp-module-warehouse')) doc.body.classList.add('warehouse-embedded');
  for (const path of scripts) {
    const script = doc.createElement('script');
    script.textContent = read(path);
    doc.body.append(script);
  }
  const result = dom.serialize();
  dom.window.close();
  return result;
}

async function openFixture(page, html) {
  const unexpected = [];
  await page.route('**/*', route => {
    if (route.request().url() === 'https://erp-visual.invalid/') return route.fulfill({contentType:'text/html', body:html});
    unexpected.push(route.request().url());
    return route.abort();
  });
  await page.goto('https://erp-visual.invalid/');
  expect(unexpected, 'fixture must never contact an API or external asset').toEqual([]);
}

// Contrast from real computed styles, alpha-composited through ancestors.
// For CSS gradients use conservative per-channel bounds of every stop/layer;
// this checks the worst possible background, not an arbitrary sample point.
async function contrasts(locator) {
  return locator.evaluateAll(elements => {
    const rgba = value => {
      const parts = value.match(/[\d.]+/g)?.map(Number);
      if (!parts || !/^rgba?\(/.test(value)) throw Error(`Unsupported CSS color: ${value}`);
      return [...parts.slice(0, 3), parts[3] ?? 1];
    };
    const blend = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
    const envelope = colors => [0, 1].map(high => [0, 1, 2].map(i => Math[high ? 'max' : 'min'](...colors.map(c => c[i]))));
    const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const ratio = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    const layers = value => {
      let depth = 0, start = 0;
      const result = [];
      [...value].forEach((char, i) => {
        if (char === '(') depth++;
        if (char === ')') depth--;
        if (char === ',' && depth === 0) { result.push(value.slice(start, i)); start = i + 1; }
      });
      result.push(value.slice(start));
      return result.reverse();
    };
    return elements.filter(element => element.getClientRects().length && getComputedStyle(element).visibility === 'visible').map(element => {
      const chain = [];
      for (let node = element; node; node = node.parentElement) chain.unshift(node);
      let backgrounds = [[255, 255, 255], [255, 255, 255]];
      for (const node of chain) {
        const css = getComputedStyle(node);
        if (css.opacity !== '1') throw Error('Opacity requires separate rendered-pixel verification');
        backgrounds = backgrounds.map(bg => blend(rgba(css.backgroundColor), bg));
        for (const layer of layers(css.backgroundImage)) {
          if (layer === 'none') continue;
          if (!layer.includes('gradient(')) throw Error('Image backgrounds require separate verification');
          const colors = [...layer.matchAll(/rgba?\([^)]+\)/g)].map(match => rgba(match[0]));
          if (!colors.length) throw Error(`Unsupported gradient: ${layer}`);
          backgrounds = envelope(colors.flatMap(fg => backgrounds.map(bg => blend(fg, bg))));
        }
      }
      const color = rgba(getComputedStyle(element).color);
      const low = luminance(backgrounds[0]), high = luminance(backgrounds[1]);
      const fg = backgrounds.map(bg => luminance(blend(color, bg)));
      const minimum = fg.some(value => value >= low && value <= high) ? 1 : Math.min(...fg.flatMap(value => [ratio(value, low), ratio(value, high)]));
      return {text:element.textContent.trim() || element.getAttribute('data-ui-icon'), color:getComputedStyle(element).color, backgrounds, ratio:Number(minimum.toFixed(2))};
    });
  });
}

for (const module of modules) {
  test(`header contrast: ${module}`, async ({ page }, info) => {
    await openFixture(page, isolatedHtml(read(`admin/${module}.html`)));
    const hero = page.locator('.module-hero');
    await expect(hero.locator('h1')).toBeVisible();
    const rows = await contrasts(hero.locator('h1, p, [class*="kicker"], button:not(:disabled), a, strong, .inventory-hero-state div > span, .reports-hero-state span:not(.reports-live-dot)'));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.filter(row => row.ratio < 4.5), 'header text requires at least 4.5:1').toEqual([]);
    const box = await hero.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    await info.attach(`${module}-contrast`, {body:JSON.stringify(rows, null, 2), contentType:'application/json'});
    await info.attach(`${module}-header`, {body:await hero.screenshot(), contentType:'image/png'});
  });
}

test('header contrast: navigation icons and mobile menu', async ({ page }, info) => {
  const generated = JSON.parse(execFileSync(process.execPath, ['scripts/preview-ux8-dashboard-navigation.mjs', 'https://erp-visual.invalid/'], {cwd:root, encoding:'utf8'}));
  await openFixture(page, isolatedHtml(generated.desktop, shellScripts));
  await expect(page.locator('.executive-dashboard')).toBeVisible();
  await expect(page.locator('[data-icon-missing]')).toHaveCount(0);
  const mobile = page.viewportSize().width <= 900;
  if (mobile) {
    const menu = page.locator('#mobileMenuBtn');
    await expect(menu).toBeVisible();
    const rows = await contrasts(menu.locator('svg'));
    expect(rows).toHaveLength(1);
    expect(rows[0].ratio).toBeGreaterThanOrEqual(3);
    await info.attach('mobile-menu', {body:await page.locator('.topbar').screenshot(), contentType:'image/png'});
    await menu.click();
    await expect(page.locator('#sidebar')).toHaveClass(/mobile-open/);
  }
  // Expand real groups through their normal controls, retaining owner hydration.
  for (const button of await page.locator('.nav-group:not(.hidden):not(.open) > .nav-group-btn').all()) await button.click();
  const rows = await contrasts(page.locator('.sidebar svg[data-icon-tone], .executive-op-icon-svg'));
  expect(rows.length).toBeGreaterThanOrEqual(20);
  expect(rows.filter(row => row.ratio < 3), 'meaningful icon outlines require at least 3:1').toEqual([]);
  const fills = await page.locator('.executive-op-icon-svg .ui-icon-tone').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fill));
  expect(fills.length).toBeGreaterThan(5);
  expect(fills.every(fill => fill !== 'none')).toBe(true);
  await info.attach('navigation-contrast', {body:JSON.stringify(rows, null, 2), contentType:'application/json'});
  await info.attach('navigation', {body:await page.screenshot(), contentType:'image/png'});
});
