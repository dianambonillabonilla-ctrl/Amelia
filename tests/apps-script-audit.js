'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = process.cwd();
const failures = [];
const warnings = [];
const checks = [];

function ok(name, detail = '') {
  checks.push({ status: 'OK', name, detail });
}

function fail(name, detail) {
  failures.push({ status: 'FAIL', name, detail });
}

function warn(name, detail) {
  warnings.push({ status: 'WARN', name, detail });
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

const backendFiles = fs.readdirSync(root)
  .filter((name) => name.endsWith('.js'))
  .filter((name) => fs.statSync(path.join(root, name)).isFile())
  .sort();

if (!backendFiles.length) {
  fail('Archivos backend', 'No se encontraron archivos .js en la raíz.');
} else {
  ok('Archivos backend', `${backendFiles.length} archivos encontrados.`);
}

// 1. Manifiesto de Apps Script.
try {
  const manifest = JSON.parse(read('appsscript.json'));
  if (manifest.runtimeVersion !== 'V8') {
    fail('Manifiesto', 'runtimeVersion debe ser V8.');
  } else if (!manifest.webapp) {
    fail('Manifiesto', 'Falta la configuración webapp.');
  } else {
    ok('Manifiesto', `V8; acceso=${manifest.webapp.access}; executeAs=${manifest.webapp.executeAs}`);
  }
} catch (error) {
  fail('Manifiesto', `appsscript.json inválido: ${error.message}`);
}

// 2. Sintaxis de cada archivo.
for (const file of backendFiles) {
  try {
    new vm.Script(read(file), { filename: file });
  } catch (error) {
    fail(`Sintaxis ${file}`, error.message);
  }
}
if (!failures.some((x) => x.name.startsWith('Sintaxis '))) {
  ok('Sintaxis individual', 'Todos los archivos pasan el parser de Node/V8.');
}

// 3. Apps Script carga todos los archivos en un mismo espacio global.
// Concatenarlos detecta const/let/class duplicados que no aparecen al validar cada archivo por separado.
try {
  const combined = backendFiles
    .map((file) => `\n/* ===== ${file} ===== */\n${read(file)}\n`)
    .join('\n');
  new vm.Script(combined, { filename: 'apps-script-combinado.js' });
  ok('Espacio global combinado', 'No hay const/let/class duplicados ni errores de sintaxis entre archivos.');
} catch (error) {
  fail('Espacio global combinado', error.message);
}

// 4. Índice de funciones globales para hallar duplicaciones y entradas obligatorias.
const functionLocations = new Map();
for (const file of backendFiles) {
  const lines = read(file).split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (!match) return;
    const name = match[1];
    if (!functionLocations.has(name)) functionLocations.set(name, []);
    functionLocations.get(name).push(`${file}:${index + 1}`);
  });
}

const requiredFunctions = [
  'doGet',
  'doPost',
  'handleRequest_',
  'jsonOut_',
  'login_',
  'validarToken_',
  'configurarHojas'
];
for (const name of requiredFunctions) {
  if (!functionLocations.has(name)) {
    fail('Función obligatoria', `No existe ${name}().`);
  }
}
if (!requiredFunctions.some((name) => !functionLocations.has(name))) {
  ok('Funciones obligatorias', requiredFunctions.join(', '));
}

const duplicates = [...functionLocations.entries()]
  .filter(([, locations]) => locations.length > 1)
  .sort(([a], [b]) => a.localeCompare(b));
if (duplicates.length) {
  warn(
    'Funciones globales repetidas',
    duplicates.map(([name, locations]) => `${name}: ${locations.join(', ')}`).join(' | ')
  );
} else {
  ok('Funciones globales repetidas', 'No se detectaron funciones de nivel superior repetidas.');
}

// 5. Invariantes de las correcciones recientes.
if (fs.existsSync(path.join(root, 'FudoEstado.js'))) {
  fail('FudoEstado obsoleto', 'FudoEstado.js todavía existe y puede duplicar FudoPanelSync.js.');
} else {
  ok('FudoEstado obsoleto', 'El archivo viejo no existe.');
}
if (!fs.existsSync(path.join(root, 'FudoPanelSync.js'))) {
  fail('FudoPanelSync', 'Falta FudoPanelSync.js.');
} else {
  ok('FudoPanelSync', 'Archivo presente.');
}
if (fs.existsSync(path.join(root, 'FudoSuibitems.js'))) {
  fail('Nombre FudoSubitems', 'Todavía existe FudoSuibitems.js con el typo.');
}
if (!fs.existsSync(path.join(root, 'FudoSubitems.js'))) {
  fail('Nombre FudoSubitems', 'Falta FudoSubitems.js.');
} else {
  ok('Nombre FudoSubitems', 'Nombre corregido.');
}
if (!functionLocations.has('fudoSubitemsUpsert_')) {
  fail('Subitems', 'Falta fudoSubitemsUpsert_().');
}
if (!functionLocations.has('fudoDescuentosPropinasUpsert_')) {
  fail('Subitems', 'Falta la dependencia fudoDescuentosPropinasUpsert_().');
}
if (functionLocations.has('fudoSubitemsUpsert_') && functionLocations.has('fudoDescuentosPropinasUpsert_')) {
  ok('Subitems', 'Wrapper y dependencia están presentes.');
}

// 6. Archivos y patrones que no deben volver al código.
if (fs.existsSync(path.join(root, 'TEMP.js'))) {
  fail('TEMP.js', 'TEMP.js no debe desplegarse.');
} else {
  ok('TEMP.js', 'No existe.');
}

const combinedText = backendFiles.map((file) => read(file)).join('\n');
const secretPatterns = [
  /fudoApiConfigurarCredenciales_\s*\(\s*['"][^'"]+['"]\s*,\s*['"][^'"]+['"]\s*\)/i,
  /apiSecret\s*[:=]\s*['"][^'"]{8,}['"]/i,
  /Authorization\s*:\s*['"]Bearer\s+[A-Za-z0-9._-]{16,}['"]/i
];
const matchedSecret = secretPatterns.find((pattern) => pattern.test(combinedText));
if (matchedSecret) {
  fail('Secretos en código', `Se detectó un patrón sensible: ${matchedSecret}`);
} else {
  ok('Secretos en código', 'No se detectaron credenciales literales con los patrones críticos.');
}

// 7. Comprobaciones mínimas del enrutador web.
const codeFile = backendFiles.find((file) => file.toLowerCase() === 'code.js');
if (!codeFile) {
  fail('Enrutador', 'No existe Code.js.');
} else {
  const code = read(codeFile);
  if (!/function\s+doPost\s*\(/.test(code) || !/handleRequest_\s*\(e,\s*['"]POST['"]\)/.test(code)) {
    fail('Enrutador POST', 'doPost() no delega correctamente en handleRequest_.');
  } else {
    ok('Enrutador POST', 'doPost() está conectado a handleRequest_.');
  }
  if (!/action\s*===\s*['"]login['"]/.test(code)) {
    fail('Ruta login', 'No se encontró el manejo de action=login.');
  } else {
    ok('Ruta login', 'La acción login está registrada.');
  }
}

console.log('\n=== AUDITORÍA APPS SCRIPT ===');
for (const item of checks) console.log(`✅ ${item.name}: ${item.detail}`);
for (const item of warnings) console.log(`⚠️  ${item.name}: ${item.detail}`);
for (const item of failures) console.error(`❌ ${item.name}: ${item.detail}`);
console.log(`\nResultado: ${checks.length} OK, ${warnings.length} advertencias, ${failures.length} fallos.`);

process.exit(failures.length ? 1 : 0);
