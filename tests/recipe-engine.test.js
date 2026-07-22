const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const ctx = { console };
vm.createContext(ctx);
['apps-script/Catalogo.gs', 'apps-script/Recetas.gs', 'apps-script/DisponibleHoy.gs'].forEach((file) => {
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
});

const rows = [
  ['Chanchostilla', 'Costilla Preparada', 115.3846154, 'plato', true],
  ['Chanchostilla', 'Panceta Pre-Ahumada', 123.2876712, 'plato', true],
  ['Chanchostilla', 'Papas Listas', 100, 'plato', true],
  ['Supremo', 'Costilla Preparada', 89.74358974, 'plato', true],
  ['Supremo', 'Panceta Pre-Ahumada', 82.19178082, 'plato', true],
  ['Supremo', 'Falafel', 68, 'plato', true],
  ['Supremo', 'Papas Listas', 100, 'plato', true],
  ['Costilla', 'Costilla Preparada', 230.7692308, 'plato', true],
  ['Costilla', 'Papas Listas', 100, 'plato', true],
  ['Panceta', 'Panceta Pre-Ahumada', 232.8767123, 'plato', true],
  ['Panceta', 'Papas Listas', 100, 'plato', true],
  ['Costilafel', 'Costilla Preparada', 115.3846154, 'plato', true],
  ['Costilafel', 'Falafel', 85, 'plato', true],
  ['Costilafel', 'Papas Listas', 100, 'plato', true],
  ['Chanchalafel', 'Panceta Pre-Ahumada', 123.2876712, 'plato', true],
  ['Chanchalafel', 'Falafel', 102, 'plato', true],
  ['Chanchalafel', 'Papas Listas', 100, 'plato', true]
].map(([producto, ingrediente, cantidad, tipo, controla_disponibilidad]) => ({
  producto, ingrediente, cantidad, unidad: 'g', tipo, controla_disponibilidad
}));

rows.push(
  { producto: 'Papas Listas', ingrediente: 'Papas Pre-Fritas', cantidad: 1.754386, unidad: 'g', rendimiento_producto: 1, unidad_rendimiento: 'g', tipo: 'produccion', controla_disponibilidad: true },
  { producto: 'Papas Listas', ingrediente: 'Ajo Preparado', cantidad: 0.02, unidad: 'g', rendimiento_producto: 1, unidad_rendimiento: 'g', tipo: 'produccion', controla_disponibilidad: false }
);

const map = ctx.construirRecetaMap_(rows, {});
const stock = {
  'costilla preparada': { cantidad: 3748, unidad: 'g' },
  'panceta pre-ahumada': { cantidad: 4500, unidad: 'g' },
  'papas pre-fritas': { cantidad: 600, unidad: 'g' },
  'ajo preparado': { cantidad: 0, unidad: 'g' },
  falafel: { cantidad: 0, unidad: 'g' }
};

function platos(producto) {
  return Math.floor(ctx.cantidadDisponibleDetallada_(ctx.normalizar_(producto), map, stock, {}, {}, {}).disponible);
}

assert.strictEqual(platos('Chanchostilla'), 3, 'Chanchostilla debe limitarse por Papas Pre-Fritas');
assert.strictEqual(platos('Costilla'), 3, 'Costilla debe limitarse por Papas Pre-Fritas');
assert.strictEqual(platos('Panceta'), 3, 'Panceta debe limitarse por Papas Pre-Fritas');
assert.strictEqual(platos('Supremo'), 0, 'Supremo requiere Falafel');
assert.strictEqual(platos('Costilafel'), 0, 'Costilafel requiere Falafel');
assert.strictEqual(platos('Chanchalafel'), 0, 'Chanchalafel requiere Falafel');

const waffleMap = ctx.construirRecetaMap_([
  { producto: 'Bolita de pandebono', ingrediente: 'Mezcla de pandebono', cantidad: 15, unidad: 'g', rendimiento_producto: 1, unidad_rendimiento: 'unidad', tipo: 'produccion' },
  { producto: 'Wafflebonitos', ingrediente: 'Bolita de pandebono', cantidad: 8, unidad: 'unidad', tipo: 'plato' },
  { producto: 'Porción salsa pie de limón', ingrediente: 'Salsa de pie de limón', cantidad: 35, unidad: 'g', tipo: 'plato' }
], {});
assert.strictEqual(Math.floor(ctx.cantidadDisponibleDetallada_('wafflebonitos', waffleMap, {
  'mezcla de pandebono': { cantidad: 3800, unidad: 'g' }
}, {}, {}, {}).disponible), 31);
assert.strictEqual(Math.floor(ctx.cantidadDisponibleDetallada_('porcion salsa pie de limon', waffleMap, {
  'salsa de pie de limon': { cantidad: 2195, unidad: 'g' }
}, {}, {}, {}).disponible), 62);

assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.aUnidadBase_(2.82, 'kg'))), { cantidad: 2820, unidad: 'g' });

// Un plato nunca se cuenta físicamente por sí mismo (se arma desde su receta). Si por error existe
// una fila de Conteos_Manuales con el mismo nombre exacto del plato, esa cantidad no debe sumarse
// directo a "disponible" — si no, el número de preparaciones posibles queda igual al conteo mal
// etiquetado en vez de reflejar el insumo real que limita la producción (aquí, Falafel Preparado en 0).
const falafelMap = ctx.construirRecetaMap_([
  { producto: 'Falafel', ingrediente: 'Falafel Preparado', cantidad: 187, unidad: 'g', tipo: 'plato', controla_disponibilidad: true }
], {});
assert.strictEqual(Math.floor(ctx.cantidadDisponibleDetallada_('falafel', falafelMap, {
  'falafel preparado': { cantidad: 0, unidad: 'g' },
  falafel: { cantidad: 1868, unidad: 'g' } // fila mal etiquetada: no debe usarse como si fuera platos listos
}, {}, {}, {}).disponible), 0, 'Falafel (plato) no debe inflarse con un conteo mal etiquetado bajo su propio nombre');

// "0 g" solo significa "confirmado agotado" si alguna vez se contó ese insumo. sin_dato distingue
// "nunca se ha registrado" (no hay ninguna fila en Conteos_Manuales/compras/traslados) de "sí se
// contó y dio cero" — para no mostrar un dato faltante como si fuera un agotamiento confirmado.
const detNuncaContado = ctx.cantidadDisponibleDetallada_('ingrediente fantasma', {}, {}, {}, {}, {});
assert.strictEqual(detNuncaContado.sin_dato, true, 'Sin ninguna fila de stock, sin_dato debe ser true');
const detContadoEnCero = ctx.cantidadDisponibleDetallada_('ajo preparado', {},
  { 'ajo preparado': { cantidad: 0, unidad: 'g' } }, {}, {}, {});
assert.strictEqual(detContadoEnCero.sin_dato, false, 'Contado y en cero, sin_dato debe ser false');

console.log('recipe-engine: OK');
