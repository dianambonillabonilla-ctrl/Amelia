const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const inicio = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'CajaInicioOperacion20260820.gs'), 'utf8');
const caja = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'ZZ_ReactivacionCajaFinal.gs'), 'utf8');

assert.match(inicio, /CAJA_FECHA_INICIO_OFICIAL_\s*=\s*'2026-08-20'/);
assert.match(inicio, /Caja_Turno_Archivo_Pre20260820/);
assert.match(inicio, /Caja_Movimientos_Archivo_Pre20260820/);
assert.match(inicio, /CAJA_INICIO_OPERACION_20260820_HECHA/);
assert.match(inicio, /cajaInicializarOperacionDesde20Agosto2026/);
assert.match(inicio, /cajaReferenciaFudoDiaAnterior_/);
assert.match(inicio, /CAJA_FUDO_ESTADO\|/);
assert.match(caja, /modo_referencia_inicial_fudo:true/);
assert.match(caja, /tipo_referencia_apertura:usaReferenciaInicial\?'FUDO_DIA_ANTERIOR':'CIERRE_DILANA'/);
assert.match(caja, /cajaGuardarEstadoFudoPersistente_/);

// La referencia inicial es TOTAL: efectivo FUDO del 19 menos gastos de arqueo en efectivo.
(function () {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  env.ctx.cajaGuardarEstadoFudoPersistente_('2026-08-19', 'San Antonio', { ok:true, aplica:true, sincronizado_en:new Date() });
  env.ctx.turnoResumenCierre_ = () => ({ pagos_efectivo_esperado:820000, pagos_fudo_total:900000, ventas_fudo_total:950000 });
  env.ctx.fudoGastosArqueoTotalDia_ = () => ({ total:120000, cantidad:2 });
  const ref = env.ctx.cajaReferenciaFudoDiaAnterior_('2026-08-20', 'San Antonio');
  assert.strictEqual(ref.fecha_referencia, '2026-08-19');
  assert.strictEqual(ref.efectivo_fudo, 820000);
  assert.strictEqual(ref.gastos_fudo_efectivo, 120000);
  assert.strictEqual(ref.referencia_total, 700000);
  assert.strictEqual(ref.confirmado, true);
})();

// En producción no se puede volver a abrir una Caja anterior al inicio oficial.
(function () {
  const env = crearEntorno({ reactivacionReal:true });
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  const login = env.post({ action:'login', usuario:'diana', password:'contrasegura1' });
  assert.ok(login.ok, JSON.stringify(login));
  env.fijarReloj('2026-08-20T16:00:00-05:00');
  const r = env.post({ token:login.token, action:'caja_abrir', item:{
    fecha:'2026-08-19', sede:'San Antonio', base_inicial:0, caja_fuerte_inicial:0, observacion_apertura:''
  }});
  assert.strictEqual(r.ok, false, JSON.stringify(r));
  assert.match(String(r.error), /20\/08\/2026|archivad/i);
})();

// No se puede operar Caja desde el 20/08 en adelante sin haber corrido
// cajaInicializarOperacionDesde20Agosto2026() primero (auditoría, ago 2026 — segunda ronda). Antes
// de este test, la bandera de esa función reutilizaba por accidente el mismo nombre de propiedad
// que cajaMigrarHistorico_ (CajaTurno.gs, una migración vieja sin relación) ya marcaba 'true' en la
// primera acción de Caja — el candado quedaba puesto en el código pero nunca bloqueaba nada de
// verdad porque la propiedad ya estaba en 'true' antes de que cajaAbrir_ llegara a revisarla.
(function () {
  const env = crearEntorno({ reactivacionReal:true });
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  const login = env.post({ action:'login', usuario:'diana', password:'contrasegura1' });
  assert.ok(login.ok, JSON.stringify(login));
  env.fijarReloj('2026-08-20T16:00:00-05:00');
  const sinMigrar = env.post({ token:login.token, action:'caja_abrir', item:{
    fecha:'2026-08-20', sede:'San Antonio', base_inicial:0, caja_fuerte_inicial:0, observacion_apertura:''
  }});
  assert.strictEqual(sinMigrar.ok, false, JSON.stringify(sinMigrar));
  assert.match(String(sinMigrar.error), /cajaInicializarOperacionDesde20Agosto2026/);
  assert.strictEqual(
    env.ctx.PropertiesService.getScriptProperties().getProperty('CAJA_INICIO_OPERACION_20260820_HECHA'),
    null,
    'cajaAsegurarEstructura_ (llamada al abrir) no debe dejar esta bandera puesta por sí sola'
  );

  env.ctx.cajaInicializarOperacionDesde20Agosto2026();
  const conMigracion = env.post({ token:login.token, action:'caja_abrir', item:{
    fecha:'2026-08-20', sede:'San Antonio', base_inicial:0, caja_fuerte_inicial:0, observacion_apertura:''
  }});
  assert.strictEqual(conMigracion.ok, true, JSON.stringify(conMigracion));
})();

// El Panel de Caja (caja_resumen_admin) debe traer la referencia de FUDO para una sede que
// TODAVÍA no abrió y no tiene ningún cierre DILANA anterior — Diana (ago 2026): "lo primero que
// debe ser es que aparezca cuánto dice FUDO que debo tener... el cierre del 19 en cada sede".
// Antes de este cambio, cajaResumenAdministrador_ solo traía cajaEstado_ tal cual, que en este
// caso da $0 sin ninguna referencia real adjunta.
(function () {
  const env = crearEntorno({ reactivacionReal: true });
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  const login = env.post({ action: 'login', usuario: 'diana', password: 'contrasegura1' });
  assert.ok(login.ok, JSON.stringify(login));
  env.fijarReloj('2026-08-20T09:00:00-05:00');
  env.ctx.cajaInicializarOperacionDesde20Agosto2026();
  env.ctx.cajaGuardarEstadoFudoPersistente_('2026-08-19', 'San Antonio', { ok: true, aplica: true, sincronizado_en: new Date() });
  env.ctx.turnoResumenCierre_ = () => ({ pagos_efectivo_esperado: 820000, pagos_fudo_total: 900000, ventas_fudo_total: 950000 });
  env.ctx.fudoGastosArqueoTotalDia_ = () => ({ total: 120000, cantidad: 2 });

  const r = env.post({ token: login.token, action: 'caja_resumen_admin', fecha: '2026-08-20' });
  assert.ok(r.ok, JSON.stringify(r));
  const sa = r.sedes.find((s) => s.sede === 'San Antonio');
  assert.ok(sa, 'debe traer la fila de San Antonio');
  assert.strictEqual(sa.abierta, false);
  assert.ok(sa.conciliacion_apertura, 'una sede sin abrir y sin cierre DILANA debe traer conciliacion_apertura');
  assert.strictEqual(sa.conciliacion_apertura.modo_referencia_inicial_fudo, true);
  assert.strictEqual(sa.conciliacion_apertura.fecha_referencia, '2026-08-19');
  assert.strictEqual(sa.conciliacion_apertura.custodia_esperada_hoy.total, 700000, 'referencia total = efectivo FUDO del 19 menos gastos de arqueo (820.000 - 120.000)');
})();

console.log('caja-inicio-20260820: OK');
