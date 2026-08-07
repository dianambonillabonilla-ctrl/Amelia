/**
 * CAJA — apertura, movimientos y cierre (CajaTurno.gs), de punta a punta por doPost.
 *
 * Cubre el hueco real que tenía Base_Caja: hoy el esperado debe cambiar de inmediato cuando se
 * entrega efectivo al administrador durante el turno, no aparecer como faltante al cerrar.
 */
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const HOY = '2026-07-26';
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

function exigirFalla(env, cuerpo, queHace) {
  const r = env.post(cuerpo);
  assert.strictEqual(r.ok, false, `${queHace} debió fallar, respondió: ${JSON.stringify(r).slice(0, 300)}`);
  return r;
}

/** Primera apertura del día: esperado = 0, así que cualquier base > 0 necesita observación de Admin. */
function itemAbrir(baseInicial, extras) {
  return Object.assign({
    fecha: HOY, sede: SEDE, base_inicial: baseInicial,
    observacion_apertura: baseInicial ? 'Base inicial de prueba' : ''
  }, extras || {});
}

// --- 1. Apertura obligatoria antes de registrar movimientos o cerrar ------------------------------

(function () {
  const { env, token } = nuevoEntornoConAdmin();
  const p = (cuerpo) => Object.assign({ token }, cuerpo);

  const estadoInicial = exigir(env, p({ action: 'caja_estado', fecha: HOY, sede: SEDE }), 'consultar el estado de la caja');
  assert.strictEqual(estadoInicial.abierta, false, 'sin apertura, la caja no debe figurar como abierta');

  exigirFalla(env, p({
    action: 'caja_movimiento_registrar',
    item: { fecha: HOY, sede: SEDE, tipo: 'Gasto', valor: 5000, motivo: 'Hielo' }
  }), 'registrar un movimiento sin haber abierto la caja');

  exigirFalla(env, p({
    action: 'caja_cerrar',
    item: { fecha: HOY, sede: SEDE, efectivo_contado: 100000 }
  }), 'cerrar una caja que nunca se abrió');

  const abrir = exigir(env, p({ action: 'caja_abrir', item: itemAbrir(50000) }), 'abrir la caja');
  assert.equal(abrir.item.base_inicial, 50000);
  assert.equal(abrir.item.estado, 'Abierto');

  // Abrir de nuevo el mismo día es idempotente, no crea una segunda apertura.
  const reabrir = exigir(env, p({ action: 'caja_abrir', item: itemAbrir(99999) }), 'reabrir el mismo día');
  assert.ok(reabrir.ya_abierta, 'la segunda apertura del mismo día debe reconocer que ya estaba abierta');
  assert.equal(reabrir.item.base_inicial, 50000, 'no debe pisar la base inicial original');
})();

// --- 2. El efectivo esperado baja de inmediato con cada movimiento, no solo al cerrar -------------

(function () {
  const { env, token } = nuevoEntornoConAdmin();
  const p = (cuerpo) => Object.assign({ token }, cuerpo);

  exigir(env, p({ action: 'caja_abrir', item: itemAbrir(50000) }), 'abrir la caja');
  const estadoSinMovimientos = exigir(env, p({ action: 'caja_estado', fecha: HOY, sede: SEDE }), 'ver el estado recién abierta');
  assert.equal(estadoSinMovimientos.efectivo_esperado, 50000, 'sin ventas ni movimientos, el esperado es solo la base inicial');

  exigirFalla(env, p({
    action: 'caja_movimiento_registrar',
    item: { fecha: HOY, sede: SEDE, tipo: 'Entrega administrador', valor: 20000, motivo: 'Entrega parcial' }
  }), 'registrar una entrega al administrador sin decir quién entrega y quién recibe');

  const entrega = exigir(env, p({
    action: 'caja_movimiento_registrar',
    item: {
      fecha: HOY, sede: SEDE, tipo: 'Entrega administrador', valor: 20000,
      persona_entrega: 'Juan (Caja)', persona_recibe: 'Diana (Administradora)', motivo: 'Entrega de medio turno'
    }
  }), 'registrar una entrega al administrador');
  assert.equal(entrega.item.tipo, 'Entrega administrador');

  exigir(env, p({
    action: 'caja_movimiento_registrar',
    item: { fecha: HOY, sede: SEDE, tipo: 'Gasto', valor: 8000, motivo: 'Compra de hielo' }
  }), 'registrar un gasto');

  exigir(env, p({
    action: 'caja_movimiento_registrar',
    item: { fecha: HOY, sede: SEDE, tipo: 'Otro ingreso', valor: 3000, motivo: 'Venta de bolsa de hielo sobrante' }
  }), 'registrar otro ingreso');

  // El esperado ya refleja los tres movimientos ANTES de cualquier cierre — esto es lo que antes
  // faltaba: una entrega al administrador ya no se ve como un faltante al cerrar.
  const estado = exigir(env, p({ action: 'caja_estado', fecha: HOY, sede: SEDE }), 'ver el estado con movimientos');
  assert.equal(estado.movimientos_resumen.entregas_administrador, 20000);
  assert.equal(estado.movimientos_resumen.gastos, 8000);
  assert.equal(estado.movimientos_resumen.otros_ingresos, 3000);
  assert.equal(estado.efectivo_esperado, 50000 - 20000 - 8000 + 3000, 'base - entregas - gastos + otros ingresos');

  const movimientos = exigir(env, p({ action: 'caja_movimientos_listar', fecha: HOY, sede: SEDE }), 'listar movimientos').data;
  assert.equal(movimientos.length, 3);
})();

// --- 3. Cierre: sobrante, faltante, entrega de cierre y base para el día siguiente -----------------

(function () {
  const { env, token } = nuevoEntornoConAdmin();
  const p = (cuerpo) => Object.assign({ token }, cuerpo);

  exigir(env, p({ action: 'caja_abrir', item: itemAbrir(50000) }), 'abrir la caja');
  exigir(env, p({
    action: 'caja_movimiento_registrar',
    item: {
      fecha: HOY, sede: SEDE, tipo: 'Entrega administrador', valor: 20000,
      persona_entrega: 'Juan (Caja)', persona_recibe: 'Diana (Administradora)', motivo: 'Entrega de medio turno'
    }
  }), 'registrar una entrega');

  // Esperado = 50000 (base) - 20000 (entrega) = 30000 (sin ventas de FUDO en la prueba).
  // La base siguiente no puede superar lo contado (evita que el día siguiente espere plata que no hay).
  exigirFalla(env, p({
    action: 'caja_cerrar',
    item: { fecha: HOY, sede: SEDE, efectivo_contado: 30000, base_siguiente: 50000 }
  }), 'cerrar dejando una base siguiente mayor al contado');

  const cierreExacto = exigir(env, p({
    action: 'caja_cerrar',
    item: { fecha: HOY, sede: SEDE, efectivo_contado: 30000, base_siguiente: 20000 }
  }), 'cerrar la caja contando exactamente lo esperado');
  assert.equal(cierreExacto.efectivo_esperado, 30000);
  assert.equal(cierreExacto.diferencia, 0, 'contar justo lo esperado no debe dejar ni sobrante ni faltante');
  assert.equal(cierreExacto.entrega_cierre, 10000, 'contado − base siguiente = lo que se entrega al cierre');
  assert.equal(cierreExacto.base_siguiente, 20000);

  // Cerrar de nuevo el mismo día no debe recalcular ni duplicar.
  const yaCerrado = exigir(env, p({
    action: 'caja_cerrar',
    item: { fecha: HOY, sede: SEDE, efectivo_contado: 999999 }
  }), 'cerrar una caja que ya estaba cerrada');
  assert.ok(yaCerrado.ya_cerrado, 'un segundo cierre del mismo día debe reconocer que ya estaba cerrado, no recalcular con otro valor');

  // Movimientos y apertura ya no deben aceptarse tras el cierre.
  exigirFalla(env, p({
    action: 'caja_movimiento_registrar',
    item: { fecha: HOY, sede: SEDE, tipo: 'Gasto', valor: 1000, motivo: 'tarde' }
  }), 'registrar un movimiento después de cerrado');
})();

(function () {
  const { env, token } = nuevoEntornoConAdmin();
  const p = (cuerpo) => Object.assign({ token }, cuerpo);

  exigir(env, p({ action: 'caja_abrir', item: itemAbrir(50000) }), 'abrir la caja');

  // Faltante: se contaron 45000 pero se esperaban 50000 (sin movimientos ni ventas).
  // base_siguiente debe caber en lo contado.
  const faltante = exigir(env, p({
    action: 'caja_cerrar',
    item: { fecha: HOY, sede: SEDE, efectivo_contado: 45000, base_siguiente: 45000, observacion: 'faltan 5.000' }
  }), 'cerrar con faltante');
  assert.equal(faltante.diferencia, -5000);
})();

// --- 4. Rappi: recordatorio simple guardado en la apertura de hoy ---------------------------------

(function () {
  const { env, token } = nuevoEntornoConAdmin();
  const p = (cuerpo) => Object.assign({ token }, cuerpo);

  exigirFalla(env, p({ action: 'caja_rappi_marcar', fecha: HOY, sede: SEDE }), 'marcar Rappi sin caja abierta');
  exigir(env, p({ action: 'caja_abrir', item: itemAbrir(50000) }), 'abrir la caja');
  exigir(env, p({ action: 'caja_rappi_marcar', fecha: HOY, sede: SEDE }), 'marcar Rappi encendido');
  const estado = exigir(env, p({ action: 'caja_estado', fecha: HOY, sede: SEDE }), 'ver el estado tras marcar Rappi');
  assert.equal(estado.apertura.rappi_encendido, true);
  assert.equal(estado.apertura.rappi_confirmado_por, 'Diana', 'debe guardar quién confirmó Rappi');
})();

// --- 5. Permisos: quién puede abrir/cerrar la caja de qué sede -------------------------------------
// Se llama la lógica de negocio directamente (mismo patrón que otras pruebas por módulo) para
// probar sedeEscrituraPermitida_/cajaPuedeCerrar_ con un usuario Cocina sin tener que dar de alta
// una cuenta completa vía login por password.

(function () {
  const { env } = nuevoEntornoConAdmin();
  const cajaAbrir_ = env.ctx.cajaAbrir_;
  const cajaCerrar_ = env.ctx.cajaCerrar_;
  const usuarioCocinaSA = { id: 'u-cocina', nombre: 'Juan', rol: 'Cocina', sede: SEDE };

  // Sin cierre previo el esperado es 0 — Cocina solo puede abrir si cuenta exactamente eso.
  const propiaSede = cajaAbrir_({ fecha: HOY, sede: SEDE, base_inicial: 0 }, usuarioCocinaSA);
  assert.ok(propiaSede.ok, 'Cocina de San Antonio debe poder abrir la caja de su propia sede');

  const otraSede = cajaAbrir_({ fecha: HOY, sede: OTRA_SEDE, base_inicial: 0 }, usuarioCocinaSA);
  assert.strictEqual(otraSede.ok, false, 'Cocina de San Antonio NO debe poder abrir la caja de Capri');

  // Sin sector "Caja" asignado hoy, Cocina no puede cerrar aunque haya abierto la caja.
  const cierreSinSector = cajaCerrar_({ fecha: HOY, sede: SEDE, efectivo_contado: 0 }, usuarioCocinaSA);
  assert.strictEqual(cierreSinSector.ok, false, 'sin el sector "Caja" asignado hoy, Cocina no debe poder cerrar la caja');

  env.ctx.turnoSectorElegir_(HOY, 'Caja', usuarioCocinaSA);
  const cierreConSector = cajaCerrar_({ fecha: HOY, sede: SEDE, efectivo_contado: 0 }, usuarioCocinaSA);
  assert.ok(cierreConSector.ok, 'con el sector "Caja" asignado hoy, sí debe poder cerrar la caja');
})();

console.log('caja-turno: OK');
