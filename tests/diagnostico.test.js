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

// --- diagnosticarComprasNoSuman_ ----------------------------------------------------------------

const catalogo = [{ nombre_estandar: 'Limón Tahití' }, { nombre_estandar: 'Costilla cruda' }];
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

console.log('diagnosticarComprasNoSuman_: OK');

// --- diagnosticarCatalogoDuplicados_ -------------------------------------------------------------

const catalogoConDuplicados = [
  { nombre_estandar: 'Limón' }, { nombre_estandar: 'Limón Tahití' }, // una es la otra con palabra de más
  { nombre_estandar: 'Costilla cruda' }, { nombre_estandar: 'Costilla curda' }, // typo, distancia de edición 1
  { nombre_estandar: 'Papa' }, { nombre_estandar: 'Queso' } // no relacionados, no deben marcarse
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

console.log('diagnosticarCatalogoDuplicados_: OK');
