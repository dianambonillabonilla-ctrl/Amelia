const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

const comprasGuardadas = [];
const compras = cargar('apps-script/Compras.gs', {
  SHEET_NAMES: { COMPRAS_FACTURAS: 'facturas', COMPRAS_LINEAS: 'lineas' },
  Utilities: { getUuid: () => 'id-' + (comprasGuardadas.length + 1) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  validarItemInventario_: (item) => ({ ok: true, producto: item.producto, unidad: item.unidad }),
  normalizar_: (v) => String(v || '').trim().toLowerCase(),
  leerTabla_: (hoja) => hoja === 'facturas' ? comprasGuardadas : [],
  appendRowFromObj_: (hoja, fila) => { if (hoja === 'facturas') comprasGuardadas.push(fila); }
});

const factura = { fecha: '2026-07-21', proveedor: 'Mercamio', numero_factura: 'F-1', sede_ingreso: 'Centro de Producción', impuestos: 19, total: 119 };
const lineas = [{ producto: 'Costilla', unidad: 'kg', cantidad: 1, costo_unitario: 100 }];
assert.equal(compras.compraGuardar_(factura, lineas, { nombre: 'Diana' }).ok, true);
assert.equal(compras.compraGuardar_(factura, lineas, { nombre: 'Diana' }).ok, false, 'debe bloquear factura duplicada');
assert.equal(compras.compraGuardar_(Object.assign({}, factura, { numero_factura: 'F-2', total: 120 }), lineas, { nombre: 'Diana' }).ok, false, 'debe bloquear total inconsistente');

const traslados = [
  { fecha: '2026-07-20', timestamp_recibe: '2026-07-21', estado: 'Resuelto', producto: 'Costilla', unidad: 'kg', cantidad_enviada: 5, cantidad_recibida: 3, sede_origen: 'Centro de Producción', sede_destino: 'Capri' }
];
const conciliacion = cargar('apps-script/Conciliacion.gs', {
  SHEET_NAMES: { TRASLADOS: 'traslados' },
  leerTabla_: () => traslados,
  formatearFecha_: (v) => String(v).slice(0, 10),
  claveProducto_: (v) => v,
  aUnidadBase_: (cantidad, unidad) => ({ cantidad: Number(cantidad), unidad })
});
assert.equal(conciliacion.trasladosNetosPorItem_('2026-07-20', 'Centro de Producción', {}).Costilla.cantidad, -5);
assert.equal(conciliacion.trasladosNetosPorItem_('2026-07-21', 'Capri', {}).Costilla.cantidad, 3);
assert.deepEqual(conciliacion.trasladosNetosPorItem_('2026-07-20', 'Capri', {}), {}, 'el destino debe conciliarse en fecha de recepción');

console.log('inventory-controls: OK');
