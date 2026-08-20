const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const inicio = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'CajaInicioOperacion20260820.gs'), 'utf8');
const capa = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'ZZZ_CajaInicioOperacionFinal.gs'), 'utf8');

assert.match(inicio, /CAJA_FECHA_INICIO_OFICIAL_\s*=\s*'2026-08-20'/);
assert.match(inicio, /Caja_Turno_Archivo_Pre20260820/);
assert.match(inicio, /Caja_Movimientos_Archivo_Pre20260820/);
assert.match(inicio, /CAJA_MIGRACION_HISTORICA_HECHA/);
assert.match(inicio, /cajaInicializarOperacionDesde20Agosto2026/);
assert.match(inicio, /cajaReferenciaFudoDiaAnterior_/);
assert.match(capa, /modo_referencia_inicial_fudo:true/);
assert.match(capa, /tipo_referencia_apertura:usaReferenciaInicial\?'FUDO_DIA_ANTERIOR':'CIERRE_DILANA'/);
assert.match(capa, /CAJA_FUDO_ESTADO\|/);

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

console.log('caja-inicio-20260820: OK');
