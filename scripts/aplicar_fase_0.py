from pathlib import Path
import json

code_path = Path('apps-script/Code.gs')
code = code_path.read_text(encoding='utf-8')
marker = "// FASE 0 — BLOQUEO TOTAL DE REACTIVACIÓN"
if marker not in code:
    anchor = "const SHEET_NAMES = {"
    bloque = """// FASE 0 — BLOQUEO TOTAL DE REACTIVACIÓN
// Mientras esta bandera sea true, el backend solo acepta autenticación y Usuarios.
// No basta ocultar pantallas: este es el candado autoritativo del Web App /exec.
const MODO_REACTIVACION_BACKEND = true;
const ACCIONES_PERMITIDAS_REACTIVACION_BACKEND = [
  'login',
  'logout',
  'whoami',
  'cambiar_password',
  'usuarios_listar',
  'usuarios_guardar',
  'usuario_resetear_password'
];

function accionPermitidaEnReactivacion_(action) {
  return !MODO_REACTIVACION_BACKEND || ACCIONES_PERMITIDAS_REACTIVACION_BACKEND.indexOf(action) !== -1;
}

function automatizacionesPermitidasEnReactivacion_() {
  return !MODO_REACTIVACION_BACKEND;
}

"""
    if anchor not in code:
        raise SystemExit('No se encontró SHEET_NAMES')
    code = code.replace(anchor, bloque + anchor, 1)

    old = """/**
 * Corre UNA vez (o de nuevo si cambian los triggers) para activar:
 * - tareaDiaria_ (diario ~6am): limpia sesiones vencidas, revisa alertas de stock bajo y toma el
 *   snapshot diario de stock consolidado de FUDO (fudoSincronizacionStockDiaria_).
 * - fudoSincronizacionAutomatica_ (cada 15 min): sincroniza ventas y pagos de FUDO solos, sin que
 *   un Administrador tenga que entrar a "Importar de FUDO" y sincronizar a mano. Si no hay
 *   credenciales de la API configuradas todavía (fudoApiConfigurarCredenciales_), no hace nada —
 *   la sincronización manual de importar.html sigue disponible igual como respaldo.
 */
function configurarTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'tareaDiaria_' || fn === 'fudoSincronizacionAutomatica_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tareaDiaria_').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('fudoSincronizacionAutomatica_').timeBased().everyMinutes(15).create();
  Logger.log('Triggers configurados: tareaDiaria_ (diario ~6am) y fudoSincronizacionAutomatica_ (cada 15 min).');
}

function tareaDiaria_() {
  limpiarSesionesVencidas_();
"""
    new = """/**
 * Fase 0: configurarTriggers() NO enciende automatizaciones mientras la reactivación esté activa.
 * Primero elimina cualquier trigger operativo antiguo; solo cuando MODO_REACTIVACION_BACKEND sea
 * false vuelve a crear tareaDiaria_ y la sincronización automática de FUDO.
 */
function configurarTriggers() {
  const eliminados = desactivarTriggersReactivacion_();
  if (MODO_REACTIVACION_BACKEND) {
    Logger.log('Fase 0 activa: automatizaciones desactivadas. Triggers eliminados: ' + eliminados);
    return { reactivacion: true, creados: 0, eliminados: eliminados };
  }
  ScriptApp.newTrigger('tareaDiaria_').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('fudoSincronizacionAutomatica_').timeBased().everyMinutes(15).create();
  Logger.log('Triggers configurados: tareaDiaria_ (diario ~6am) y fudoSincronizacionAutomatica_ (cada 15 min).');
  return { reactivacion: false, creados: 2, eliminados: eliminados };
}

/** Ejecutar manualmente una vez al instalar Fase 0 para retirar triggers ya instalados. */
function desactivarTriggersReactivacion_() {
  let eliminados = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'tareaDiaria_' || fn === 'fudoSincronizacionAutomatica_') {
      ScriptApp.deleteTrigger(t);
      eliminados++;
    }
  });
  Logger.log('Fase 0: ' + eliminados + ' trigger(s) operativo(s) eliminado(s).');
  return eliminados;
}

function tareaDiaria_() {
  if (!automatizacionesPermitidasEnReactivacion_()) {
    Logger.log('Fase 0 activa: tareaDiaria_ omitida.');
    return;
  }
  limpiarSesionesVencidas_();
"""
    if old not in code:
        raise SystemExit('No se encontró bloque configurarTriggers/tareaDiaria')
    code = code.replace(old, new, 1)

    old = """  const params = Object.assign({}, e.parameter || {}, body || {});
  const action = params.action;

  try {
    // Login y logout no requieren sesión previa válida (logout debe funcionar incluso con token vencido)
"""
    new = """  const params = Object.assign({}, e.parameter || {}, body || {});
  const action = params.action;

  // Candado autoritativo de Fase 0. Se evalúa ANTES de autenticar o entrar al switch para que
  // ninguna URL directa al /exec pueda alcanzar un módulo aún inactivo, incluso con token válido.
  if (!accionPermitidaEnReactivacion_(action)) {
    return jsonOut_({
      ok: false,
      codigo: 'MODULO_INACTIVO',
      error: 'Este módulo está temporalmente inactivo mientras se valida la aplicación por etapas.'
    });
  }

  try {
    // Login y logout no requieren sesión previa válida (logout debe funcionar incluso con token vencido)
"""
    if old not in code:
        raise SystemExit('No se encontró punto de entrada handleRequest_')
    code = code.replace(old, new, 1)
    code_path.write_text(code, encoding='utf-8')

fudo_path = Path('apps-script/FudoApi.gs')
fudo = fudo_path.read_text(encoding='utf-8')
guard = "Fase 0 activa: fudoSincronizacionAutomatica_ omitida."
if guard not in fudo:
    old = """function fudoSincronizacionAutomatica_() {
  const props = PropertiesService.getScriptProperties();
"""
    new = """function fudoSincronizacionAutomatica_() {
  if (typeof automatizacionesPermitidasEnReactivacion_ === 'function' && !automatizacionesPermitidasEnReactivacion_()) {
    Logger.log('Fase 0 activa: fudoSincronizacionAutomatica_ omitida.');
    return;
  }
  const props = PropertiesService.getScriptProperties();
"""
    if old not in fudo:
        raise SystemExit('No se encontró fudoSincronizacionAutomatica_')
    fudo = fudo.replace(old, new, 1)

    old = """function fudoSincronizacionStockDiaria_() {
  const props = PropertiesService.getScriptProperties();
"""
    new = """function fudoSincronizacionStockDiaria_() {
  if (typeof automatizacionesPermitidasEnReactivacion_ === 'function' && !automatizacionesPermitidasEnReactivacion_()) {
    Logger.log('Fase 0 activa: fudoSincronizacionStockDiaria_ omitida.');
    return;
  }
  const props = PropertiesService.getScriptProperties();
"""
    if old not in fudo:
        raise SystemExit('No se encontró fudoSincronizacionStockDiaria_')
    fudo = fudo.replace(old, new, 1)
    fudo_path.write_text(fudo, encoding='utf-8')

config_path = Path('assets/config.js')
config = config_path.read_text(encoding='utf-8')
route_marker = '// FASE 0 — bloqueo de navegación directa'
if route_marker not in config:
    route = """
// FASE 0 — bloqueo de navegación directa: aunque alguien conozca una URL antigua,
// solo index, Usuarios y cambio de contraseña pueden permanecer abiertos durante esta etapa.
const PAGINAS_PERMITIDAS_REACTIVACION = ['index.html', 'usuarios.html', 'cambiar-password.html', ''];
(function bloquearPaginaInactiva_() {
  if (!MODO_REACTIVACION) return;
  const pagina = window.location.pathname.split('/').pop();
  if (!PAGINAS_PERMITIDAS_REACTIVACION.includes(pagina)) {
    window.location.replace(Sesion.token() ? 'usuarios.html' : 'index.html');
  }
})();
"""
    anchor2 = "// Sin esto, una petición que se queda colgada"
    if anchor2 not in config:
        raise SystemExit('No se encontró ancla de navegación')
    config = config.replace(anchor2, route + '\n' + anchor2, 1)
    config_path.write_text(config, encoding='utf-8')

test_path = Path('tests/fase-0-reactivacion.test.js')
test_path.write_text("""const fs = require('fs');
const assert = require('assert');

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
assert(code.includes("if (MODO_REACTIVACION_BACKEND)"));
assert(code.includes("Fase 0 activa: tareaDiaria_ omitida."));
assert(fudo.includes("Fase 0 activa: fudoSincronizacionAutomatica_ omitida."));
assert(fudo.includes("Fase 0 activa: fudoSincronizacionStockDiaria_ omitida."));
assert(config.includes("const MODO_REACTIVACION = true;"));
assert(config.includes("const MODULOS_ACTIVOS = ['usuarios'];"));
assert(config.includes("PAGINAS_PERMITIDAS_REACTIVACION"));
assert(config.includes("'usuarios.html'"));
assert(!config.match(/MODULOS_ACTIVOS\s*=\s*\[[^\]]*,/), 'Solo Usuarios debe estar activo');
console.log('✓ Fase 0: backend, navegación y automatizaciones bloqueados');
""", encoding='utf-8')

pkg_path = Path('package.json')
pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
cmd = 'node tests/fase-0-reactivacion.test.js'
if cmd not in pkg['scripts']['test']:
    pkg['scripts']['test'] = pkg['scripts']['test'].replace('node tests/usuarios-perfiles.test.js', 'node tests/usuarios-perfiles.test.js && ' + cmd)
    pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
