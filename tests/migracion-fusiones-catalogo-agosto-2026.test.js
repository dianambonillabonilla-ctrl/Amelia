/**
 * fusionarDuplicadosCatalogoAgosto2026_ (MigracionFusionesCatalogoAgosto2026.gs): fusiona de verdad
 * los 7 pares de catálogo que la auditoría de ago 2026 encontró con evidencia dura (alias eclipsado
 * o fila marcada "Alias inactivo") — ver el comentario del archivo y CLAUDE.md para el detalle
 * completo de cómo se armó esta lista a partir de los datos reales.
 */
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

function env_() {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  return env;
}

function catalogoBase_() {
  return [
    { id: 'entera', nombre_estandar: 'Costilla San Luis Entera', nombre_fudo: 'Costilla San Luis', unidad_base: 'g' },
    { id: 'sanluis-dup', nombre_estandar: 'Costilla San Luis', unidad_base: 'g' },
    { id: 'cruda-dup', nombre_estandar: 'Costilla Cruda', unidad_base: 'g' },
    { id: 'panceta-entera', nombre_estandar: 'Panceta Entera', unidad_base: 'g' },
    { id: 'panceta-cruda-dup', nombre_estandar: 'Panceta Cruda', unidad_base: 'g' },
    { id: 'cebolla-pluma', nombre_estandar: 'Cebolla Pluma', unidad_base: 'g' },
    { id: 'cebollita-amelia-dup', nombre_estandar: 'Cebollita de Amelia', unidad_base: 'g' },
    { id: 'cebolla-en-pluma-dup', nombre_estandar: 'Cebolla en Pluma (sin limon)', unidad_base: 'g' },
    { id: 'cebolla-elaborada-dup', nombre_estandar: 'Cebolla Elaborada', unidad_base: 'g' },
    { id: 'cebolla-roja', nombre_estandar: 'Cebolla Roja', unidad_base: 'g' },
    { id: 'cebolla-cruda-dup', nombre_estandar: 'cebolla cruda', unidad_base: 'g' }
  ];
}

// Estos alias ya existían en el catálogo real (parametrizacion_catalogo/unificacion_chanchostilla/
// unificacion_tres_cebollas) apuntando al producto correcto — el problema nunca fue que faltara el
// alias, sino que quedaba eclipsado por la fila duplicada. Sin sembrar estos alias aquí, el test no
// reproduciría el caso real (ver CLAUDE.md).
function aliasBase_() {
  return [
    { id: 'a1', catalogo_id: 'entera', alias: 'Costilla San Luis', origen: 'parametrizacion_catalogo' },
    { id: 'a2', catalogo_id: 'entera', alias: 'Costilla Cruda', origen: 'parametrizacion_catalogo' },
    { id: 'a3', catalogo_id: 'panceta-entera', alias: 'Panceta Cruda', origen: 'parametrizacion_catalogo' },
    { id: 'a4', catalogo_id: 'cebolla-pluma', alias: 'Cebollita de Amelia', origen: 'parametrizacion_catalogo' },
    { id: 'a5', catalogo_id: 'cebolla-roja', alias: 'cebolla cruda', origen: 'unificacion_chanchostilla' },
    { id: 'a6', catalogo_id: 'cebolla-pluma', alias: 'Cebolla Elaborada', origen: 'unificacion_chanchostilla' },
    { id: 'a7', catalogo_id: 'cebolla-pluma', alias: 'Cebolla en Pluma (sin limon)', origen: 'unificacion_tres_cebollas' }
  ];
}

(function fusionaLos7ParesConEvidenciaDura() {
  const env = env_();
  env.agregar('Catalogo_Maestro', catalogoBase_());
  env.agregar('Catalogo_Alias', aliasBase_());

  const r = env.ctx.fusionarDuplicadosCatalogoAgosto2026_();
  assert.strictEqual(r.fusionados, 7, 'debe fusionar los 7 pares: ' + JSON.stringify(r));
  assert.strictEqual(r.errores.length, 0, 'no debe reportar errores: ' + JSON.stringify(r.errores));

  const catalogo = env.ctx.leerTabla_(env.evaluar('SHEET_NAMES.CATALOGO'));
  assert.strictEqual(catalogo.length, 4, 'solo deben quedar los 4 productos reales, sin las filas duplicadas');
  const nombres = catalogo.map((c) => c.nombre_estandar).sort();
  assert.deepStrictEqual(nombres, ['Cebolla Pluma', 'Cebolla Roja', 'Costilla San Luis Entera', 'Panceta Entera']);

  const indice = env.ctx.indiceCatalogo_();
  assert.strictEqual(env.ctx.claveProducto_('Costilla San Luis', indice), env.ctx.normalizar_('Costilla San Luis Entera'));
  assert.strictEqual(env.ctx.claveProducto_('Costilla Cruda', indice), env.ctx.normalizar_('Costilla San Luis Entera'));
  assert.strictEqual(env.ctx.claveProducto_('Panceta Cruda', indice), env.ctx.normalizar_('Panceta Entera'));
  assert.strictEqual(env.ctx.claveProducto_('Cebollita de Amelia', indice), env.ctx.normalizar_('Cebolla Pluma'));
  assert.strictEqual(env.ctx.claveProducto_('cebolla cruda', indice), env.ctx.normalizar_('Cebolla Roja'));
  assert.strictEqual(env.ctx.claveProducto_('Cebolla en Pluma (sin limon)', indice), env.ctx.normalizar_('Cebolla Pluma'));
  assert.strictEqual(env.ctx.claveProducto_('Cebolla Elaborada', indice), env.ctx.normalizar_('Cebolla Pluma'));
  console.log('fusiona los 7 pares con evidencia dura: OK');
})();

(function esIdempotente() {
  const env = env_();
  env.agregar('Catalogo_Maestro', catalogoBase_());
  env.ctx.fusionarDuplicadosCatalogoAgosto2026_();
  const segunda = env.ctx.fusionarDuplicadosCatalogoAgosto2026_();
  assert.strictEqual(segunda.fusionados, 0, 'la segunda corrida no debe fusionar nada de nuevo');
  assert.strictEqual(segunda.ya_resueltos, 7);
  const catalogo = env.ctx.leerTabla_(env.evaluar('SHEET_NAMES.CATALOGO'));
  assert.strictEqual(catalogo.length, 4, 'no debe borrar ni duplicar nada en la segunda corrida');
  console.log('es idempotente: OK');
})();

(function reportaSiFaltaElProductoAConservar() {
  const env = env_();
  env.agregar('Catalogo_Maestro', [
    { id: 'sanluis-dup', nombre_estandar: 'Costilla San Luis', unidad_base: 'g' }
    // "Costilla San Luis Entera" no existe en este catálogo de prueba a propósito
  ]);
  const r = env.ctx.fusionarDuplicadosCatalogoAgosto2026_();
  assert.strictEqual(r.fusionados, 0);
  assert.ok(r.errores.some((e) => /No existe "Costilla San Luis Entera"/.test(e)), JSON.stringify(r.errores));
  const catalogo = env.ctx.leerTabla_(env.evaluar('SHEET_NAMES.CATALOGO'));
  assert.strictEqual(catalogo.length, 1, 'no debe borrar la fila duplicada si no pudo fusionarla de verdad');
  console.log('reporta si falta el producto a conservar: OK');
})();
