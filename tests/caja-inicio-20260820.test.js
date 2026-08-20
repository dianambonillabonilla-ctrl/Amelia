const assert = require('assert');
const fs = require('fs');
const path = require('path');

const archivo = path.join(__dirname, '..', 'apps-script', 'CajaInicioOperacion20260820.gs');
const src = fs.readFileSync(archivo, 'utf8');

assert.match(src, /CAJA_FECHA_INICIO_OFICIAL_\s*=\s*'2026-08-20'/);
assert.match(src, /Caja_Turno_Archivo_Pre20260820/);
assert.match(src, /Caja_Movimientos_Archivo_Pre20260820/);
assert.match(src, /CAJA_MIGRACION_HISTORICA_HECHA/);
assert.match(src, /deleteRow\(i \+ 1\)/);
assert.match(src, /cajaInicializarOperacionDesde20Agosto2026/);
assert.match(src, /fecha < CAJA_FECHA_INICIO_OFICIAL_/);

console.log('caja-inicio-20260820: OK');
