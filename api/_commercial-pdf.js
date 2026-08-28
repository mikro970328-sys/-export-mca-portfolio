const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 42;
const NAVY = [0.024, 0.125, 0.29];
const ORANGE = [0.961, 0.51, 0.125];
const TEXT = [0.08, 0.12, 0.18];
const MUTED = [0.38, 0.43, 0.5];
const LINE = [0.84, 0.87, 0.91];
const LIGHT = [0.96, 0.97, 0.985];

function latin(value = '') {
  return String(value ?? '')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/€/g, 'EUR')
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '?');
}

function escapePdf(value = '') {
  return latin(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\r\n]+/g, ' ');
}

function rgb(color, stroke = false) {
  return `${color.map(value => Number(value).toFixed(3)).join(' ')} ${stroke ? 'RG' : 'rg'}`;
}

function approxWidth(value, size, bold = false) {
  return latin(value).length * size * (bold ? 0.56 : 0.52);
}

function wrap(value, width, size, bold = false) {
  const raw = latin(value).trim();
  if (!raw) return [''];
  const words = raw.split(/\s+/);
  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (approxWidth(candidate, size, bold) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (approxWidth(word, size, bold) <= width) {
      line = word;
      continue;
    }
    let part = '';
    for (const char of word) {
      const candidatePart = part + char;
      if (approxWidth(candidatePart, size, bold) > width && part) {
        lines.push(part);
        part = char;
      } else {
        part = candidatePart;
      }
    }
    line = part;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function number(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return numeric.toLocaleString('en-US', { minimumFractionDigits:digits, maximumFractionDigits:digits });
}

function quantity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return numeric.toLocaleString('en-US', { maximumFractionDigits:3 });
}

class CommercialPdf {
  constructor(title, sourceLabel) {
    this.title = title;
    this.sourceLabel = sourceLabel;
    this.pages = [];
    this.page = null;
    this.y = MARGIN;
    this.newPage();
  }

  newPage() {
    this.page = [];
    this.pages.push(this.page);
    this.y = MARGIN;
    this.header();
  }

  command(value) { this.page.push(value); }

  rect(x, top, width, height, { fill = null, stroke = null, lineWidth = 1 } = {}) {
    const y = PAGE_H - top - height;
    if (fill) this.command(`${rgb(fill)} ${x} ${y} ${width} ${height} re f`);
    if (stroke) this.command(`${lineWidth} w ${rgb(stroke, true)} ${x} ${y} ${width} ${height} re S`);
  }

  line(x1, top1, x2, top2, color = LINE, width = 1) {
    this.command(`${width} w ${rgb(color, true)} ${x1} ${PAGE_H - top1} m ${x2} ${PAGE_H - top2} l S`);
  }

  text(value, x, top, { size = 10, bold = false, color = TEXT, align = 'left', width = null } = {}) {
    const content = latin(value);
    const measured = approxWidth(content, size, bold);
    let tx = x;
    if (width != null && align === 'right') tx = x + Math.max(0, width - measured);
    if (width != null && align === 'center') tx = x + Math.max(0, (width - measured) / 2);
    this.command(`${rgb(color)} BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${tx.toFixed(2)} ${(PAGE_H - top - size).toFixed(2)} Tm (${escapePdf(content)}) Tj ET`);
  }

  block(value, x, top, width, { size = 10, bold = false, color = TEXT, lineHeight = size * 1.3 } = {}) {
    const lines = wrap(value, width, size, bold);
    lines.forEach((line, index) => this.text(line, x, top + index * lineHeight, { size, bold, color }));
    return lines.length * lineHeight;
  }

  ensure(height) {
    if (this.y + height > PAGE_H - 55) this.newPage();
  }

  header() {
    this.text('EXPORT MCA LLC', MARGIN, 28, { size:16, bold:true, color:NAVY });
    this.text(this.title, PAGE_W - MARGIN - 250, 29, { size:13, bold:true, color:NAVY, align:'right', width:250 });
    this.rect(MARGIN, 49, PAGE_W - 2 * MARGIN, 3, { fill:ORANGE });
    this.y = 68;
  }

  labelValue(label, value, x, top, width) {
    this.text(label.toUpperCase(), x, top, { size:7, bold:true, color:MUTED });
    const height = this.block(value || '-', x, top + 10, width, { size:9, bold:true, color:TEXT, lineHeight:11 });
    return 10 + height;
  }

  section(title) {
    this.ensure(30);
    this.text(title.toUpperCase(), MARGIN, this.y, { size:9, bold:true, color:NAVY });
    this.line(MARGIN, this.y + 14, PAGE_W - MARGIN, this.y + 14, LINE, 0.7);
    this.y += 24;
  }

  infoGrid(items, columns = 2) {
    const gap = 20;
    const width = (PAGE_W - 2 * MARGIN - gap * (columns - 1)) / columns;
    let index = 0;
    while (index < items.length) {
      const row = items.slice(index, index + columns);
      const heights = row.map(item => 10 + wrap(item.value || '-', width, 9, true).length * 11);
      const height = Math.max(...heights, 25);
      this.ensure(height + 8);
      row.forEach((item, cellIndex) => this.labelValue(item.label, item.value, MARGIN + cellIndex * (width + gap), this.y, width));
      this.y += height + 8;
      index += columns;
    }
  }

  table(columns, rows) {
    const startX = MARGIN;
    const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
    const drawHeader = () => {
      this.ensure(28);
      this.rect(startX, this.y, totalWidth, 24, { fill:LIGHT, stroke:LINE, lineWidth:0.7 });
      let x = startX;
      columns.forEach(column => {
        this.text(column.header, x + 5, this.y + 7, { size:7, bold:true, color:NAVY, align:column.align || 'left', width:column.width - 10 });
        x += column.width;
      });
      this.y += 24;
    };

    drawHeader();
    for (const row of rows) {
      const cellLines = columns.map((column, index) => wrap(row[index] ?? '', column.width - 10, 8.5, false));
      const height = Math.max(23, ...cellLines.map(lines => lines.length * 10 + 8));
      if (this.y + height > PAGE_H - 55) {
        this.newPage();
        drawHeader();
      }
      this.rect(startX, this.y, totalWidth, height, { stroke:LINE, lineWidth:0.5 });
      let x = startX;
      columns.forEach((column, index) => {
        if (index) this.line(x, this.y, x, this.y + height, LINE, 0.5);
        cellLines[index].forEach((line, lineIndex) => this.text(line, x + 5, this.y + 6 + lineIndex * 10, { size:8.5, color:TEXT, align:column.align || 'left', width:column.width - 10 }));
        x += column.width;
      });
      this.y += height;
    }
    this.y += 12;
  }

  finish() {
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      const footerTop = PAGE_H - 35;
      page.push(`${rgb(MUTED)} BT /F1 7 Tf 1 0 0 1 ${MARGIN} ${(PAGE_H - footerTop - 7).toFixed(2)} Tm (${escapePdf(this.sourceLabel)}) Tj ET`);
      const label = `Page ${index + 1} of ${total}`;
      const measured = approxWidth(label, 7);
      page.push(`${rgb(MUTED)} BT /F1 7 Tf 1 0 0 1 ${(PAGE_W - MARGIN - measured).toFixed(2)} ${(PAGE_H - footerTop - 7).toFixed(2)} Tm (${escapePdf(label)}) Tj ET`);
    });
    return buildPdf(this.pages);
  }
}

function buildPdf(pages) {
  const regularFontId = 3;
  const boldFontId = 4;
  const pageIds = [];
  const contentIds = [];
  let nextId = 5;
  for (let index = 0; index < pages.length; index += 1) {
    pageIds.push(nextId++);
    contentIds.push(nextId++);
  }

  const objects = new Map();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`);
  objects.set(regularFontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.set(boldFontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  pages.forEach((commands, index) => {
    const stream = `${commands.join('\n')}\n`;
    const length = Buffer.byteLength(stream, 'latin1');
    objects.set(pageIds[index], `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`);
    objects.set(contentIds[index], { stream, length });
  });

  const output = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  let offset = output[0].length;
  const offsets = [0];
  const maxId = Math.max(...objects.keys());

  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = offset;
    const object = objects.get(id);
    let buffer;
    if (object && typeof object === 'object' && 'stream' in object) {
      buffer = Buffer.concat([
        Buffer.from(`${id} 0 obj\n<< /Length ${object.length} >>\nstream\n`, 'ascii'),
        Buffer.from(object.stream, 'latin1'),
        Buffer.from('endstream\nendobj\n', 'ascii')
      ]);
    } else {
      buffer = Buffer.from(`${id} 0 obj\n${object}\nendobj\n`, 'latin1');
    }
    output.push(buffer);
    offset += buffer.length;
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  output.push(Buffer.from(xref, 'ascii'));
  return Buffer.concat(output);
}

export function buildCommercialInvoicePdf(data) {
  const pdf = new CommercialPdf('COMMERCIAL INVOICE', `Source: ${data.invoice_number} | Version ${data.version}`);
  pdf.infoGrid([
    { label:'Invoice', value:data.invoice_number },
    { label:'Issue date', value:data.issue_date },
    { label:'Currency', value:data.currency },
    { label:'Customer ref.', value:data.customer_reference || '-' }
  ]);

  pdf.section('Exporter');
  pdf.infoGrid([
    { label:'Company', value:'EXPORT MCA LLC' },
    { label:'Location', value:'Miami, Florida, USA' },
    { label:'Email', value:'info@exportmca.com' },
    { label:'Phone', value:'+1 (786) 800-0735' }
  ]);

  pdf.section('Buyer / Consignee');
  pdf.infoGrid([
    { label:'Buyer', value:data.client_name },
    { label:'Buyer contact', value:[data.client_email, data.client_phone].filter(Boolean).join(' | ') || '-' },
    { label:'Consignee / Importer', value:data.importer_name || '-' },
    { label:'Consignee address', value:data.importer_address || '-' }
  ]);

  if (data.operation_code || data.incoterm || data.origin_port || data.destination_port) {
    pdf.section('Shipment');
    pdf.infoGrid([
      { label:'Operation', value:data.operation_code || '-' },
      { label:'Incoterm', value:data.incoterm || '-' },
      { label:'Origin', value:data.origin_port || '-' },
      { label:'Destination', value:data.destination_port || '-' }
    ]);
  }

  pdf.section('Goods');
  pdf.table([
    { header:'SKU', width:70 },
    { header:'Description', width:205 },
    { header:'Qty', width:65, align:'right' },
    { header:'Unit', width:55 },
    { header:'Unit price', width:85, align:'right' },
    { header:'Amount', width:48, align:'right' }
  ], data.items.map(item => [
    item.sku || '',
    item.description,
    quantity(item.quantity),
    item.unit,
    `${data.currency} ${number(item.unit_price)}`,
    number(item.line_total)
  ]));

  pdf.ensure(42);
  pdf.text('TOTAL', MARGIN + 320, pdf.y, { size:10, bold:true, color:NAVY });
  pdf.text(`${data.currency} ${number(data.total)}`, MARGIN + 390, pdf.y, { size:11, bold:true, color:NAVY, align:'right', width:138 });
  pdf.y += 28;
  if (data.notes) {
    pdf.section('Notes');
    pdf.block(data.notes, MARGIN, pdf.y, PAGE_W - 2 * MARGIN, { size:9, lineHeight:12 });
  }
  return pdf.finish();
}

export function buildPackingListPdf(data) {
  const pdf = new CommercialPdf('PACKING LIST', `Source: ${data.load_number} | Version ${data.version}`);
  pdf.infoGrid([
    { label:'Packing List', value:`PL-${data.load_number}` },
    { label:'Load', value:data.load_number },
    { label:'Container', value:data.container_number },
    { label:'B/L', value:data.bol_number || '-' }
  ]);

  pdf.section('Parties');
  pdf.infoGrid([
    { label:'Shipper', value:'EXPORT MCA LLC - Miami, Florida, USA' },
    { label:'Client', value:data.client_name || '-' },
    { label:'Consignee / Importer', value:data.importer_name || '-' },
    { label:'Consignee address', value:data.importer_address || '-' }
  ]);

  pdf.section('Shipment');
  pdf.infoGrid([
    { label:'Carrier', value:data.carrier || '-' },
    { label:'Booking', value:data.booking_number || '-' },
    { label:'Origin', value:data.origin_port || '-' },
    { label:'Destination', value:data.destination_port || '-' }
  ]);

  pdf.section('Packages / Goods');
  pdf.table([
    { header:'SKU', width:65 },
    { header:'Description', width:160 },
    { header:'Qty', width:60, align:'right' },
    { header:'Unit', width:50 },
    { header:'Pallets', width:55, align:'right' },
    { header:'Package', width:78 },
    { header:'Net kg', width:60, align:'right' }
  ], data.items.map(item => [
    item.sku || '',
    item.description,
    quantity(item.quantity),
    item.unit,
    quantity(item.pallets || 0),
    item.package_format || '-',
    item.net_weight_kg == null ? '-' : number(item.net_weight_kg, 1)
  ]));

  pdf.ensure(55);
  pdf.text('TOTAL PALLETS', MARGIN + 250, pdf.y, { size:9, bold:true, color:MUTED });
  pdf.text(quantity(data.total_pallets), MARGIN + 380, pdf.y, { size:10, bold:true, color:NAVY, align:'right', width:148 });
  pdf.y += 16;
  pdf.text('TOTAL NET WEIGHT', MARGIN + 250, pdf.y, { size:9, bold:true, color:MUTED });
  pdf.text(data.total_net_weight_kg == null ? 'Incomplete' : `${number(data.total_net_weight_kg, 1)} kg`, MARGIN + 380, pdf.y, { size:10, bold:true, color:NAVY, align:'right', width:148 });
  pdf.y += 25;
  if (data.notes) {
    pdf.section('Notes');
    pdf.block(data.notes, MARGIN, pdf.y, PAGE_W - 2 * MARGIN, { size:9, lineHeight:12 });
  }
  return pdf.finish();
}
