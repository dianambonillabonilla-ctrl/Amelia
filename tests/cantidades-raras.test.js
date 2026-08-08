/**
 * CantidadesRaras.gs — detección de posibles errores de tecleo (aviso, nunca bloqueo). Diana
 * (ago 2026): pidió un "tope/aviso de cantidades raras" para que no se cuele, por ejemplo,
 * "5.000 kg" de algo por error de tecleo sin que nadie lo confirme antes de guardarlo.
 */
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function cargarContexto() {
  const ctx = { console, Math, Number, isNaN, isFinite };
  vm.createContext(ctx);
  ['Recetas.gs', 'CantidadesRaras.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx, { filename: f });
  });
  // normalizarUnidad_/normalizar_ viven en Code.gs; se simulan mínimo para no cargar el archivo completo.
  ctx.normalizarUnidad_ = (u) => String(u || '').trim().toLowerCase();
  ctx.normalizar_ = (s) => String(s || '').trim().toLowerCase();
  return ctx;
}

(function sinHistorialSuficienteNoAvisa() {
  const ctx = cargarContexto();
  assert.strictEqual(ctx.cantidadEsRara_([], 50000), null);
  assert.strictEqual(ctx.cantidadEsRara_([500, 480], 50000), null, 'con menos de 3 registros no hay con qué comparar');
  console.log('sin historial suficiente no avisa: OK');
})();

(function avisaCuandoSuperaDiezVecesElMaximoHistorico() {
  const ctx = cargarContexto();
  const r = ctx.cantidadEsRara_([500, 480, 520], 6000);
  assert.ok(r, 'debe avisar: 6000 > 520*10');
  assert.strictEqual(r.referencia, 520);
  assert.strictEqual(r.veces, Number((6000 / 520).toFixed(1)));
  console.log('avisa cuando supera diez veces el máximo histórico: OK');
})();

(function noAvisaDentroDelRangoNormal() {
  const ctx = cargarContexto();
  assert.strictEqual(ctx.cantidadEsRara_([500, 480, 520], 900), null, '900 no es ni el doble del máximo histórico');
  assert.strictEqual(ctx.cantidadEsRara_([500, 480, 520], 5200), null, 'justo 10x no es "más de" 10x');
  console.log('no avisa dentro del rango normal: OK');
})();

(function historialCantidadesBaseConvierteYFiltraPorUnidad() {
  const ctx = cargarContexto();
  const filas = [
    { producto: 'Sal Marina Gruesa', cantidad: 0.5, unidad: 'kg' }, // -> 500 g
    { producto: 'Sal Marina Gruesa', cantidad: 480, unidad: 'g' },
    { producto: 'Sal Marina Gruesa', cantidad: 3, unidad: 'u' },    // otra unidad, no comparable, se ignora
    { producto: 'Otro Producto', cantidad: 99999, unidad: 'g' }     // otro producto, no debe mezclarse
  ];
  const historial = ctx.historialCantidadesBase_(filas, 'producto', 'cantidad', 'unidad', 'Sal Marina Gruesa', 'g');
  // [...historial] pasa los valores al Array del realm de este archivo — la vm de arriba usa su
  // propio Array interno, y deepStrictEqual distingue instancias de distinto realm aunque el
  // contenido sea idéntico.
  assert.deepStrictEqual([...historial].sort((a, b) => a - b), [480, 500]);
  console.log('historialCantidadesBase_ convierte a unidad base y filtra por producto/unidad: OK');
})();
