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
  const pagos = [];
  const mod = cargar('apps-script/FudoPagos.gs', {
    SHEET_NAMES: { FUDO_PAGOS: 'pagos', PAGOS_FUDO: 'flat' },
    formatearFecha_: (v) => String(v).slice(0, 10),
    normalizar_: normalizarSimple_,
    neutralizarObjetoFormulas_: (o) => o,
    pagosFudoEsEfectivo_: (p) => normalizarSimple_(p.metodo_tipo) === 'cash' || normalizarSimple_(p.metodo_pago).indexOf('efectivo') !== -1,
    leerTabla_: (hoja) => hoja === 'pagos' ? pagos.slice() : [],
    appendRowsFromObjs_: (hoja, filas) => {
      if (hoja === 'pagos') pagos.push.apply(pagos, filas);
    },
    sheet_: () => ({
      getDataRange: () => ({
        getValues: () => [
          ['id_pago', 'id_venta', 'fecha', 'creacion', 'monto', 'cancelado', 'metodo_pago', 'metodo_tipo', 'sede', 'es_efectivo', 'archivo_origen', 'importado_por', 'importado_en'],
          ...pagos.map(p => [p.id_pago, p.id_venta, p.fecha, p.creacion, p.monto, p.cancelado, p.metodo_pago, p.metodo_tipo, p.sede, p.es_efectivo, p.archivo_origen, p.importado_por, p.importado_en])
        ]
      }),
      getRange: (r, c) => ({
        setValue: (val) => {
          if (pagos[r - 2]) {
            const headers = ['id_pago', 'id_venta', 'fecha', 'creacion', 'monto', 'cancelado', 'metodo_pago', 'metodo_tipo', 'sede', 'es_efectivo', 'archivo_origen', 'importado_por', 'importado_en'];
            pagos[r - 2][headers[c - 1]] = val;
          }
        }
      })
    })
  });

  const filas = [
    { id_pago: 'p1', id_venta: '100', fecha: '2026-07-21', creacion: '2026-07-21T10:00:00', monto: 35000, cancelado: false, metodo_pago: 'Efectivo', metodo_tipo: 'cash', sede: 'Capri', archivo_origen: 'api', importado_por: 'Admin', importado_en: new Date('2026-07-21') },
    { id_pago: 'p2', id_venta: '101', fecha: '2026-07-21', creacion: '2026-07-21T11:00:00', monto: 12000, cancelado: false, metodo_pago: 'Tarjeta', metodo_tipo: 'card', sede: 'Capri', archivo_origen: 'api', importado_por: 'Admin', importado_en: new Date('2026-07-21') }
  ];

  const r1 = mod.fudoPagosEscribirDesdeFlat_(filas);
  assert.equal(r1.creados, 2);
  assert.equal(pagos.length, 2);
  assert.equal(pagos[0].es_efectivo, true);
  assert.equal(pagos[1].es_efectivo, false);

  const r2 = mod.fudoPagosEscribirDesdeFlat_([
    Object.assign({}, filas[0], { monto: 36000 })
  ]);
  assert.equal(r2.creados, 0);
  assert.equal(r2.actualizados, 1);
  assert.equal(pagos[0].monto, 36000);

  const listado = mod.fudoPagosListar_({ fecha_desde: '2026-07-21', fecha_hasta: '2026-07-21', solo_efectivo: true });
  assert.equal(listado.length, 1);
  assert.equal(listado[0].id_pago, 'p1');

  console.log('fudoPagosEscribirDesdeFlat_ UPSERT e idempotencia: OK');
})();

console.log('fudo-pagos: OK');
