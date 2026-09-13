import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const apiRoot = path.join(root, 'api');
const walk = dir => fs.readdirSync(dir, { withFileTypes:true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});
const rel = file => path.relative(root, file).replaceAll('\\', '/');
const endpointFiles = walk(apiRoot).filter(file => file.endsWith('.js') && !path.basename(file).startsWith('_'));

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
  const token = `${name}(`;
  let offset = 0;
  while (offset < source.length) {
    const start = source.indexOf(token, offset);
    if (start < 0) break;
    const open = start + name.length;
    const end = findMatchingParen(source, open);
    if (end < 0) break;
    calls.push(source.slice(start, end + 1));
    offset = end + 1;
  }
  return calls;
}

const rawException = /\b(?:error|err|exception|cause)\s*(?:\?\.)?\.\s*message\b|\bString\s*\(\s*(?:error|err|exception|cause)\s*(?:\?\.)?\.\s*message/;
const directResponsePatterns = [
  /res\.end\s*\([\s\S]{0,500}\b(?:error|err|exception|cause)\s*(?:\?\.)?\.\s*message\b/,
  /res\.json\s*\([\s\S]{0,500}\b(?:error|err|exception|cause)\s*(?:\?\.)?\.\s*message\b/,
  /json\s*\(\s*res\s*,[\s\S]{0,500}\b(?:error|err|exception|cause)\s*(?:\?\.)?\.\s*message\b/
];

const findings = [];
for (const file of endpointFiles) {
  const name = rel(file);
  const src = fs.readFileSync(file, 'utf8');
  for (const helper of ['fail', 'ok']) {
    callsOf(src, helper).forEach(call => {
      if (rawException.test(call)) findings.push({ file:name, code:`RAW_EXCEPTION_IN_${helper.toUpperCase()}` });
    });
  }
  directResponsePatterns.forEach((pattern, index) => {
    if (pattern.test(src)) findings.push({ file:name, code:`RAW_EXCEPTION_DIRECT_RESPONSE_${index + 1}` });
  });
}

const unique = [...new Map(findings.map(item => [`${item.file}:${item.code}`, item])).values()];
console.log(JSON.stringify({ endpoint_count:endpointFiles.length, findings:unique }, null, 2));
if (unique.length) {
  console.error(`API public error boundary audit failed: ${unique.length} raw exception exposure(s).`);
  process.exit(1);
}
console.log(`API public error boundary audit passed for ${endpointFiles.length} endpoints.`);
