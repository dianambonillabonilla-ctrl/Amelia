function getDb_() {
  const id = PropertiesService.getScriptProperties().getProperty(AMELIA.DB_PROPERTY);
  if (!id) throw new Error('La aplicación no está configurada. Ejecuta setupApplication() desde Apps Script.');
  return SpreadsheetApp.openById(id);
}

function getTable_(name) {
  const sheet = getDb_().getSheetByName(name);
  if (!sheet) throw new Error('No existe la tabla ' + name);
  return sheet;
}

function ensureTable_(db, name, headers) {
  let sheet = db.getSheetByName(name);
  if (!sheet) sheet = db.insertSheet(name);
  const current = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0] : [];
  const differs = headers.some(function(h, i) { return current[i] !== h; });
  if (differs) {
    if (sheet.getLastRow() > 1) throw new Error('La tabla ' + name + ' tiene columnas incompatibles.');
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#173F35').setFontColor('#FFFFFF');
  }
  return sheet;
}

function getRows_(name) {
  const sheet = getTable_(name);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(function(row) { return row.some(function(v) { return v !== ''; }); }).map(function(row) {
    const out = {};
    headers.forEach(function(h, i) { out[h] = row[i]; });
    return out;
  });
}

function appendRow_(name, obj) {
  const sheet = getTable_(name);
  const headers = TABLES[name];
  sheet.appendRow(headers.map(function(h) { return obj[h] === undefined ? '' : obj[h]; }));
  return obj;
}

function appendRows_(name, objects) {
  if (!objects || !objects.length) return;
  const sheet = getTable_(name);
  const headers = TABLES[name];
  const rows = objects.map(function(obj) { return headers.map(function(h) { return obj[h] === undefined ? '' : obj[h]; }); });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

function upsertRow_(name, key, obj) {
  const sheet = getTable_(name);
  const headers = TABLES[name];
  const keyIndex = headers.indexOf(key);
  if (keyIndex < 0) throw new Error('Clave inválida para ' + name);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const keys = sheet.getRange(2, keyIndex + 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === String(obj[key])) {
        const old = sheet.getRange(i + 2, 1, 1, headers.length).getValues()[0];
        const merged = {};
        headers.forEach(function(h, j) { merged[h] = obj[h] === undefined ? old[j] : obj[h]; });
        sheet.getRange(i + 2, 1, 1, headers.length).setValues([headers.map(function(h) { return merged[h]; })]);
        return merged;
      }
    }
  }
  return appendRow_(name, obj);
}

function findRow_(name, predicate) {
  const rows = getRows_(name);
  for (let i = 0; i < rows.length; i++) if (predicate(rows[i])) return rows[i];
  return null;
}

function makeId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 20);
}

function nowIso_() { return new Date().toISOString(); }

function dateKey_(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value).slice(0, 10);
  return Utilities.formatDate(d, AMELIA.TIMEZONE, 'yyyy-MM-dd');
}

function normalizeText_(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function asNumber_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  let text = String(value || '').trim();
  if (text.indexOf(',') >= 0) text = text.replace(/\./g, '').replace(',', '.');
  text = text.replace(/[^0-9.\-]/g, '');
  const n = Number(text);
  return isFinite(n) ? n : 0;
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return callback(); } finally { lock.releaseLock(); }
}

function audit_(userId, action, entityType, entityId, detail) {
  appendRow_('AuditLog', {
    auditId: makeId_('aud'), timestamp: nowIso_(), userId: userId || '', action: action,
    entityType: entityType || '', entityId: entityId || '', detail: typeof detail === 'string' ? detail : JSON.stringify(detail || {}), createdAt: nowIso_()
  });
}

function createAlert_(data) {
  return appendRow_('Alerts', {
    alertId: makeId_('alt'), date: data.date || dateKey_(new Date()), locationId: data.locationId || '',
    severity: data.severity || 'MEDIUM', type: data.type || 'GENERAL', title: data.title || 'Alerta',
    detail: data.detail || '', status: 'OPEN', referenceType: data.referenceType || '', referenceId: data.referenceId || '',
    source: data.source || 'SYSTEM', createdAt: nowIso_(), resolvedAt: '', resolvedBy: ''
  });
}
