const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const FECHA = '2026-07-26';
const SEDE = 'San Antonio';

function nuevo() {
  const env = crearEntorno();
  env.fijarReloj('2026-07-26T18:00:00-05:00');
  env.ctx.configurarHojas();
  env.ctx.fudoGastosArqueoAsegurarEstructura_();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  const login = env.post({ action:'login', usuario:'diana', password:'contrasegura1' });
  assert.ok(login.ok);
  return { env, token:login.token };
}

function abrir(env, token, base) {
  const r = env.post({
    action:'caja_abrir', token,
    item:{ fecha:FECHA, sede:SEDE, base_inicial:base, caja_fuerte_inicial:0, observacion_apertura:'prueba' }
  });
  assert.ok(r.ok, JSON.stringify(r));
}

function gasto(env, datos) {
  env.agregar('Fudo_Gastos_Arqueo', [Object.assign({
    id_movimiento:'P:' + Math.random(), id_gasto:'1', fecha_pago:FECHA,
    momento_fudo:new env.ctx.Date(), monto:10000, cancelado:false, usa_arqueo:true,
    es_efectivo:true, metodo_pago:'Efectivo', metodo_tipo:'CASH', caja_fudo:'San Antonio',
    sede:SEDE, modelo:'payment', descripcion:'Prueba', primera_sincronizacion_en:new env.ctx.Date(),
    ultima_sincronizacion_en:new env.ctx.Date(), importado_por:'test'
  }, datos || {})]);
}

// 1) gasto en efectivo que impacta arqueo resta del cajón.
(function () {
  const { env, token } = nuevo();
  abrir(env, token, 100000);
  env.avanzarReloj(60 * 1000);
  gasto(env, { monto:20000 });
  const estado = env.post({ action:'caja_estado', token, fecha:FECHA, sede:SEDE });
  assert.ok(estado.ok);
  assert.equal(estado.movimientos_resumen.gastos_fudo_arqueo, 20000);
  assert.equal(estado.efectivo_esperado, 80000);
})();

// 2) tarjeta/transferencia no toca el efectivo físico.
(function () {
  const { env, token } = nuevo();
  abrir(env, token, 100000);
  env.avanzarReloj(60 * 1000);
  gasto(env, { monto:25000, es_efectivo:false, metodo_pago:'Tarjeta', metodo_tipo:'CARD' });
  const estado = env.post({ action:'caja_estado', token, fecha:FECHA, sede:SEDE });
  assert.equal(estado.movimientos_resumen.gastos_fudo_arqueo, 0);
  assert.equal(estado.efectivo_esperado, 100000);
})();

// 3) cancelado o fuera del arqueo no resta.
(function () {
  const { env, token } = nuevo();
  abrir(env, token, 100000);
  env.avanzarReloj(60 * 1000);
  gasto(env, { monto:10000, cancelado:true });
  gasto(env, { monto:12000, usa_arqueo:false });
  const estado = env.post({ action:'caja_estado', token, fecha:FECHA, sede:SEDE });
  assert.equal(estado.movimientos_resumen.gastos_fudo_arqueo, 0);
  assert.equal(estado.efectivo_esperado, 100000);
})();

// 4) gasto que ya existía antes de abrir DILANA no se vuelve a descontar: el conteo inicial ya lo absorbió.
(function () {
  const { env, token } = nuevo();
  gasto(env, { monto:30000, momento_fudo:new env.ctx.Date('2026-07-26T17:00:00-05:00'), primera_sincronizacion_en:new env.ctx.Date('2026-07-26T17:30:00-05:00') });
  abrir(env, token, 70000);
  const estado = env.post({ action:'caja_estado', token, fecha:FECHA, sede:SEDE });
  assert.equal(estado.movimientos_resumen.gastos_fudo_arqueo, 0);
  assert.equal(estado.efectivo_esperado, 70000);
})();

console.log('caja-fudo-gastos-arqueo: OK');
