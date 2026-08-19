const fs = require('fs');
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const code = fs.readFileSync('apps-script/Code.gs', 'utf8');
const extensionFudo = fs.readFileSync('apps-script/ZZ_ReactivacionFudo.gs', 'utf8');
const fudo = fs.readFileSync('apps-script/FudoApi.gs', 'utf8');
const config = fs.readFileSync('assets/config.js', 'utf8');
const candado = code + '\n' + extensionFudo;

assert(code.includes('const MODO_REACTIVACION_BACKEND = true;'));
for (const action of [
  'login','logout','whoami','cambiar_password',
  'usuarios_listar','usuarios_guardar','usuario_resetear_password',
  'fudo_panel_estado','fudo_api_probar_conexion','fudo_api_sincronizar_ventas','fudo_api_sincronizar_pagos'
]) {
  assert(candado.includes(`'${action}'`), `Falta ${action} en el candado backend`);
}
assert(extensionFudo.includes('ACCIONES_FUDO_PERMITIDAS_REACTIVACION_'));
assert(code.includes("codigo: 'MODULO_INACTIVO'"));
assert(code.indexOf('if (!accionPermitidaEnReactivacion_(action))') < code.indexOf("if (action === 'login')"), 'El bloqueo debe correr antes del router');
assert(code.includes('function desactivarTriggersReactivacion_()'));
assert(code.includes('function reactivacionBackendActiva_()'));

// Aunque la sincronización manual está activa, las automatizaciones generales y el snapshot de
// stock permanecen apagados durante esta etapa para no reactivar módulos por accidente.
assert(code.includes("Fase 0 activa: tareaDiaria_ omitida."));
assert(fudo.includes("Fase 0 activa: fudoSincronizacionAutomatica_ omitida."));
assert(fudo.includes("Fase 0 activa: fudoSincronizacionStockDiaria_ omitida."));
assert(config.includes("const MODO_REACTIVACION = true;"));
assert(config.includes("const MODULOS_ACTIVOS = ['usuarios', 'sincronizacion'];"));
assert(config.includes('PAGINAS_PERMITIDAS_REACTIVACION'));

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

// Estado FUDO sí debe atravesar el candado autoritativo. No exige credenciales para responder su
// estado, por lo que es la prueba conductual ideal de que Sincronización está realmente activa.
const estadoFudo = env.post({ action: 'fudo_panel_estado', token: login.token });
assert.strictEqual(estadoFudo.ok, true, 'fudo_panel_estado debe estar activo');

// Los demás módulos continúan cerrados.
for (const action of ['conteo_listar', 'conteo_registrar', 'produccion_registrar', 'traslado_crear', 'catalogo_listar', 'caja_estado', 'conciliacion', 'fudo_api_sincronizar_stock', 'fudo_catalogo_sincronizar']) {
  const r = env.post({ action, token: login.token });
  assert.strictEqual(r.ok, false, `${action} debe estar bloqueada`);
  assert.strictEqual(r.codigo, 'MODULO_INACTIVO', `${action} debe responder MODULO_INACTIVO`);
}

// Los handlers automáticos siguen saliendo antes de tocar FUDO/alertas. La sincronización aprobada
// en esta fase es manual, desde el panel, y solo para ventas/pagos.
assert.strictEqual(env.ctx.fudoSincronizacionAutomatica_(), undefined);
assert.strictEqual(env.ctx.fudoSincronizacionStockDiaria_(), undefined);
assert.strictEqual(env.ctx.tareaDiaria_(), undefined);

console.log('✓ Reactivación: Usuarios + sincronización manual FUDO activos; resto bloqueado');
