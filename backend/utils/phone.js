function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhoneNumber(value, defaultCountryCode = '91') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const digits = digitsOnly(raw);
  if (!digits) return null;
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+${defaultCountryCode}${digits.slice(1)}`;
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.startsWith(defaultCountryCode) && digits.length === 12) return `+${digits}`;
  return `+${digits}`;
}

function isValidPhone(value) {
  const normalized = normalizePhoneNumber(value);
  return Boolean(normalized && /^\+[1-9]\d{9,14}$/.test(normalized));
}

module.exports = { digitsOnly, normalizePhoneNumber, isValidPhone };
