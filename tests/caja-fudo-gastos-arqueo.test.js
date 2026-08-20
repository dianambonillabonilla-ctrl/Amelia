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

(function () {
  const { env, token } = nuevo();
  abrir(env, token, 100000);
  env.avanzarReloj(60 * 1000);
  gasto(env, { monto:25000, es_efectivo:false, metodo_pago:'Tarjeta', metodo_tipo:'CARD' });
  const estado = env.post({ action:'caja_estado', token, fecha:FECHA, sede:SEDE });
  assert.equal(estado.movimientos_resumen.gastos_fudo_arqueo, 0);
  assert.equal(estado.efectivo_esperado, 100000);
})();

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

(function () {
  const { env, token } = nuevo();
  gasto(env, { monto:30000, momento_fudo:new env.ctx.Date('2026-07-26T17:00:00-05:00'), primera_sincronizacion_en:new env.ctx.Date('2026-07-26T17:30:00-05:00') });
  abrir(env, token, 70000);
  const estado = env.post({ action:'caja_estado', token, fecha:FECHA, sede:SEDE });
  assert.equal(estado.movimientos_resumen.gastos_fudo_arqueo, 0);
  assert.equal(estado.efectivo_esperado, 70000);
})();

// Parser real de /expenses: cashRegister no basta; Expense.useInCashCount debe ser true.
(function () {
  const { env } = nuevo();
  const incluidos = {
    'Payment:90': {
      type:'Payment', id:'90',
      // 18:30 -05 sigue siendo 26-jul en el mock UTC de Utilities.formatDate; evita que la prueba
      // dependa del huso horario del runner de GitHub Actions.
      attributes:{ amount:20000, paid_at:'2026-07-26T18:30:00-05:00', canceled:false },
      relationships:{
        paymentMethod:{ data:{ type:'PaymentMethod', id:'1' } },
        cashRegister:{ data:{ type:'CashRegister', id:'10' } }
      }
    },
    'PaymentMethod:1': { type:'PaymentMethod', id:'1', attributes:{ name:'Efectivo', code:'CASH' } },
    'CashRegister:10': { type:'CashRegister', id:'10', attributes:{ name:'San Antonio' } }
  };
  function expense(useInCashCount) {
    return {
      type:'Expense', id:useInCashCount ? '1' : '2',
      attributes:{ amount:20000, date:FECHA, useInCashCount:useInCashCount, canceled:false },
      relationships:{ payments:{ data:[{ type:'Payment', id:'90' }] } }
    };
  }
  const si = env.ctx.fudoGastosArqueoFilasDesdeExpense_(expense(true), incluidos, FECHA, FECHA);
  const no = env.ctx.fudoGastosArqueoFilasDesdeExpense_(expense(false), incluidos, FECHA, FECHA);
  assert.equal(si.length, 1);
  assert.equal(si[0].usa_arqueo, true, 'gasto marcado Usar en arqueo sí debe impactar');
  assert.equal(si[0].es_efectivo, true);
  assert.equal(no.length, 1);
  assert.equal(no[0].usa_arqueo, false, 'tener cashRegister no debe sustituir useInCashCount=false');
})();

console.log('caja-fudo-gastos-arqueo: OK');
