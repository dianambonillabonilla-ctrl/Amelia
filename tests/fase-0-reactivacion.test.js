const fs = require('fs');
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
