// Supplier API input validation only. SQL remains the owner of balances and rounded line totals.
export function supplierNumberText(value) {
  if (value == null) return '';
  return typeof value === 'number' || typeof value === 'string' ? String(value).trim() : null;
}

export function isSupplierDecimal(value) {
  if (typeof value !== 'string' || value.length > 80 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return false;
  const exponent = Number(value.toLowerCase().split('e')[1] || 0);
  return Math.abs(exponent) <= 308 && Number.isFinite(Number(value));
}

export function hasSupplierCentPrecision(value) {
  if (!isSupplierDecimal(value)) return false;
  const [coefficient, exponent = '0'] = value.toLowerCase().split('e');
  const decimals = (coefficient.split('.')[1] || '').length - Number(exponent);
  if (decimals <= 2) return true;
  const digits = coefficient.replace(/[+.-]/g, '');
  const extra = decimals - 2;
  return extra >= digits.length ? /^0+$/.test(digits) : /^0+$/.test(digits.slice(-extra));
}
