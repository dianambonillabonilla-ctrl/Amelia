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
  { tipo: 'Compra cruda', fecha: '2026-07-15', sede: 'San Antonio', producto: 'Limón Tahití', cantidad: 50, unidad: 'kg', proveedor: 'Mercamío', numero_factura: 'F-1' },
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

// Cada problema debe traer también una solución concreta, no solo el diagnóstico del motivo.
assert.match(porFactura['F-1'].solucion, /conteo físico/i, 'F-1 debe sugerir resolver la unidad con un conteo físico');
assert.equal(porFactura['F-1'].accion.tipo, 'ninguna', 'F-1 (unidad distinta) no tiene una acción de un clic — es una decisión humana');
assert.match(porFactura['F-3'].solucion, /ningún producto parecido/, 'F-3 ("Limones sueltos", sin parecido real en el catálogo) debe sugerir crearlo');
assert.match(porFactura['F-3'].solucion, /Catálogo Maestro/, 'F-3 debe apuntar a dónde crearlo a mano si no se usa el botón');
assert.equal(porFactura['F-3'].accion.tipo, 'crear_producto', 'F-3 debe traer una acción "crear_producto" accionable, no solo texto');
assert.equal(porFactura['F-3'].accion.nombre, 'Limones sueltos');
assert.match(porFactura['F-4'].solucion, /fecha/i, 'F-4 debe explicar qué hacer con la fecha del conteo');
assert.equal(porFactura['F-4'].accion.tipo, 'ninguna', 'F-4 (fecha ya cubierta) no tiene una acción de un clic — es una decisión humana');

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
assert.match(f5.solucion, /nombre_fudo/, 'F-5 debe sugerir vincularlo como alias en vez de crear uno nuevo');
assert.equal(f5.accion.tipo, 'vincular_alias', 'F-5 debe traer una acción "vincular_alias" accionable con un clic');
assert.equal(f5.accion.catalogo_id, 'id-costilla', 'F-5 debe apuntar al id real de "Costilla cruda" en el catálogo');
assert.equal(f5.accion.alias, 'Costilla curda');

console.log('diagnosticarComprasNoSuman_: OK');

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
