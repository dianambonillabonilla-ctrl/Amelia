from pathlib import Path

# Este script SOLO adapta el simulador de pruebas. El flag que introduce no existe en Apps Script
# real: crearEntorno() lo inyecta en el VM de Node para que las pruebas históricas sigan cubriendo
# módulos que están apagados de cara a producción.
code_path = Path('apps-script/Code.gs')
code = code_path.read_text(encoding='utf-8')
old = """function accionPermitidaEnReactivacion_(action) {
  return !MODO_REACTIVACION_BACKEND || ACCIONES_PERMITIDAS_REACTIVACION_BACKEND.indexOf(action) !== -1;
}

function automatizacionesPermitidasEnReactivacion_() {
  return !MODO_REACTIVACION_BACKEND;
}
"""
new = """function reactivacionBackendActiva_() {
  // Exclusivamente para el VM de las pruebas offline de Node. Esta variable no existe en el
  // runtime real de Apps Script ni puede enviarse por HTTP, por lo que no abre ningún bypass en
  // producción. Permite seguir probando la lógica de módulos todavía inactivos.
  if (typeof DILANA_TEST_DESACTIVAR_REACTIVACION !== 'undefined' && DILANA_TEST_DESACTIVAR_REACTIVACION === true) {
    return false;
  }
  return MODO_REACTIVACION_BACKEND;
}

function accionPermitidaEnReactivacion_(action) {
  return !reactivacionBackendActiva_() || ACCIONES_PERMITIDAS_REACTIVACION_BACKEND.indexOf(action) !== -1;
}

function automatizacionesPermitidasEnReactivacion_() {
  return !reactivacionBackendActiva_();
}
"""
if old not in code and 'function reactivacionBackendActiva_()' not in code:
    raise SystemExit('No se encontró bloque de reactivación para adaptar a pruebas')
if old in code:
    code = code.replace(old, new, 1)
code_path.write_text(code, encoding='utf-8')

helper_path = Path('tests/helpers/entorno-apps-script.js')
helper = helper_path.read_text(encoding='utf-8')
helper = helper.replace('function crearEntorno() {', 'function crearEntorno(opciones = {}) {', 1)
anchor = """  const ctx = {
    console, Math, Date: FechaControlada, JSON, String, Number, Boolean, Object, Array, RegExp, Error, Promise,
"""
replacement = """  const ctx = {
    // Por defecto, las pruebas históricas ejercen todos los módulos aunque producción esté en
    // reactivación. Para probar el candado real usar crearEntorno({ reactivacionReal: true }).
    DILANA_TEST_DESACTIVAR_REACTIVACION: opciones.reactivacionReal !== true,
    console, Math, Date: FechaControlada, JSON, String, Number, Boolean, Object, Array, RegExp, Error, Promise,
"""
if 'DILANA_TEST_DESACTIVAR_REACTIVACION:' not in helper:
    if anchor not in helper:
        raise SystemExit('No se encontró ancla del contexto de pruebas')
    helper = helper.replace(anchor, replacement, 1)
helper_path.write_text(helper, encoding='utf-8')

# Reemplaza la prueba estática por una prueba conductual del router real en modo de reactivación.
test_path = Path('tests/fase-0-reactivacion.test.js')
test_path.write_text(r"""const fs = require('fs');
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const code = fs.readFileSync('apps-script/Code.gs', 'utf8');
const fudo = fs.readFileSync('apps-script/FudoApi.gs', 'utf8');
const config = fs.readFileSync('assets/config.js', 'utf8');

assert(code.includes('const MODO_REACTIVACION_BACKEND = true;'));
for (const action of ['login','logout','whoami','cambiar_password','usuarios_listar','usuarios_guardar','usuario_resetear_password']) {
  assert(code.includes(`'${action}'`), `Falta ${action} en lista blanca backend`);
}
assert(code.includes("codigo: 'MODULO_INACTIVO'"));
assert(code.indexOf('if (!accionPermitidaEnReactivacion_(action))') < code.indexOf("if (action === 'login')"), 'El bloqueo debe correr antes del router');
assert(code.includes('function desactivarTriggersReactivacion_()'));
assert(code.includes('function reactivacionBackendActiva_()'));
assert(code.includes("Fase 0 activa: tareaDiaria_ omitida."));
assert(fudo.includes("Fase 0 activa: fudoSincronizacionAutomatica_ omitida."));
assert(fudo.includes("Fase 0 activa: fudoSincronizacionStockDiaria_ omitida."));
assert(config.includes("const MODO_REACTIVACION = true;"));
assert(config.includes("const MODULOS_ACTIVOS = ['usuarios'];"));
assert(config.includes('PAGINAS_PERMITIDAS_REACTIVACION'));
assert(!config.match(/MODULOS_ACTIVOS\s*=\s*\[[^\]]*,/), 'Solo Usuarios debe estar activo');

// Prueba conductual: el VM se crea SIN bypass para representar producción.
const env = crearEntorno({ reactivacionReal: true });
env.ctx.configurarHojas();
env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
const login = env.post({ action: 'login', usuario: 'diana', password: 'contrasegura1' });
assert.strictEqual(login.ok, true, 'login debe seguir activo');

const whoami = env.post({ action: 'whoami', token: login.token });
assert.strictEqual(whoami.ok, true, 'whoami debe seguir activo');

const usuarios = env.post({ action: 'usuarios_listar', token: login.token });
assert.strictEqual(usuarios.ok, true, 'Usuarios debe seguir activo');

for (const action of ['conteo_listar', 'conteo_registrar', 'produccion_registrar', 'traslado_crear', 'catalogo_listar', 'fudo_panel_estado', 'caja_estado', 'conciliacion']) {
  const r = env.post({ action, token: login.token });
  assert.strictEqual(r.ok, false, `${action} debe estar bloqueada`);
  assert.strictEqual(r.codigo, 'MODULO_INACTIVO', `${action} debe responder MODULO_INACTIVO`);
}

// Los handlers automáticos también deben salir antes de tocar FUDO/alertas.
assert.strictEqual(env.ctx.fudoSincronizacionAutomatica_(), undefined);
assert.strictEqual(env.ctx.fudoSincronizacionStockDiaria_(), undefined);
assert.strictEqual(env.ctx.tareaDiaria_(), undefined);

console.log('✓ Fase 0: backend, navegación y automatizaciones bloqueados de forma conductual');
""", encoding='utf-8')
