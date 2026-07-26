const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

(function () {
  const pagos = [];
  const lock = { tryLock: () => true, releaseLock: () => {} };
  const headers = ['id_pago', 'id_venta', 'fecha', 'creacion', 'monto', 'cancelado', 'metodo_pago', 'metodo_tipo', 'sede', 'archivo_origen', 'importado_por', 'importado_en'];
  const mod = cargar('apps-script/PagosFudo.gs', {
    SHEET_NAMES: { PAGOS_FUDO: 'pagos' },
    FUDO_SEDE_SIN_IDENTIFICAR_: 'Sin identificar',
    formatearFecha_: (v) => String(v).slice(0, 10),
    neutralizarObjetoFormulas_: (o) => o,
    LockService: { getScriptLock: () => lock },
    ventasFudoIndiceSedePorVenta_: () => ({ '500': 'Capri' }),
    appendRowsFromObjs_: (hoja, filas) => { if (hoja === 'pagos') pagos.push.apply(pagos, filas); },
    sheet_: () => ({
      getDataRange: () => ({
        getValues: () => [headers, ...pagos.map(p => headers.map(h => p[h]))]
      }),
      getRange: (r, c) => ({
        setValue: (val) => { if (pagos[r - 2]) pagos[r - 2][headers[c - 1]] = val; }
      })
    })
  });

  assert.equal(mod.pagosFudoIndiceSedePorVenta_()['500'], 'Capri');

  const fila = {
    id_pago: '99', id_venta: '500', creacion: '2026-07-21T12:00:00Z',
    monto: 15000, cancelado: false, metodo_pago: 'Efectivo', metodo_tipo: 'CASH', sede: 'Capri'
  };
  const r1 = mod.pagosFudoImportar_([fila], { nombre: 'Test' }, { archivo: 'test' });
  assert.equal(r1.importados, 1);
  const r2 = mod.pagosFudoImportar_([Object.assign({}, fila, { monto: 16000 })], { nombre: 'Test' }, {});
  assert.equal(r2.actualizados, 1);
  assert.equal(pagos[0].monto, 16000);
  console.log('pagosFudoImportar_ UPSERT e indempotencia: OK');
})();

console.log('pagos-fudo: OK');
