const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const SEDE = 'San Antonio';
const DIA1 = '2026-08-18';
const DIA2 = '2026-08-19';

function preparar() {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  const login = env.post({ action:'login', usuario:'diana', password:'contrasegura1' });
  assert.ok(login.ok);
  return { env, token:login.token };
}

function ok(env, body) {
  const r = env.post(body);
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}

function falla(env, body) {
  const r = env.post(body);
  assert.strictEqual(r.ok, false, JSON.stringify(r));
  return r;
}

// Cerrar un turno deja una custodia conocida: $40.000 en caja + $60.000 en caja fuerte.
(function () {
  const { env, token } = preparar();
  env.fijarReloj('2026-08-18T17:00:00-05:00');
  const p = body => Object.assign({ token }, body);

  ok(env, p({ action:'caja_abrir', item:{
    fecha:DIA1, sede:SEDE, base_inicial:40000, caja_fuerte_inicial:60000,
    observacion_apertura:'base inicial de prueba'
  }}));

  env.avanzarReloj(60 * 60 * 1000);
  ok(env, p({ action:'caja_cerrar', item:{
    fecha:DIA1, sede:SEDE, efectivo_contado:40000, caja_fuerte_contada:60000,
    base_siguiente:40000
  }}));

  // Después del cierre sí puede entregarse dinero y queda marcado como fuera de turno.
  env.avanzarReloj(10 * 60 * 1000);
  const entrega = ok(env, p({ action:'caja_movimiento_registrar', item:{
    fecha:DIA1, sede:SEDE, tipo:'Entrega administrador desde caja fuerte', valor:20000,
    persona_entrega:'Caja San Antonio', persona_recibe:'Diana', motivo:'Entrega después del cierre',
    idempotency_key:'post-cierre-1'
  }}));
  assert.strictEqual(entrega.fuera_de_turno, true);
  assert.strictEqual(entrega.saldo_validado, true);
  assert.strictEqual(entrega.saldo_origen_antes, 60000);

  // No puede entregar más de la caja fuerte que DILANA conoce bajo custodia.
  const exceso = falla(env, p({ action:'caja_movimiento_registrar', item:{
    fecha:DIA1, sede:SEDE, tipo:'Entrega administrador desde caja fuerte', valor:50000,
    persona_entrega:'Caja San Antonio', persona_recibe:'Diana', motivo:'Debe exceder saldo',
    idempotency_key:'post-cierre-exceso'
  }}));
  assert.ok(String(exceso.error).includes('excede'));

  // Al día siguiente, la apertura esperada ya refleja la salida post-cierre: fuerte 60k -> 40k.
  env.fijarReloj('2026-08-19T16:00:00-05:00');
  const estado = ok(env, p({ action:'caja_estado', fecha:DIA2, sede:SEDE }));
  assert.strictEqual(estado.base_esperada, 40000);
  assert.strictEqual(estado.caja_fuerte_esperada, 40000);

  // La entrega post-cierre no modifica retrospectivamente el cierre ni se interpreta como cambio FUDO.
  const cerrado = ok(env, p({ action:'caja_estado', fecha:DIA1, sede:SEDE }));
  assert.strictEqual(cerrado.apertura.efectivo_esperado, 40000);
  assert.strictEqual(cerrado.apertura.caja_fuerte_esperada, 60000);
  assert.strictEqual(cerrado.fudo_cambio_tras_cierre, null);
})();

// Una entrega antes de abrir se absorbe en el conteo/apertura y NO vuelve a descontarse durante el turno.
(function () {
  const { env, token } = preparar();
  const p = body => Object.assign({ token }, body);
  env.fijarReloj('2026-08-18T17:00:00-05:00');

  ok(env, p({ action:'caja_abrir', item:{
    fecha:DIA1, sede:SEDE, base_inicial:50000, caja_fuerte_inicial:0,
    observacion_apertura:'base de prueba'
  }}));
  env.avanzarReloj(60 * 60 * 1000);
  ok(env, p({ action:'caja_cerrar', item:{
    fecha:DIA1, sede:SEDE, efectivo_contado:50000, caja_fuerte_contada:0,
    base_siguiente:50000
  }}));

  env.fijarReloj('2026-08-19T15:00:00-05:00');
  const pre = ok(env, p({ action:'caja_movimiento_registrar', item:{
    fecha:DIA2, sede:SEDE, tipo:'Entrega administrador desde caja', valor:10000,
    persona_entrega:'Caja San Antonio', persona_recibe:'Diana', motivo:'Entrega antes de abrir',
    idempotency_key:'pre-apertura-1'
  }}));
  assert.strictEqual(pre.fuera_de_turno, true);
  assert.strictEqual(pre.saldo_origen_antes, 50000);

  const antes = ok(env, p({ action:'caja_estado', fecha:DIA2, sede:SEDE }));
  assert.strictEqual(antes.base_esperada, 40000);

  env.avanzarReloj(10 * 60 * 1000);
  ok(env, p({ action:'caja_abrir', item:{
    fecha:DIA2, sede:SEDE, base_inicial:40000, caja_fuerte_inicial:0
  }}));

  const abierta = ok(env, p({ action:'caja_estado', fecha:DIA2, sede:SEDE }));
  assert.strictEqual(abierta.efectivo_esperado, 40000, 'la entrega pre-apertura no debe descontarse dos veces');
  assert.strictEqual(abierta.movimientos_resumen.entregas_administrador, 0, 'no pertenece a la ventana operativa del turno');
})();

console.log('caja-entregas-fuera-turno: OK');
