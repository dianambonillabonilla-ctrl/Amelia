function setupDilanaOS() {
  var rootFolder = getOrCreateFolder(APP_CONFIG.DRIVE_ROOT);
  var db = getOrCreateSpreadsheet(rootFolder, APP_CONFIG.DB_NAME);

  APP_CONFIG.SHEETS.forEach(function(def) {
    var sh = db.getSheetByName(def.name);
    if (!sh) sh = db.insertSheet(def.name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(def.headers);
      sh.getRange(1, 1, 1, def.headers.length).setFontWeight('bold');
    }
  });

  var defaults = ['Sheet1', 'Hoja 1', 'Hoja1'];
  defaults.forEach(function(name) {
    var s = db.getSheetByName(name);
    if (s) db.deleteSheet(s);
  });

  seedBaseData_(db);
  PropertiesService.getScriptProperties().setProperty('DB_ID', db.getId());

  return {
    ok: true,
    dbId: db.getId(),
    dbUrl: db.getUrl(),
    message: 'Setup completado'
  };
}

function getDb_() {
  var dbId = PropertiesService.getScriptProperties().getProperty('DB_ID');
  if (!dbId) throw new Error('No hay DB_ID en Script Properties. Ejecuta setupDilanaOS().');
  return SpreadsheetApp.openById(dbId);
}

function getSheet_(name) {
  var sh = getDb_().getSheetByName(name);
  if (!sh) throw new Error('No existe hoja: ' + name);
  return sh;
}

function appendRow_(sheetName, row) {
  getSheet_(sheetName).appendRow(row);
}

function getAllAsObjects_(sheetName) {
  var sh = getSheet_(sheetName);
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  return data.slice(1).map(function(r) { return toMap(headers, r); });
}

function getOrCreateFolder(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function getOrCreateSpreadsheet(folder, name) {
  var it = folder.getFilesByName(name);
  if (it.hasNext()) return SpreadsheetApp.open(it.next());
  var ss = SpreadsheetApp.create(name);
  var file = DriveApp.getFileById(ss.getId());
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  return ss;
}

function seedBaseData_(db) {
  var roles = db.getSheetByName('Roles');
  if (roles.getLastRow() === 1) APP_CONFIG.ROLES_BASE.forEach(function(r) { roles.appendRow(r); });

  var sedes = db.getSheetByName('Sedes');
  if (sedes.getLastRow() === 1) APP_CONFIG.SEDES_BASE.forEach(function(s) { sedes.appendRow(s); });

  var usuarios = db.getSheetByName('Usuarios');
  if (usuarios.getLastRow() === 1) {
    var salt = generateSalt();
    usuarios.appendRow([
      'USR-0001',
      'GER001',
      'Diana Gerencia',
      'diana',
      hashPassword('Cambiar123!', salt),
      salt,
      'GERENCIA',
      'TODAS',
      'ACTIVO',
      'SI',
      '',
      '',
      nowIso(),
      ''
    ]);
  }
}
