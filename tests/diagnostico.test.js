const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

function normalizarMock_(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

function aUnidadBaseMock_(cantidad, unidad) {
  const u = normalizarMock_(unidad);
  const n = Number(cantidad) || 0;
  if (u === 'kg') return { cantidad: n * 1000, unidad: 'g' };
  if (u === 'l') return { cantidad: n * 1000, unidad: 'ml' };
  return { cantidad: n, unidad: u };
}

function indiceMock_(catalogo) {
  const indice = {};
  catalogo.forEach((c) => { if (c.nombre_estandar) indice[normalizarMock_(c.nombre_estandar)] = c.nombre_estandar; });
  return indice;
}

function claveProductoMock_(texto, indice) {
  const norm = normalizarMock_(texto);
  const canonico = indice && indice[norm];
  return canonico ? normalizarMock_(canonico) : norm;
}

function normalizarUnidadMock_(u) {
  return normalizarMock_(u).replace(/\./g, '');
}

// --- diagnosticarComprasNoSuman_ ----------------------------------------------------------------

const catalogo = [{ id: 'id-limon', nombre_estandar: 'Limón Tahití' }, { id: 'id-costilla', nombre_estandar: 'Costilla cruda' }];
const conteos = [
  // Limón Tahití en San Antonio: último conteo del 2026-07-10, en unidades ("u").
  { fecha: '2026-07-10', sede: 'San Antonio', producto: 'Limón Tahití', cantidad: 30, unidad: 'u' },
  // Costilla cruda en Capri: último conteo del 2026-07-05, en gramos.
  { fecha: '2026-07-05', sede: 'Capri', producto: 'Costilla cruda', cantidad: 2000, unidad: 'g' }
];
const compras = [
  // Compra de Limón Tahití en kg (masa) mientras el conteo fue en unidades (piezas): unidad no combina, debe marcarse.
  { id: 'ajuste-f1', tipo: 'Compra cruda', fecha: '2026-07-15', sede: 'San Antonio', producto: 'Limón Tahití', cantidad: 50, unidad: 'kg', proveedor: 'Mercamío', numero_factura: 'F-1' },
  // Compra de Costilla cruda DESPUÉS del último conteo y en la misma unidad: sí debe sumar (sin problema).
  { tipo: 'Compra cruda', fecha: '2026-07-20', sede: 'Capri', producto: 'Costilla cruda', cantidad: 1, unidad: 'kg', proveedor: 'Mercamío', numero_factura: 'F-2' },
  // Compra con nombre que no existe en el catálogo: debe marcarse.
  { tipo: 'Compra cruda', fecha: '2026-07-21', sede: 'Capri', producto: 'Limones sueltos', cantidad: 5, unidad: 'kg', proveedor: 'Mercamío', numero_factura: 'F-3' },
  // Compra en la misma fecha que el último conteo de ese producto+sede: se asume ya incluida, debe marcarse.
  { tipo: 'Compra cruda', fecha: '2026-07-05', sede: 'Capri', producto: 'Costilla cruda', cantidad: 1, unidad: 'g', proveedor: 'Mercamío', numero_factura: 'F-4' }
];

const diagnostico = cargar('apps-script/Diagnostico.gs', {
  SHEET_NAMES: { AJUSTES_INVENTARIO: 'ajustes', CONTEOS: 'conteos', RECETAS: 'recetas', VENTAS_FUDO: 'ventas', CATALOGO: 'catalogo' },
  Logger: { log: () => {} },
  leerTabla_: (hoja) => hoja === 'ajustes' ? compras : hoja === 'conteos' ? conteos : hoja === 'catalogo' ? catalogo : [],
  indiceCatalogo_: () => indiceMock_(catalogo),
  claveProducto_: claveProductoMock_,
  normalizar_: normalizarMock_,
  normalizarUnidad_: normalizarUnidadMock_,
  aUnidadBase_: aUnidadBaseMock_,
  formatearFecha_: (v) => String(v).slice(0, 10)
});

const resultado = diagnostico.diagnosticarComprasNoSuman_();
assert.equal(resultado.total_compras, 4);
assert.equal(resultado.con_problema, 3, 'debe marcar exactamente 3 de las 4 compras como no sumadas');

const porFactura = {};
resultado.problemas.forEach((p) => { porFactura[p.numero_factura] = p; });
assert.ok(porFactura['F-1'], 'F-1 (kg contra un conteo en unidades) debe marcarse');
assert.match(porFactura['F-1'].motivo, /unidad distinta/i);
assert.ok(!porFactura['F-2'], 'F-2 (misma unidad, fecha posterior al conteo) NO debe marcarse');
assert.ok(porFactura['F-3'], 'F-3 (nombre que no existe en catálogo) debe marcarse');
assert.match(porFactura['F-3'].motivo, /no existe en el Catálogo Maestro/);
assert.ok(porFactura['F-4'], 'F-4 (fecha igual a la del último conteo) debe marcarse');
assert.match(porFactura['F-4'].motivo, /ese conteo ya la incluía/);

// Cada problema debe traer también una solución concreta Y opciones de un clic — pedido real:
// "necesito que me dé las opciones y finalmente yo decido qué hacer". Ningún caso se queda sin
// nada para elegir, ni siquiera unidad distinta / fecha ya cubierta (antes solo tenían texto).
assert.match(porFactura['F-1'].solucion, /elige abajo/i, 'F-1 debe remitir a las opciones, no solo explicar en texto');
assert.equal(porFactura['F-1'].accion.tipo, 'opciones');
assert.equal(porFactura['F-1'].accion.opciones.length, 2, 'F-1 (unidad distinta) debe traer las 2 opciones: corregir la compra, o ir a registrar el conteo');
assert.equal(porFactura['F-1'].accion.opciones[0].id, 'corregir_unidad');
assert.equal(porFactura['F-1'].accion.opciones[0].ajuste_id, 'ajuste-f1', 'la opción de corregir debe apuntar al id real de la compra');
assert.equal(porFactura['F-1'].accion.opciones[0].unidad_sugerida, 'u', 'debe sugerir la unidad del último conteo (base "u")');
assert.equal(porFactura['F-1'].accion.opciones[1].id, 'ir_a_conteo');

assert.match(porFactura['F-3'].solucion, /ningún producto parecido/, 'F-3 ("Limones sueltos", sin parecido real en el catálogo) debe sugerir crearlo');
assert.match(porFactura['F-3'].solucion, /Catálogo Maestro/, 'F-3 debe apuntar a dónde crearlo a mano si no se usa el botón');
assert.equal(porFactura['F-3'].accion.opciones.length, 1, 'F-3 sin parecido real solo debe traer la opción de crear');
assert.equal(porFactura['F-3'].accion.opciones[0].id, 'crear_producto');
assert.equal(porFactura['F-3'].accion.opciones[0].nombre, 'Limones sueltos');

assert.match(porFactura['F-4'].solucion, /2026-07-05/, 'F-4 debe mencionar la fecha del último conteo en la solución');
assert.equal(porFactura['F-4'].accion.opciones.length, 2, 'F-4 (fecha ya cubierta) debe traer las 2 opciones: confirmar, o ir a registrar el conteo');
assert.equal(porFactura['F-4'].accion.opciones[0].id, 'confirmar_incluida');
assert.equal(porFactura['F-4'].accion.opciones[1].id, 'ir_a_conteo');

// Con un nombre realmente parecido a uno del catálogo, la solución debe sugerir vincularlo como alias.
const comprasConAlias = compras.concat([
  { tipo: 'Compra cruda', fecha: '2026-07-22', sede: 'Capri', producto: 'Costilla curda', cantidad: 1, unidad: 'g', proveedor: 'Mercamío', numero_factura: 'F-5' }
]);
const diagnosticoAlias = cargar('apps-script/Diagnostico.gs', {
  SHEET_NAMES: { AJUSTES_INVENTARIO: 'ajustes', CONTEOS: 'conteos', RECETAS: 'recetas', VENTAS_FUDO: 'ventas', CATALOGO: 'catalogo' },
  Logger: { log: () => {} },
  leerTabla_: (hoja) => hoja === 'ajustes' ? comprasConAlias : hoja === 'conteos' ? conteos : hoja === 'catalogo' ? catalogo : [],
  indiceCatalogo_: () => indiceMock_(catalogo),
  claveProducto_: claveProductoMock_,
  normalizar_: normalizarMock_,
  normalizarUnidad_: normalizarUnidadMock_,
  aUnidadBase_: aUnidadBaseMock_,
  formatearFecha_: (v) => String(v).slice(0, 10)
});
const resultadoAlias = diagnosticoAlias.diagnosticarComprasNoSuman_();
const f5 = resultadoAlias.problemas.find((p) => p.numero_factura === 'F-5');
assert.ok(f5, 'F-5 ("Costilla curda", typo de "Costilla cruda") debe marcarse como fuera de catálogo');
assert.match(f5.solucion, /Costilla cruda/, 'F-5 debe sugerir el parecido real "Costilla cruda" del catálogo');
// Con un parecido encontrado, deben ofrecerse LAS DOS opciones (vincular Y crear aparte) — pedido
// real: "yo decido qué hacer", no que el diagnóstico elija solo cuál de las dos aplica.
assert.equal(f5.accion.opciones.length, 2, 'F-5 con un parecido encontrado debe traer las 2 opciones: vincular o crear aparte');
assert.equal(f5.accion.opciones[0].id, 'vincular_alias');
assert.equal(f5.accion.opciones[0].catalogo_id, 'id-costilla', 'la opción de vincular debe apuntar al id real de "Costilla cruda" en el catálogo');
assert.equal(f5.accion.opciones[0].alias, 'Costilla curda');
assert.equal(f5.accion.opciones[1].id, 'crear_producto');
assert.equal(f5.accion.opciones[1].nombre, 'Costilla curda');

console.log('diagnosticarComprasNoSuman_: OK');

// --- diagnosticarRecetas_ y diagnosticarRecetasSinCatalogo_ --------------------------------------

function recetaEstadoVigenteMock_(estado) {
  const excluidos = ['borrador', 'inactivo', 'archivado', 'pendiente', 'referencia'];
  return excluidos.indexOf(normalizarMock_(estado || 'activo')) === -1;
}

const catalogoRecetas = [
  { id: 'id-panceta', nombre_estandar: 'Panceta Pre-Ahumada' },
  { id: 'id-costilla-limpia', nombre_estandar: 'Costilla Limpia Marinada' },
  { id: 'id-sal-fina', nombre_estandar: 'Sal Marina Fina' }
];
const recetasMock = [
  // Archivada por la migración de julio 2026 (número corrupto de antes: se conserva, nunca se
  // borra) — NO debe contar como sospechosa ni escanearse para el chequeo de catálogo: un
  // 'archivado' nunca participa en Disponible Hoy, así que no puede ser la causa de nada.
  { producto: 'Chanchostilla', ingrediente: 'Costilla Preparada', cantidad: 1153846154, unidad: 'g', estado: 'archivado' },
  { producto: 'Cono Supremo', ingrediente: 'Panceta Pre-Ahumada', cantidad: 60, unidad: 'g', estado: 'activo' },
  // "Costilla Preparada" no está en el catálogo de prueba, pero SÍ es el producto de la receta de
  // abajo (una preparación intermedia con receta propia) — no debe marcarse sin catálogo.
  { producto: 'Cono Supremo', ingrediente: 'Costilla Preparada', cantidad: 70, unidad: 'g', estado: 'revisar' },
  { producto: 'Costilla Preparada', ingrediente: 'Costilla Limpia Marinada', cantidad: 7250, unidad: 'g', estado: 'activo', tipo: 'produccion' },
  // "Sal" no existe tal cual en el catálogo (solo "Sal Marina Fina") pero SÍ es parecido — debe
  // sugerir vincularlo como alias, además de la opción de crear uno nuevo.
  { producto: 'Aioli Preparado', ingrediente: 'Sal', cantidad: 10, unidad: 'g', estado: 'activo', tipo: 'produccion' },
  // Sin ningún parecido real en el catálogo — solo debe ofrecer crear.
  { producto: 'Aioli Preparado', ingrediente: 'Especias Secretas Amelia', cantidad: 5, unidad: 'g', estado: 'activo', tipo: 'produccion' },
  // Vigente y con una cantidad claramente ilógica — SÍ debe marcarse sospechosa (a diferencia de la archivada de arriba).
  { producto: 'Reducción Balsámica Preparada', ingrediente: 'Salsa de Costilla Nueva', cantidad: 99999999, unidad: 'g', estado: 'activo', tipo: 'produccion' },
  // 'pendiente': tampoco participa en el cálculo, no debe escanearse aunque su ingrediente no exista en catálogo.
  { producto: 'Waffle Bonitos', ingrediente: 'Salsa de mora', cantidad: 35, unidad: 'g', estado: 'pendiente' }
];

const diagnosticoRecetas = cargar('apps-script/Diagnostico.gs', {
  SHEET_NAMES: { RECETAS: 'recetas', CATALOGO: 'catalogo' },
  Logger: { log: () => {} },
  leerTabla_: (hoja) => hoja === 'recetas' ? recetasMock : hoja === 'catalogo' ? catalogoRecetas : [],
  indiceCatalogo_: () => indiceMock_(catalogoRecetas),
  normalizar_: normalizarMock_,
  normalizarUnidad_: normalizarUnidadMock_,
  recetaEstadoVigente_: recetaEstadoVigenteMock_
});

const resultadoRecetas = diagnosticoRecetas.diagnosticarRecetas_();
assert.equal(resultadoRecetas.total_filas, 6, 'total_filas debe contar solo las 6 líneas vigentes (activo/revisar), no las 2 archivada/pendiente');
assert.equal(resultadoRecetas.sospechosas.length, 1, 'debe marcar solo la línea vigente con cantidad ilógica, no la archivada con el número corrupto');
assert.equal(resultadoRecetas.sospechosas[0].producto, 'Reducción Balsámica Preparada');

const resultadoRecetasCatalogo = diagnosticoRecetas.diagnosticarRecetasSinCatalogo_();
assert.equal(resultadoRecetasCatalogo.total_lineas, 6);
assert.equal(resultadoRecetasCatalogo.con_problema, 3, 'debe marcar exactamente 3 ingredientes: Sal, Especias Secretas Amelia, Salsa de Costilla Nueva');
const porIngredienteReceta = {};
resultadoRecetasCatalogo.problemas.forEach((p) => { porIngredienteReceta[p.ingrediente] = p; });
assert.ok(!porIngredienteReceta['Panceta Pre-Ahumada'], 'un ingrediente que sí está en catálogo no debe marcarse');
assert.ok(!porIngredienteReceta['Costilla Preparada'], 'una preparación intermedia con receta propia no debe marcarse aunque no esté en catálogo');
assert.ok(!porIngredienteReceta['Salsa de mora'], 'un ingrediente de una receta \'pendiente\' (no vigente) no debe escanearse');

assert.ok(porIngredienteReceta['Sal'], '"Sal" debe marcarse (no coincide exacto con "Sal Marina Fina")');
assert.deepEqual(porIngredienteReceta['Sal'].recetas, ['Aioli Preparado']);
assert.equal(porIngredienteReceta['Sal'].accion.opciones.length, 2, '"Sal" tiene un parecido real — debe ofrecer vincular Y crear');
assert.equal(porIngredienteReceta['Sal'].accion.opciones[0].id, 'vincular_alias');
assert.equal(porIngredienteReceta['Sal'].accion.opciones[0].catalogo_nombre, 'Sal Marina Fina');

assert.ok(porIngredienteReceta['Especias Secretas Amelia'], 'un ingrediente sin parecido debe marcarse');
assert.equal(porIngredienteReceta['Especias Secretas Amelia'].accion.opciones.length, 1, 'sin parecido, solo debe ofrecer crear');
assert.equal(porIngredienteReceta['Especias Secretas Amelia'].accion.opciones[0].id, 'crear_producto');

assert.ok(porIngredienteReceta['Salsa de Costilla Nueva'], 'un ingrediente de una subreceta (tipo producción) también debe revisarse');

console.log('diagnosticarRecetas_ y diagnosticarRecetasSinCatalogo_: OK');

// --- diagnosticarCatalogoDuplicados_ -------------------------------------------------------------

const catalogoConDuplicados = [
  { id: 'id-limon', nombre_estandar: 'Limón' }, { id: 'id-limon-tahiti', nombre_estandar: 'Limón Tahití' }, // una es la otra con palabra de más
  { id: 'id-costilla-cruda', nombre_estandar: 'Costilla cruda' }, { id: 'id-costilla-curda', nombre_estandar: 'Costilla curda' }, // typo, distancia de edición 1
  { id: 'id-papa', nombre_estandar: 'Papa' }, { id: 'id-queso', nombre_estandar: 'Queso' } // no relacionados, no deben marcarse
];
const diagnosticoCatalogo = cargar('apps-script/Diagnostico.gs', {
  SHEET_NAMES: { CATALOGO: 'catalogo' },
  Logger: { log: () => {} },
  leerTabla_: () => catalogoConDuplicados,
  normalizar_: normalizarMock_
});
const dupResultado = diagnosticoCatalogo.diagnosticarCatalogoDuplicados_();
assert.equal(dupResultado.total_productos, 6);
const pares = dupResultado.sospechosos.map((s) => [s.a, s.b].sort().join(' / '));
assert.ok(pares.includes('Limón / Limón Tahití'), 'debe sugerir Limón / Limón Tahití como posible duplicado');
assert.ok(pares.includes('Costilla cruda / Costilla curda'), 'debe sugerir el typo Costilla cruda / Costilla curda');
assert.ok(!pares.some((p) => p.includes('Papa') || p.includes('Queso')), 'no debe marcar productos sin relación');

// Cada par sospechoso debe traer el id de los dos productos — sin eso diagnostico.html no puede
// ofrecer el botón "con cuál me quedo" para fusionarlos (catalogoFusionar_ en Catalogo.gs).
const parLimon = dupResultado.sospechosos.find((s) => [s.a, s.b].sort().join(' / ') === 'Limón / Limón Tahití');
assert.ok(parLimon.a_id && parLimon.b_id, 'el par Limón / Limón Tahití debe traer los ids de los dos productos');

console.log('diagnosticarCatalogoDuplicados_: OK');

// --- sonNombresParecidos_: pedido real "que busque bien nombres similares porque sí los tiene" ---
// (antes solo agarraba palabra de más AL FINAL o una distancia de edición muy corta — se perdía
// casos reales como un conector "de" de más EN MEDIO del nombre, o palabras en otro orden).
const parecidos_ = diagnosticoCatalogo.sonNombresParecidos_;
assert.ok(parecidos_('aceite girasol', 'aceite de girasol'), 'debe reconocer un conector "de" de más en medio del nombre');
assert.ok(parecidos_('aceite de girasol', 'aceite girasol'), 'debe funcionar sin importar el orden de los argumentos');
assert.ok(parecidos_('panela organica', 'panela'), 'debe seguir agarrando una palabra de más al final (caso que ya funcionaba)');
assert.ok(parecidos_('bolsas negras grandes', 'bolsas grandes negras'), 'debe reconocer las mismas palabras en otro orden');
assert.ok(!parecidos_('papa', 'queso'), 'productos sin ninguna relación real no deben marcarse parecidos');

console.log('sonNombresParecidos_: OK');
