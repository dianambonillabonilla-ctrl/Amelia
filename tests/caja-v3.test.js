const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'apps-script', 'Caja.gs'), 'utf8');
const html = fs.readFileSync(path.join(root, 'caja.html'), 'utf8');

new Function(src);

const ctx = {
  console,
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
  JSON,
  isFinite,
  formatearFecha_: v => String(v).slice(0, 10),
  normalizar_: v => String(v == null ? '' : v).toLowerCase(),
  fudoPagosTotalesSedeFecha_: () => ({ pagos_fudo_total: 300000, pagos_efectivo_esperado: 250000, pagos_fudo_cantidad: 4 }),
  fudoGastosArqueoTotalDia_: () => ({ total: 30000, cantidad: 1 })
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

ctx.cajaV3MovimientosTurno_ = () => [
  { tipo: 'Envío a caja fuerte', valor: 100000 },
  { tipo: 'Entrega administración desde caja', valor: 20000 },
  { tipo: 'Otro ingreso', valor: 10000 }
];

const calc = ctx.cajaV3Calculo_({ id: 'T1', base_inicial: 200000, caja_fuerte_inicial: 50000 }, '2026-08-22', 'Capri');
assert.strictEqual(calc.fudo.efectivo, 250000);
assert.strictEqual(calc.fudo.gastos_efectivo, 30000);
assert.strictEqual(calc.fudo.neto, 220000);
assert.strictEqual(calc.caja_operativa, 310000);
assert.strictEqual(calc.caja_fuerte, 150000);
assert.strictEqual(calc.total, 460000);

ctx.cajaV3Turnos_ = () => [];
let ref = ctx.cajaV3ReferenciaApertura_('2026-08-22', 'Capri');
assert.strictEqual(ref.es_inicio_cero, true);
assert.strictEqual(ref.total, 0);

ctx.cajaV3Turnos_ = () => [{
  id: 'AYER', version: 'CAJA_V3', fecha: '2026-08-21', sede: 'Capri', estado: 'Cerrado',
  base_siguiente: 180000, caja_fuerte_siguiente: 70000
}];
ref = ctx.cajaV3ReferenciaApertura_('2026-08-22', 'Capri');
assert.strictEqual(ref.es_inicio_cero, false);
assert.strictEqual(ref.caja_operativa, 180000);
assert.strictEqual(ref.caja_fuerte, 70000);
assert.strictEqual(ref.total, 250000);
assert.strictEqual(ref.fecha_anterior, '2026-08-21');

assert(html.includes('Debes recibir del turno anterior'));
assert(html.includes('Qué dice FUDO y qué dice DILANA'));
assert(html.includes('El cierre físico de hoy será exactamente lo que DILANA espere que reciba el siguiente turno'));
assert(html.includes("llamar('caja_cerrar'"));
assert(html.includes("llamar('caja_sincronizar_ahora'"));

console.log('✓ Caja V3: cadena física, FUDO neto y comparación Administrador OK');
