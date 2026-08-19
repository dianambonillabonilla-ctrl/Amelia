const fs = require('fs');
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const code = fs.readFileSync('apps-script/Code.gs', 'utf8');
const extension = fs.readFileSync('apps-script/ZZ_ReactivacionFudo.gs', 'utf8');
const fudo = fs.readFileSync('apps-script/FudoApi.gs', 'utf8');
const config = fs.readFileSync('assets/config.js', 'utf8');
const cajaHtml = fs.readFileSync('caja.html', 'utf8');
const candado = code + '\n' + extension;

assert(code.includes('const MODO_REACTIVACION_BACKEND = true;'));
for (const action of [
  'login','logout','whoami','cambiar_password',
  'usuarios_listar','usuarios_guardar','usuario_resetear_password',
  'fudo_panel_estado','fudo_api_probar_conexion','fudo_api_sincronizar_ventas','fudo_api_sincronizar_pagos',
  'caja_estado','caja_abrir','caja_movimiento_registrar','caja_movimientos_listar','caja_cerrar','caja_sincronizar_ahora'
]) {
  assert(candado.includes(`'${action}'`), `Falta ${action} en el candado backend`);
}
assert(extension.includes('ACCIONES_CAJA_PERMITIDAS_REACTIVACION_'));
assert(extension.includes("Caja: 'Encargado'"));
assert(code.includes("codigo: 'MODULO_INACTIVO'"));
assert(code.indexOf('if (!accionPermitidaEnReactivacion_(action))') < code.indexOf("if (action === 'login')"), 'El bloqueo debe correr antes del router');

// Las automatizaciones generales siguen apagadas: Caja usa sincronización FUDO explícita.
assert(code.includes("Fase 0 activa: tareaDiaria_ omitida."));
assert(fudo.includes("Fase 0 activa: fudoSincronizacionAutomatica_ omitida."));
assert(fudo.includes("Fase 0 activa: fudoSincronizacionStockDiaria_ omitida."));

assert(config.includes("const MODULOS_ACTIVOS = ['usuarios', 'sincronizacion', 'caja'];"));
assert(config.includes("'caja.html'"));
assert(config.includes("texto: 'Caja', soloRol: ['Administrador','Caja']"));
assert(cajaHtml.includes("requerirRol_(['Administrador','Caja'])"));
assert(cajaHtml.includes('Nombre de quien recibe'));
assert(cajaHtml.includes("if (!recibe) return alert('Es obligatorio escribir el nombre de la persona que recibe el dinero.')"));

// Prueba conductual del candado en modo producción.
const env = crearEntorno({ reactivacionReal: true });
env.ctx.configurarHojas();
env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
const login = env.post({ action: 'login', usuario: 'diana', password: 'contrasegura1' });
assert.strictEqual(login.ok, true, 'login debe seguir activo');
assert.strictEqual(env.post({ action: 'usuarios_listar', token: login.token }).ok, true, 'Usuarios debe seguir activo');
assert.strictEqual(env.post({ action: 'fudo_panel_estado', token: login.token }).ok, true, 'FUDO debe seguir activo');

// Caja ya atraviesa el candado. Sin una caja abierta, caja_estado responde normalmente y no
// MODULO_INACTIVO; eso prueba que el router está habilitado sin crear movimientos artificiales.
const cajaEstado = env.post({ action: 'caja_estado', token: login.token, fecha: '2026-08-19', sede: 'San Antonio' });
assert.strictEqual(cajaEstado.ok, true, 'Caja debe estar activa');

// Todo lo demás continúa cerrado.
for (const action of ['conteo_listar', 'produccion_registrar', 'traslado_crear', 'catalogo_listar', 'conciliacion', 'fudo_api_sincronizar_stock', 'fudo_catalogo_sincronizar']) {
  const r = env.post({ action, token: login.token });
  assert.strictEqual(r.ok, false, `${action} debe estar bloqueada`);
  assert.strictEqual(r.codigo, 'MODULO_INACTIVO', `${action} debe responder MODULO_INACTIVO`);
}

assert.strictEqual(env.ctx.fudoSincronizacionAutomatica_(), undefined);
assert.strictEqual(env.ctx.fudoSincronizacionStockDiaria_(), undefined);
assert.strictEqual(env.ctx.tareaDiaria_(), undefined);

console.log('✓ Reactivación: Usuarios + FUDO + Caja activos; resto bloqueado');