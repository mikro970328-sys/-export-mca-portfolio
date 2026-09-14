import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const apiRoot = path.join(root, 'api');
const walk = dir => fs.readdirSync(dir, { withFileTypes:true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});
const rel = file => path.relative(root, file).replaceAll('\\', '/');

function findMatchingParen(source, openIndex) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1] || '';
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function callsOf(source, name) {
  const calls = [];
  const token = new RegExp(`\\b${name.replaceAll('.', '\\s*\\.\\s*')}\\s*\\(`, 'g');
  let match;
  while ((match = token.exec(source))) {
    const start = match.index;
    const open = start + match[0].lastIndexOf('(');
    const end = findMatchingParen(source, open);
    if (end < 0) break;
    calls.push(source.slice(start, end + 1));
    token.lastIndex = end + 1;
  }
  return calls;
}

// This is a direct-expression guard, not whole-program data-flow analysis.
// Behavioral tests cover the error mappings used by the affected handlers.
export function auditPublicErrorSource(source) {
  const names = new Set(['error','err','exception','cause','e']);
  for (const match of source.matchAll(/\bcatch\s*\(\s*([\w$]+)\s*\)/g)) names.add(match[1]);
  const variables = [...names].map(name=>name.replaceAll('$','\\$')).join('|');
  const rawException = new RegExp(`\\b(?:${variables})\\s*(?:(?:\\?\\.|\\.)\\s*(?:message|stack|cause)\\b|(?:\\?\\.)?\\s*\\[\\s*['\"](?:message|stack|cause)['\"]\\s*\\])`);
  const findings = [];
  for (const helper of ['fail', 'ok', 'res.end', 'res.json', 'json']) {
    callsOf(source, helper).forEach(call => {
      if (rawException.test(call)) findings.push(`RAW_EXCEPTION_IN_${helper.toUpperCase().replace('.','_')}`);
    });
  }
  return [...new Set(findings)];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const endpointFiles = walk(apiRoot).filter(file => file.endsWith('.js') && !path.basename(file).startsWith('_'));
  const findings = endpointFiles.flatMap(file=>auditPublicErrorSource(fs.readFileSync(file,'utf8')).map(code=>({file:rel(file),code})));
  console.log(JSON.stringify({ endpoint_count:endpointFiles.length, findings }, null, 2));
  if (findings.length) {
    console.error(`API public error boundary audit failed: ${findings.length} raw exception exposure(s).`);
    process.exitCode = 1;
  } else console.log(`API public error boundary audit passed for ${endpointFiles.length} endpoints.`);
}
