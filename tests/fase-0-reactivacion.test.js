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
assert(extension.includes("Caja:'Encargado'"));
assert(code.includes("codigo: 'MODULO_INACTIVO'"));
assert(code.indexOf('if (!accionPermitidaEnReactivacion_(action))') < code.indexOf("if (action === 'login')"), 'El bloqueo debe correr antes del router');

// Durante Caja se reactiva ÚNICAMENTE la sincronización financiera FUDO cada 15 minutos.
assert(extension.includes('function fudoSincronizacionCajaAutomatica_()'));
assert(extension.includes("newTrigger('fudoSincronizacionCajaAutomatica_').timeBased().everyMinutes(15).create()"));
assert(extension.includes("fudoApiSincronizarVentas_(fechaDesde, fechaHasta"));
assert(extension.includes("fudoApiSincronizarPagos_(fechaDesde, fechaHasta"));
assert(extension.includes("fn === 'tareaDiaria_'"));
assert(extension.includes("fn === 'fudoSincronizacionAutomatica_'"));
assert(fudo.includes("Fase 0 activa: fudoSincronizacionStockDiaria_ omitida."));

// Apertura conciliada: FUDO anterior + cierre DILANA anterior + movimientos posteriores + conteo físico.
assert(extension.includes('function cajaConciliacionApertura_('));
assert(extension.includes('function cajaMovimientosPosterioresAlCierre_('));
assert(extension.includes('function cajaCustodiaEsperadaTrasCierre_('));
assert(extension.includes('esperado_cierre_con_fudo_actual'));
assert(extension.includes('diferencia_fudo_dilana'));
assert(extension.includes('custodia_esperada_hoy'));
assert(extension.includes('conciliacion_apertura: conciliacionApertura'));
assert(cajaHtml.includes('Conciliación del cierre anterior'));
assert(cajaHtml.includes('Efectivo FUDO cierre anterior'));
assert(cajaHtml.includes('DILANA recalculado con FUDO actual'));
assert(cajaHtml.includes('Lo que DILANA espera encontrar hoy'));
assert(cajaHtml.includes('Conteo físico al llegar'));
assert(cajaHtml.includes('Diferencia física · Caja:'));

assert(config.includes("const MODULOS_ACTIVOS = ['usuarios', 'sincronizacion', 'caja'];"));
assert(config.includes("'caja.html'"));
assert(config.includes("texto: 'Caja', soloRol: ['Administrador','Caja']"));
assert(cajaHtml.includes("requerirRol_(['Administrador','Caja'])"));
assert(cajaHtml.includes('Nombre de quien recibe'));
assert(cajaHtml.includes("if(!recibe)return alert('Es obligatorio escribir el nombre de la persona que recibe el dinero.')"));

// Prueba conductual del candado en modo producción.
const env = crearEntorno({ reactivacionReal: true });
env.ctx.configurarHojas();
env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
const login = env.post({ action: 'login', usuario: 'diana', password: 'contrasegura1' });
assert.strictEqual(login.ok, true, 'login debe seguir activo');
assert.strictEqual(env.post({ action: 'usuarios_listar', token: login.token }).ok, true, 'Usuarios debe seguir activo');
assert.strictEqual(env.post({ action: 'fudo_panel_estado', token: login.token }).ok, true, 'FUDO debe seguir activo');

const cajaEstado = env.post({ action: 'caja_estado', token: login.token, fecha: '2026-08-19', sede: 'San Antonio' });
assert.strictEqual(cajaEstado.ok, true, 'Caja debe estar activa');

for (const action of ['conteo_listar', 'produccion_registrar', 'traslado_crear', 'catalogo_listar', 'conciliacion', 'fudo_api_sincronizar_stock', 'fudo_catalogo_sincronizar']) {
  const r = env.post({ action, token: login.token });
  assert.strictEqual(r.ok, false, `${action} debe estar bloqueada`);
  assert.strictEqual(r.codigo, 'MODULO_INACTIVO', `${action} debe responder MODULO_INACTIVO`);
}

const syncAuto = env.ctx.fudoSincronizacionCajaAutomatica_();
assert.strictEqual(syncAuto.ok, true);
assert.strictEqual(syncAuto.omitida, 'sin_credenciales');
const triggers = env.ctx.configurarTriggers();
assert.strictEqual(triggers.reactivacion, true);
assert.strictEqual(triggers.creados, 1);
assert.strictEqual(triggers.handler, 'fudoSincronizacionCajaAutomatica_');

assert.strictEqual(env.ctx.fudoSincronizacionStockDiaria_(), undefined);
assert.strictEqual(env.ctx.tareaDiaria_(), undefined);

console.log('✓ Reactivación: Caja concilia FUDO + DILANA + físico; FUDO financiero cada 15 min; resto bloqueado');
