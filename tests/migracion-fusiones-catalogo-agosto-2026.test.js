/**
 * fusionarDuplicadosCatalogoAgosto2026_ (MigracionFusionesCatalogoAgosto2026.gs): fusiona de verdad
 * los 10 pares de catálogo de la auditoría de ago 2026 — 7 con evidencia dura (alias eclipsado o
 * fila marcada "Alias inactivo") y 3 confirmados directamente por Diana (Falafel Preparado->Falafel,
 * Vino->Vino tinto, Salsa pie de limon->Salsa de pie de limón). Ver el comentario del archivo y
 * CLAUDE.md para el detalle completo de cómo se armó esta lista a partir de los datos reales.
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
    { id: 'cebolla-cruda-dup', nombre_estandar: 'cebolla cruda', unidad_base: 'g' },
    { id: 'falafel', nombre_estandar: 'Falafel', categoria: 'Elaborados/Preparaciones de Cocina', unidad_base: 'g' },
    { id: 'falafel-preparado-dup', nombre_estandar: 'Falafel Preparado', unidad_base: 'g' },
    { id: 'vino-tinto', nombre_estandar: 'Vino tinto', unidad_base: 'ml' },
    { id: 'vino-dup', nombre_estandar: 'Vino', unidad_base: 'g' },
    { id: 'salsa-limon', nombre_estandar: 'Salsa de pie de limón', categoria: 'Elaborados/Postres y Panadería', unidad_base: 'g' },
    { id: 'salsa-limon-dup', nombre_estandar: 'Salsa pie de limon', unidad_base: 'g' }
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

(function fusionaLos10ParesConfirmados() {
  const env = env_();
  env.agregar('Catalogo_Maestro', catalogoBase_());
  env.agregar('Catalogo_Alias', aliasBase_());

  const r = env.ctx.fusionarDuplicadosCatalogoAgosto2026_();
  assert.strictEqual(r.fusionados, 10, 'debe fusionar los 10 pares: ' + JSON.stringify(r));
  assert.strictEqual(r.errores.length, 0, 'no debe reportar errores: ' + JSON.stringify(r.errores));

  const catalogo = env.ctx.leerTabla_(env.evaluar('SHEET_NAMES.CATALOGO'));
  assert.strictEqual(catalogo.length, 7, 'solo deben quedar los 7 productos reales, sin las filas duplicadas');
  const nombres = catalogo.map((c) => c.nombre_estandar).sort();
  assert.deepStrictEqual(nombres, [
    'Cebolla Pluma', 'Cebolla Roja', 'Costilla San Luis Entera', 'Falafel',
    'Panceta Entera', 'Salsa de pie de limón', 'Vino tinto'
  ]);

  const indice = env.ctx.indiceCatalogo_();
  assert.strictEqual(env.ctx.claveProducto_('Costilla San Luis', indice), env.ctx.normalizar_('Costilla San Luis Entera'));
  assert.strictEqual(env.ctx.claveProducto_('Costilla Cruda', indice), env.ctx.normalizar_('Costilla San Luis Entera'));
  assert.strictEqual(env.ctx.claveProducto_('Panceta Cruda', indice), env.ctx.normalizar_('Panceta Entera'));
  assert.strictEqual(env.ctx.claveProducto_('Cebollita de Amelia', indice), env.ctx.normalizar_('Cebolla Pluma'));
  assert.strictEqual(env.ctx.claveProducto_('cebolla cruda', indice), env.ctx.normalizar_('Cebolla Roja'));
  assert.strictEqual(env.ctx.claveProducto_('Cebolla en Pluma (sin limon)', indice), env.ctx.normalizar_('Cebolla Pluma'));
  assert.strictEqual(env.ctx.claveProducto_('Cebolla Elaborada', indice), env.ctx.normalizar_('Cebolla Pluma'));
  // Estos 3 no tenían alias previo (eran duplicados por texto parecido, no por alias eclipsado) —
  // deben quedar resolubles igual gracias al alias que la migración crea al fusionar.
  assert.strictEqual(env.ctx.claveProducto_('Falafel Preparado', indice), env.ctx.normalizar_('Falafel'));
  assert.strictEqual(env.ctx.claveProducto_('Vino', indice), env.ctx.normalizar_('Vino tinto'));
  assert.strictEqual(env.ctx.claveProducto_('Salsa pie de limon', indice), env.ctx.normalizar_('Salsa de pie de limón'));
  console.log('fusiona los 10 pares confirmados: OK');
})();

(function esIdempotente() {
  const env = env_();
  env.agregar('Catalogo_Maestro', catalogoBase_());
  env.agregar('Catalogo_Alias', aliasBase_());
  env.ctx.fusionarDuplicadosCatalogoAgosto2026_();
  const segunda = env.ctx.fusionarDuplicadosCatalogoAgosto2026_();
  assert.strictEqual(segunda.fusionados, 0, 'la segunda corrida no debe fusionar nada de nuevo');
  assert.strictEqual(segunda.ya_resueltos, 10);
  const catalogo = env.ctx.leerTabla_(env.evaluar('SHEET_NAMES.CATALOGO'));
  assert.strictEqual(catalogo.length, 7, 'no debe borrar ni duplicar nada en la segunda corrida');
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
