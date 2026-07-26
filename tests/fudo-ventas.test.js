const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

function normalizarSimple_(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

(function () {
  const ventas = [];
  const items = [];
  const mod = cargar('apps-script/FudoVentas.gs', {
    SHEET_NAMES: { FUDO_VENTAS: 'ventas', FUDO_ITEMS: 'items', VENTAS_FUDO: 'flat' },
    Utilities: { getUuid: () => 'uuid-' + (items.length + ventas.length) },
    formatearFecha_: (v) => String(v).slice(0, 10),
    ventaCancelada_: (v) => v.cancelada === true || normalizarSimple_(v.cancelada) === 'si',
    claveVenta_: (v) => ['detalle', String(v.creacion), String(v.id_venta), normalizarSimple_(v.producto), normalizarSimple_(v.sede)].join('|'),
    neutralizarObjetoFormulas_: (o) => o,
    leerTabla_: (hoja) => hoja === 'ventas' ? ventas.slice() : (hoja === 'items' ? items.slice() : []),
    appendRowsFromObjs_: (hoja, filas) => {
      if (hoja === 'items') items.push.apply(items, filas);
      else if (hoja === 'ventas') ventas.push.apply(ventas, filas);
    },
    appendRowFromObj_: (hoja, fila) => {
      if (hoja === 'ventas') ventas.push(fila);
    },
    sheet_: () => ({
      getDataRange: () => ({
        getValues: () => [
          ['id_venta', 'creacion', 'sede', 'creada_por', 'formato_origen', 'archivo_origen', 'importado_en', 'items_count', 'monto_total', 'lineas_canceladas'],
          ...ventas.map(v => [v.id_venta, v.creacion, v.sede, v.creada_por, v.formato_origen, v.archivo_origen, v.importado_en, v.items_count, v.monto_total, v.lineas_canceladas])
        ]
      }),
      getRange: (r, c) => ({
        setValue: (val) => {
          if (ventas[r - 2]) {
            const headers = ['id_venta', 'creacion', 'sede', 'creada_por', 'formato_origen', 'archivo_origen', 'importado_en', 'items_count', 'monto_total', 'lineas_canceladas'];
            ventas[r - 2][headers[c - 1]] = val;
          }
        }
      })
    })
  });

  const filas = [
    { id_venta: '100', creacion: '2026-07-21', producto: 'Poker', categoria: 'Bebidas', cantidad: 2, precio: 5000, cancelada: false, sede: 'Capri', creada_por: 'Caja 1', formato_origen: 'ventas_detalladas', archivo_origen: 'test', importado_en: new Date('2026-07-21') },
    { id_venta: '100', creacion: '2026-07-21', producto: 'Chanchostilla', categoria: 'Comida', cantidad: 1, precio: 25000, cancelada: false, sede: 'Capri', creada_por: 'Caja 1', formato_origen: 'ventas_detalladas', archivo_origen: 'test', importado_en: new Date('2026-07-21') }
  ];

  const r1 = mod.fudoVentasEscribirDesdeFlat_(filas);
  assert.equal(r1.items_creados, 2);
  assert.equal(ventas.length, 1);
  assert.equal(ventas[0].id_venta, '100');
  assert.equal(ventas[0].items_count, 2);
  assert.equal(Number(ventas[0].monto_total), 35000);

  const r2 = mod.fudoVentasEscribirDesdeFlat_(filas);
  assert.equal(r2.items_creados, 0);
  assert.equal(r2.omitidos, 2);

  const listado = mod.fudoVentasListar_({ fecha_desde: '2026-07-21', fecha_hasta: '2026-07-21' });
  assert.equal(listado.length, 1);

  const itemsList = mod.fudoItemsListar_({ id_venta: '100' });
  assert.equal(itemsList.length, 2);

  console.log('fudoVentasEscribirDesdeFlat_ agrupa por id_venta e idempotencia: OK');
})();

console.log('fudo-ventas: OK');
