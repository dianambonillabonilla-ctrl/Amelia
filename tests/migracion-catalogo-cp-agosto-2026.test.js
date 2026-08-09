/**
 * migrarCatalogoCPAgosto2026_ (MigracionCatalogoAgosto2026.gs): crea los alias que faltaban para
 * los nombres de materia prima de Centro de Producción que aparecían sueltos en Producciones/
 * Ajustes_Inventario sin resolver contra el catálogo (ver comentario del archivo para el detalle
 * completo de cómo se armó esta lista a partir de los datos reales).
 */
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

function env_() {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  return env;
}

(function creaLosAliasQueFaltabanContraElCatalogoReal() {
  const env = env_();
  env.agregar('Catalogo_Maestro', [
    { id: 'c1', nombre_estandar: 'Salsa Soya', unidad_base: 'g' },
    { id: 'c2', nombre_estandar: 'Ajo Preparado', unidad_base: 'g' },
    { id: 'c3', nombre_estandar: 'Panceta Entera', unidad_base: 'g' },
    { id: 'c4', nombre_estandar: 'Especias Falafel', unidad_base: 'g' },
    { id: 'c5', nombre_estandar: 'Especias de Marinar Costilla', unidad_base: 'g' },
    { id: 'c6', nombre_estandar: 'Especias Salsa Costilla', unidad_base: 'g' }
  ]);

  const r = env.ctx.migrarCatalogoCPAgosto2026_();
  assert.strictEqual(r.creados, 10, 'debe crear los 10 alias del mapeo: ' + JSON.stringify(r));
  assert.strictEqual(r.errores.length, 0);

  const alias = env.ctx.leerTabla_(env.evaluar('SHEET_NAMES.CATALOGO_ALIAS'));
  const indice = env.ctx.indiceCatalogo_();
  assert.strictEqual(env.ctx.claveProducto_('polvo de la falafel', indice), env.ctx.normalizar_('Especias Falafel'));
  assert.strictEqual(env.ctx.claveProducto_('polvos falafel', indice), env.ctx.normalizar_('Especias Falafel'));
  assert.strictEqual(env.ctx.claveProducto_('polvo marinar costilla', indice), env.ctx.normalizar_('Especias de Marinar Costilla'));
  assert.strictEqual(env.ctx.claveProducto_('polvo para reduccion costilla', indice), env.ctx.normalizar_('Especias Salsa Costilla'));
  assert.strictEqual(env.ctx.claveProducto_('salsa de soya', indice), env.ctx.normalizar_('Salsa Soya'));
  assert.strictEqual(env.ctx.claveProducto_('pasta de ajo', indice), env.ctx.normalizar_('Ajo Preparado'));
  assert.strictEqual(env.ctx.claveProducto_('panceta', indice), env.ctx.normalizar_('Panceta Entera'));
  assert.strictEqual(alias.length, 10);
  console.log('crea los alias que faltaban contra el catálogo real: OK');
})();

(function esIdempotente() {
  const env = env_();
  env.agregar('Catalogo_Maestro', [
    { id: 'c1', nombre_estandar: 'Salsa Soya', unidad_base: 'g' },
    { id: 'c2', nombre_estandar: 'Ajo Preparado', unidad_base: 'g' },
    { id: 'c3', nombre_estandar: 'Panceta Entera', unidad_base: 'g' },
    { id: 'c4', nombre_estandar: 'Especias Falafel', unidad_base: 'g' },
    { id: 'c5', nombre_estandar: 'Especias de Marinar Costilla', unidad_base: 'g' },
    { id: 'c6', nombre_estandar: 'Especias Salsa Costilla', unidad_base: 'g' }
  ]);
  env.ctx.migrarCatalogoCPAgosto2026_();
  const segunda = env.ctx.migrarCatalogoCPAgosto2026_();
  assert.strictEqual(segunda.creados, 0, 'la segunda corrida no debe crear nada nuevo');
  assert.strictEqual(segunda.ya_existian, 10);
  const alias = env.ctx.leerTabla_(env.evaluar('SHEET_NAMES.CATALOGO_ALIAS'));
  assert.strictEqual(alias.length, 10, 'no debe duplicar filas de alias al correr dos veces');
  console.log('es idempotente: OK');
})();

(function reportaSiFaltaAlgunProductoDestinoEnElCatalogo() {
  const env = env_();
  env.agregar('Catalogo_Maestro', [
    { id: 'c1', nombre_estandar: 'Salsa Soya', unidad_base: 'g' }
    // el resto de los productos destino no existen en este catálogo de prueba a propósito
  ]);
  const r = env.ctx.migrarCatalogoCPAgosto2026_();
  assert.strictEqual(r.creados, 1);
  assert.strictEqual(r.errores.length, 9);
  assert.ok(r.errores.every(e => /No existe/.test(e)));
  console.log('reporta si falta algún producto destino en el catálogo: OK');
})();
