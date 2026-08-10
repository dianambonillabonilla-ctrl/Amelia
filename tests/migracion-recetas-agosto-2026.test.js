/**
 * corregirRecetasConfirmadasAgosto2026_ (MigracionRecetasAgosto2026.gs): aplica las 2 respuestas que
 * Diana dio en chat (ago 2026) sobre líneas de receta que habían quedado en estado='revisar' desde
 * migrarRecetasJulio2026_ — ver el comentario del archivo para el detalle de cada una.
 */
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

function recetasBase_() {
  return [
    {
      id: 'r1', producto: 'Zumo Limón', ingrediente: 'Limón entero', cantidad: 3165, unidad: 'g',
      rendimiento_producto: 1000, unidad_rendimiento: 'g', tipo: 'produccion', version: 'julio_2026',
      sede: 'Ambas', estado: 'revisar', controla_disponibilidad: true,
      notas: 'Lote real pesado = rendimiento 31,60%. CONTRADICE la fórmula de Guía Producción (28,92%).'
    },
    {
      id: 'r2', producto: 'Costilla Limpia Marinada (con polvo)', ingrediente: 'Polvo para costilla (especias)',
      cantidad: 500, unidad: 'g', tipo: 'produccion', version: 'julio_2026', sede: 'Ambas',
      estado: 'revisar', controla_disponibilidad: false,
      notas: 'confirmar 500 g como definitivo.'
    },
    // línea de otra versión con el mismo producto/ingrediente — no debe tocarse (mismo resguardo que
    // migrarRecetasJulio2026_ ya usa para no pisar una fila de otro origen).
    {
      id: 'r3', producto: 'Zumo Limón', ingrediente: 'Limón entero', cantidad: 9999, unidad: 'g',
      rendimiento_producto: 1234, tipo: 'produccion', version: 'otra_version', sede: 'Ambas',
      estado: 'borrador', controla_disponibilidad: false, notas: 'no tocar'
    }
  ];
}

function env_() {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  return env;
}

(function aplicaLasDosCorreccionesConfirmadas() {
  const env = env_();
  env.agregar('Recetas', recetasBase_());

  const r = env.ctx.corregirRecetasConfirmadasAgosto2026_();
  assert.strictEqual(r.actualizadas, 2, 'debe actualizar las 2 líneas confirmadas: ' + JSON.stringify(r));
  assert.strictEqual(r.errores.length, 0, JSON.stringify(r.errores));

  const recetas = env.ctx.leerTabla_(env.evaluar('SHEET_NAMES.RECETAS'));
  const zumo = recetas.find((x) => x.id === 'r1');
  assert.strictEqual(Number(zumo.rendimiento_producto), 915, 'rendimiento_producto debe bajar a 915 (3165 x 28,92%)');
  assert.strictEqual(zumo.estado, 'activo');
  assert.strictEqual(Number(zumo.cantidad), 3165, 'la cantidad de limón pesada no debe tocarse');

  const costilla = recetas.find((x) => x.id === 'r2');
  assert.strictEqual(costilla.estado, 'activo');
  assert.strictEqual(Number(costilla.cantidad), 500, 'la cantidad ya confirmada por Rafa no cambia');
  assert.strictEqual(costilla.controla_disponibilidad, false, 'sigue sin proyectar producción: falta el rendimiento final del lote, eso no lo confirmó Diana');

  const otraVersion = recetas.find((x) => x.id === 'r3');
  assert.strictEqual(otraVersion.estado, 'borrador', 'una línea de otra versión no debe tocarse');
  assert.strictEqual(Number(otraVersion.rendimiento_producto), 1234);
  console.log('aplica las dos correcciones confirmadas: OK');
})();

(function esIdempotente() {
  const env = env_();
  env.agregar('Recetas', recetasBase_());
  env.ctx.corregirRecetasConfirmadasAgosto2026_();
  const segunda = env.ctx.corregirRecetasConfirmadasAgosto2026_();
  assert.strictEqual(segunda.actualizadas, 0, 'la segunda corrida no debe reescribir nada');
  assert.strictEqual(segunda.ya_estaban, 2);
  console.log('es idempotente: OK');
})();

(function reportaSiNoEncuentraLaLinea() {
  const env = env_();
  env.agregar('Recetas', [recetasBase_()[1]]); // solo la de Costilla, sin la de Zumo Limón
  const r = env.ctx.corregirRecetasConfirmadasAgosto2026_();
  assert.strictEqual(r.actualizadas, 1);
  assert.ok(r.errores.some((e) => /No se encontró "Zumo Limón"/.test(e)), JSON.stringify(r.errores));
  console.log('reporta si no encuentra la línea: OK');
})();
