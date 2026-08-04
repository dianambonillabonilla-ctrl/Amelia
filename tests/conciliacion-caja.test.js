/**
 * CONCILIACIÓN CAJA → CAJA FUERTE (ConciliacionCaja.gs + cruce en BaseCaja.gs/CajaTurno.gs)
 *
 * Cubre el hueco real reportado: "se entrega dinero al administrador y se guarda en caja fuerte
 * pero todo debe de coincidir" — antes Caja_Turno/Caja_Movimientos (lo entregado de verdad) y
 * Base_Caja (lo anotado a mano como depositado) no se cruzaban entre sí.
 */
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const DIA1 = '2026-08-01';
const DIA2 = '2026-08-02';
const SEDE = 'San Antonio';
const OTRA_SEDE = 'Capri';

function nuevoEntornoConAdmin() {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  const login = env.post({ action: 'login', usuario: 'diana', password: 'contrasegura1' });
  assert.ok(login.ok, 'el administrador inicial debe poder entrar: ' + JSON.stringify(login));
  return { env, token: login.token, usuario: login.usuario };
}

function exigir(env, cuerpo, queHace) {
  const r = env.post(cuerpo);
  assert.ok(r.ok, `${queHace} debió funcionar, respondió: ${JSON.stringify(r).slice(0, 300)}`);
  return r;
}

// --- cajaEntregadoTotalDia_: suma entregas del turno + lo entregado al cerrar ----------------------

(function () {
  const { env, token } = nuevoEntornoConAdmin();
  const p = (cuerpo) => Object.assign({ token }, cuerpo);

  exigir(env, p({ action: 'caja_abrir', item: { fecha: DIA1, sede: SEDE, base_inicial: 50000 } }), 'abrir la caja');
  exigir(env, p({
    action: 'caja_movimiento_registrar',
    item: {
      fecha: DIA1, sede: SEDE, tipo: 'Entrega administrador', valor: 20000,
      persona_entrega: 'Juan (Caja)', persona_recibe: 'Diana (Administradora)', motivo: 'Entrega de medio turno'
    }
  }), 'registrar una entrega de medio turno');
  const cierre = exigir(env, p({
    action: 'caja_cerrar',
    item: { fecha: DIA1, sede: SEDE, efectivo_contado: 30000, base_siguiente: 50000, persona_recibe_cierre: 'Diana (Administradora)' }
  }), 'cerrar la caja');
  assert.equal(cierre.entrega_cierre, 30000 - 50000, 'entrega al cerrar = contado - base del día siguiente');

  const total = env.ctx.cajaEntregadoTotalDia_(DIA1, SEDE);
  assert.equal(total, 20000 + (30000 - 50000), 'el total entregado suma el movimiento de medio turno más la entrega de cierre (puede ser negativa)');
  console.log('cajaEntregadoTotalDia_ suma movimientos + entrega de cierre: OK');
})();

// --- base_caja_guardar cruza contra Caja_Turno y avisa cuando no coincide --------------------------

(function () {
  const { env, token } = nuevoEntornoConAdmin();
  const p = (cuerpo) => Object.assign({ token }, cuerpo);

  exigir(env, p({ action: 'caja_abrir', item: { fecha: DIA1, sede: SEDE, base_inicial: 50000 } }), 'abrir la caja');
  exigir(env, p({
    action: 'caja_movimiento_registrar',
    item: { fecha: DIA1, sede: SEDE, tipo: 'Entrega administrador', valor: 100000, persona_entrega: 'Juan', persona_recibe: 'Diana', motivo: 'Entrega' }
  }), 'registrar la entrega');
  exigir(env, p({ action: 'caja_cerrar', item: { fecha: DIA1, sede: SEDE, efectivo_contado: 50000, base_siguiente: 50000 } }), 'cerrar la caja');
  // Total realmente entregado ese día: 100000 (movimiento) + 0 (entrega de cierre, contado == base siguiente).
  assert.equal(env.ctx.cajaEntregadoTotalDia_(DIA1, SEDE), 100000);

  // Caja Fuerte digitada IGUAL a lo entregado -> sin diferencia, sin aviso de auditoría.
  const guardadoOk = exigir(env, p({
    action: 'base_caja_guardar',
    item: { fecha: DIA1, sede: SEDE, efectivo_fudo: 100000, caja_fuerte: 100000, efectivo_caja_menor: 50000, pendiente: 0, gastos: 0 }
  }), 'guardar Base de Caja con Caja Fuerte igual a lo entregado');
  assert.equal(guardadoOk.entregado_administrador_total, 100000);
  assert.equal(guardadoOk.diferencia_caja_fuerte, 0);
  const auditoriaOk = env.ctx.auditoriaListar_({ entidad_tipo: 'BaseCaja' })
    .filter((a) => a.accion === 'base_caja_fuerte_no_coincide');
  assert.equal(auditoriaOk.length, 0, 'no debe auditar cuando Caja Fuerte sí coincide con lo entregado');
  console.log('base_caja_guardar sin diferencia cuando Caja Fuerte coincide: OK');

  // Otro día: Caja Fuerte digitada DISTINTA a lo entregado -> diferencia y rastro en auditoría.
  exigir(env, p({ action: 'caja_abrir', item: { fecha: DIA2, sede: SEDE, base_inicial: 50000 } }), 'abrir la caja del día 2');
  exigir(env, p({
    action: 'caja_movimiento_registrar',
    item: { fecha: DIA2, sede: SEDE, tipo: 'Entrega administrador', valor: 80000, persona_entrega: 'Juan', persona_recibe: 'Diana', motivo: 'Entrega' }
  }), 'registrar la entrega del día 2');
  exigir(env, p({ action: 'caja_cerrar', item: { fecha: DIA2, sede: SEDE, efectivo_contado: 50000, base_siguiente: 50000 } }), 'cerrar la caja del día 2');

  const guardadoMal = exigir(env, p({
    action: 'base_caja_guardar',
    item: { fecha: DIA2, sede: SEDE, efectivo_fudo: 80000, caja_fuerte: 60000, efectivo_caja_menor: 50000, pendiente: 0, gastos: 0 }
  }), 'guardar Base de Caja con Caja Fuerte distinta a lo entregado');
  assert.equal(guardadoMal.entregado_administrador_total, 80000);
  assert.equal(guardadoMal.diferencia_caja_fuerte, -20000, 'faltan 20.000 por registrar en Caja Fuerte frente a lo entregado');
  const auditoriaMal = env.ctx.auditoriaListar_({ entidad_tipo: 'BaseCaja' })
    .filter((a) => a.accion === 'base_caja_fuerte_no_coincide' && a.entidad_id === DIA2 + '|' + SEDE);
  assert.equal(auditoriaMal.length, 1, 'debe dejar un evento de auditoría cuando Caja Fuerte no coincide');
  console.log('base_caja_guardar detecta y audita cuando Caja Fuerte no coincide: OK');
})();

// --- caja_conciliacion_listar: reporte cruzado, nunca mezcla sedes ----------------------------------

(function () {
  const { env, token } = nuevoEntornoConAdmin();
  const p = (cuerpo) => Object.assign({ token }, cuerpo);

  // San Antonio, día 1: cuadra exacto.
  exigir(env, p({ action: 'caja_abrir', item: { fecha: DIA1, sede: SEDE, base_inicial: 50000 } }), 'abrir SA');
  exigir(env, p({ action: 'caja_cerrar', item: { fecha: DIA1, sede: SEDE, efectivo_contado: 50000, base_siguiente: 50000, persona_recibe_cierre: 'Diana' } }), 'cerrar SA');
  exigir(env, p({ action: 'base_caja_guardar', item: { fecha: DIA1, sede: SEDE, efectivo_fudo: 0, caja_fuerte: 0, efectivo_caja_menor: 50000, pendiente: 0, gastos: 0 } }), 'guardar Base de Caja SA');

  // San Antonio, día 2: turno cerrado pero SIN registrar nunca en Base de Caja.
  exigir(env, p({ action: 'caja_abrir', item: { fecha: DIA2, sede: SEDE, base_inicial: 50000 } }), 'abrir SA día 2');
  exigir(env, p({ action: 'caja_cerrar', item: { fecha: DIA2, sede: SEDE, efectivo_contado: 60000, base_siguiente: 50000 } }), 'cerrar SA día 2');

  // Capri, día 1: NO debe mezclarse con los números de San Antonio.
  exigir(env, p({ action: 'caja_abrir', item: { fecha: DIA1, sede: OTRA_SEDE, base_inicial: 20000 } }), 'abrir Capri');
  exigir(env, p({ action: 'caja_cerrar', item: { fecha: DIA1, sede: OTRA_SEDE, efectivo_contado: 20000, base_siguiente: 20000 } }), 'cerrar Capri');
  exigir(env, p({ action: 'base_caja_guardar', item: { fecha: DIA1, sede: OTRA_SEDE, efectivo_fudo: 0, caja_fuerte: 999999, efectivo_caja_menor: 20000, pendiente: 0, gastos: 0 } }), 'guardar Base de Caja Capri (a propósito muy distinto)');

  const reporteSA = exigir(env, p({ action: 'caja_conciliacion_listar', filtros: { sede: SEDE } }), 'conciliar San Antonio');
  assert.equal(reporteSA.data.length, 2, 'debe listar los dos días cerrados de San Antonio, ninguno de Capri');
  assert.ok(reporteSA.data.every((f) => f.sede === SEDE), 'no debe traer filas de otra sede');

  const filaCuadra = reporteSA.data.find((f) => f.fecha === DIA1);
  assert.strictEqual(filaCuadra.cuadra, true);
  assert.strictEqual(filaCuadra.diferencia, 0);

  const filaSinRegistrar = reporteSA.data.find((f) => f.fecha === DIA2);
  assert.strictEqual(filaSinRegistrar.registrado_en_base_caja, false, 'el día 2 nunca se guardó en Base de Caja');
  assert.strictEqual(filaSinRegistrar.cuadra, null, 'sin registro en Base de Caja no se puede decir si cuadra o no');
  assert.equal(filaSinRegistrar.entregado_administrador_total, 60000 - 50000, 'lo entregado ese día es la entrega de cierre (60000 contado - 50000 base siguiente)');

  assert.equal(reporteSA.resumen.dias, 2);
  assert.equal(reporteSA.resumen.cuadran, 1);
  assert.equal(reporteSA.resumen.sin_registrar, 1);
  console.log('caja_conciliacion_listar reporta por sede, sin mezclar San Antonio y Capri: OK');
})();

console.log('conciliacion-caja: OK');
