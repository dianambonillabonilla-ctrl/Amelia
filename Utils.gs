function nowIso() {
  return new Date().toISOString();
}

function generateId(prefix) {
  return prefix + '-' + Utilities.getUuid().slice(0, 8).toUpperCase();
}

function generateSalt() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function hashPassword(password, salt) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password + '::' + salt
  );
  return bytes.map(function(b) {
    var v = b < 0 ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function generateToken() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function parseNumeric(value) {
  if (typeof value === 'number') return value;
  var str = String(value || '').trim();
  if (!str) return NaN;
  if (/^(pedir|traer|ok|x|\?|-)$/i.test(str)) return NaN;
  str = str.replace(/\./g, '').replace(',', '.');
  return Number(str);
}

function toMap(headers, row) {
  var out = {};
  headers.forEach(function(h, i) {
    out[h] = row[i];
  });
  return out;
}

function requireNumeric(value, fieldName) {
  var num = parseNumeric(value);
  if (isNaN(num)) throw new Error('Campo no numérico: ' + fieldName);
  return num;
}
