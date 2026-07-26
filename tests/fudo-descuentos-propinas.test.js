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
  const descuentos = [];
  const propinas = [];
  const mod = cargar('apps-script/FudoDescuentosPropinas.gs', {
    SHEET_NAMES: { FUDO_DESCUENTOS: 'descuentos', FUDO_PROPINAS: 'propinas' },
    FUDO_API_SALES_INCLUDE_: 'test-include',
    formatearFecha_: (v) => String(v).slice(0, 10),
    normalizar_: (s) => String(s || '').trim().toLowerCase(),
    neutralizarObjetoFormulas_: (o) => o,
    fudoApiIncluidoPorPtr_: (ptr, incluidos) => incluidos[ptr.type + ':' + ptr.id],
    fudoApiNombreIncluido_: (r) => r && r.attributes && r.attributes.name ? r.attributes.name : '',
    fudoApiReferenciasSedeDesdeSale_: () => ({ sala: 'Terraza Capri' }),
    fudoResolverSedeVenta_: () => ({ sede: 'Capri' }),
    leerTabla_: (hoja) => hoja === 'descuentos' ? descuentos.slice() : (hoja === 'propinas' ? propinas.slice() : []),
    appendRowsFromObjs_: (hoja, filas) => {
      if (hoja === 'descuentos') descuentos.push.apply(descuentos, filas);
      else if (hoja === 'propinas') propinas.push.apply(propinas, filas);
    },
    sheet_: (hoja) => ({
      getDataRange: () => ({
        getValues: () => {
          if (hoja === 'descuentos') {
            return [
              ['id_descuento', 'id_venta', 'creacion', 'monto', 'porcentaje', 'monto_max', 'cancelado', 'plantilla_nombre', 'sede', 'archivo_origen', 'importado_en'],
              ...descuentos.map(d => [d.id_descuento, d.id_venta, d.creacion, d.monto, d.porcentaje, d.monto_max, d.cancelado, d.plantilla_nombre, d.sede, d.archivo_origen, d.importado_en])
            ];
          }
          return [
            ['id_propina', 'id_venta', 'creacion', 'monto', 'cancelado', 'sede', 'archivo_origen', 'importado_en'],
            ...propinas.map(p => [p.id_propina, p.id_venta, p.creacion, p.monto, p.cancelado, p.sede, p.archivo_origen, p.importado_en])
          ];
        }
      }),
      getRange: (r, c) => ({
        setValue: (val) => {
          const tabla = hoja === 'descuentos' ? descuentos : propinas;
          const headers = hoja === 'descuentos'
            ? ['id_descuento', 'id_venta', 'creacion', 'monto', 'porcentaje', 'monto_max', 'cancelado', 'plantilla_nombre', 'sede', 'archivo_origen', 'importado_en']
            : ['id_propina', 'id_venta', 'creacion', 'monto', 'cancelado', 'sede', 'archivo_origen', 'importado_en'];
          if (tabla[r - 2]) tabla[r - 2][headers[c - 1]] = val;
        }
      })
    })
  });

  const incluidos = {
    'Discount:10': {
      type: 'Discount', id: '10',
      attributes: { amount: 5000, percentage: 10, maxAmount: 8000, canceled: false },
      relationships: { discountTemplate: { data: { type: 'DiscountTemplate', id: '1' } } }
    },
    'DiscountTemplate:1': { type: 'DiscountTemplate', id: '1', attributes: { name: 'Empleado' } },
    'Tip:20': { type: 'Tip', id: '20', attributes: { amount: 3000, canceled: false } }
  };
  const sale = {
    id: '100',
    attributes: { createdAt: '2026-07-21T12:00:00Z' },
    relationships: {
      discounts: { data: [{ type: 'Discount', id: '10' }] },
      tips: { data: [{ type: 'Tip', id: '20' }] }
    }
  };

  const r1 = mod.fudoDescuentosPropinasEscribirDesdeSales_([sale], incluidos, {}, { archivo_origen: 'test' });
  assert.equal(r1.descuentos_creados, 1);
  assert.equal(r1.propinas_creadas, 1);
  assert.equal(descuentos[0].plantilla_nombre, 'Empleado');
  assert.equal(descuentos[0].sede, 'Capri');
  assert.equal(propinas[0].monto, 3000);

  const r2 = mod.fudoDescuentosPropinasEscribirDesdeSales_([sale], incluidos, {}, { archivo_origen: 'test2' });
  assert.equal(r2.descuentos_creados, 0);
  assert.equal(r2.descuentos_actualizados, 1);
  assert.equal(r2.propinas_actualizados, undefined);
  assert.equal(r2.propinas_actualizadas, 1);

  const estado = mod.fudoDescuentosPropinasEstado_();
  assert.equal(estado.descuentos, 1);
  assert.equal(estado.propinas, 1);
  assert.equal(estado.monto_descuentos, 5000);
  assert.equal(estado.monto_propinas, 3000);

  const listDesc = mod.fudoDescuentosListar_({ id_venta: '100' });
  assert.equal(listDesc.length, 1);

  console.log('fudoDescuentosPropinasEscribirDesdeSales_ extrae e idempotencia: OK');
})();

console.log('fudo-descuentos-propinas: OK');
