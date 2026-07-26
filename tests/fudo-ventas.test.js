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

function crearEntorno() {
  const ventas = [];
  const items = [];
  let contadorUuid = 0;
  const mod = cargar('apps-script/FudoVentas.gs', {
    SHEET_NAMES: { FUDO_VENTAS: 'ventas', FUDO_ITEMS: 'items', VENTAS_FUDO: 'flat' },
    Utilities: { getUuid: () => 'uuid-' + (++contadorUuid) },
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
  return { mod, ventas, items };
}

(function () {
  const { mod, ventas, items } = crearEntorno();
  const filas = [
    { id_venta: '100', creacion: '2026-07-21', producto: 'Poker', categoria: 'Bebidas', cantidad: 2, precio: 5000, cancelada: false, sede: 'Capri', creada_por: 'Caja 1', formato_origen: 'ventas_detalladas', archivo_origen: 'test', importado_en: new Date('2026-07-21') },
    { id_venta: '100', creacion: '2026-07-21', producto: 'Chanchostilla', categoria: 'Comida', cantidad: 1, precio: 25000, cancelada: false, sede: 'Capri', creada_por: 'Caja 1', formato_origen: 'ventas_detalladas', archivo_origen: 'test', importado_en: new Date('2026-07-21') }
  ];

  const r1 = mod.fudoVentasEscribirDesdeFlat_(filas);
  assert.equal(r1.items_creados, 2);
  assert.equal(ventas.length, 1);
  assert.equal(ventas[0].items_count, 2);
  assert.equal(Number(ventas[0].monto_total), 30000, 'precio ya es total de línea; no debe multiplicar por cantidad');

  const r2 = mod.fudoVentasEscribirDesdeFlat_(filas);
  assert.equal(r2.items_creados, 0);
  assert.equal(r2.omitidos, 2);
  assert.equal(items.length, 2);

  console.log('fudoVentasEscribirDesdeFlat_ agrupa por id_venta e idempotencia: OK');
})();

(function () {
  const { mod, ventas, items } = crearEntorno();
  const fecha = '2026-07-25T01:15:38.000Z';
  const base = { id_venta: '31359', creacion: fecha, categoria: '', cancelada: false, sede: 'Sin identificar', creada_por: '', formato_origen: 'ventas_detalladas', archivo_origen: 'API', importado_en: new Date(fecha) };
  const filas = [
    Object.assign({}, base, { producto: 'Combo Libra', cantidad: 1, precio: 92000 }),
    Object.assign({}, base, { producto: 'Combo Libra', cantidad: 1, precio: 92000 }),
    Object.assign({}, base, { producto: 'Combo Libra', cantidad: 1, precio: 92000 }),
    Object.assign({}, base, { producto: 'Aioli de Amelia', cantidad: 2, precio: 6000 }),
    Object.assign({}, base, { producto: 'Cebollita de Amelia', cantidad: 2, precio: 6000 }),
    Object.assign({}, base, { producto: 'domi 16k', cantidad: 1, precio: 16000 })
  ];

  const r1 = mod.fudoVentasEscribirDesdeFlat_(filas);
  assert.equal(r1.items_creados, 6, 'debe conservar las tres ocurrencias de Combo Libra');
  assert.equal(items.filter(i => i.producto === 'Combo Libra').length, 3);
  assert.equal(ventas[0].items_count, 6);
  assert.equal(ventas[0].monto_total, 304000, 'debe coincidir con el pago real de FUDO');

  const r2 = mod.fudoVentasEscribirDesdeFlat_(filas);
  assert.equal(r2.items_creados, 0, 'repetir la migración no debe duplicar ítems');
  assert.equal(items.length, 6);

  console.log('fudoVentasEscribirDesdeFlat_ conserva productos repetidos y total real: OK');
})();

console.log('fudo-ventas: OK');
