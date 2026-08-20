const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

function fudoApiRelacionPtrs_(rel) {
  if (!rel) return [];
  if (rel.data) return Array.isArray(rel.data) ? rel.data : [rel.data];
  if (Array.isArray(rel)) {
    return rel.map(function (x) { return x && x.data ? x.data : x; }).filter(Boolean);
  }
  return [];
}

(function () {
  const subitems = [];
  const headers = ['id_subitem', 'clave_subitem', 'id_item', 'id_venta', 'creacion', 'producto', 'cantidad', 'precio',
    'cancelado', 'sede', 'archivo_origen', 'importado_en'];
  const mod = cargar('apps-script/FudoSubitems.gs', {
    SHEET_NAMES: { FUDO_SUBITEMS: 'subitems' },
    formatearFecha_: (v) => String(v).slice(0, 10),
    neutralizarObjetoFormulas_: (o) => o,
    fudoApiRelacionPtrs_,
    fudoApiIncluidoPorPtr_: (ptr, incluidos) => incluidos[ptr.type + ':' + ptr.id],
    fudoApiNombreIncluido_: (r) => r && r.attributes && r.attributes.name ? r.attributes.name : '',
    fudoApiReferenciasSedeDesdeSale_: () => ({ sala: 'Terraza Capri' }),
    fudoResolverSedeVenta_: () => ({ sede: 'Capri' }),
    // Regla DILANA (ago 2026): la cantidad de un subitem solo se conserva si el producto es una
    // bebida identificada — para comida (como "Extra queso" en este test) debe quedar vacía.
    cantidadFudoConfiableParaProducto_: (nombre) => nombre === 'Gaseosa',
    leerTabla_: () => subitems.slice(),
    appendRowsFromObjs_: (hoja, filas) => {
      if (hoja === 'subitems') subitems.push.apply(subitems, filas);
    },
    sheet_: () => ({
      getDataRange: () => ({
        getValues: () => [
          headers,
          ...subitems.map(s => headers.map(h => s[h]))
        ]
      }),
      getRange: (r, c) => ({
        setValue: (val) => {
          if (subitems[r - 2]) subitems[r - 2][headers[c - 1]] = val;
        }
      })
    })
  });

  const incluidos = {
    'Item:50': {
      type: 'Item', id: '50',
      attributes: { createdAt: '2026-07-21T12:05:00Z' },
      relationships: {
        subitems: { data: [{ type: 'Subitem', id: '60' }] }
      }
    },
    'Subitem:60': {
      type: 'Subitem', id: '60',
      attributes: { quantity: 2, price: 1500, canceled: false, createdAt: '2026-07-21T12:06:00Z' },
      relationships: { product: { data: { type: 'Product', id: '7' } } }
    },
    'Product:7': { type: 'Product', id: '7', attributes: { name: 'Extra queso' } }
  };
  const sale = {
    id: '100',
    attributes: { createdAt: '2026-07-21T12:00:00Z' },
    relationships: {
      items: { data: [{ type: 'Item', id: '50' }] }
    }
  };

  const r1 = mod.fudoSubitemsEscribirDesdeSales_([sale], incluidos, {}, { archivo_origen: 'test' });
  assert.equal(r1.creados, 1);
  assert.equal(r1.actualizados, 0);
  assert.equal(subitems[0].producto, 'Extra queso');
  // "Extra queso" es comida no identificada como bebida: la cantidad debe quedar vacía, no se debe
  // usar para inventario — el valor económico (precio) sí se conserva.
  assert.equal(subitems[0].cantidad, '');
  assert.equal(subitems[0].precio, 1500);
  assert.equal(subitems[0].sede, 'Capri');
  assert.equal(subitems[0].clave_subitem, '100|50|60');

  const r2 = mod.fudoSubitemsEscribirDesdeSales_([sale], incluidos, {}, { archivo_origen: 'test2' });
  assert.equal(r2.creados, 0);
  assert.equal(r2.actualizados, 1);

  const estado = mod.fudoSubitemsEstado_();
  assert.equal(estado.subitems, 1);

  const list = mod.fudoSubitemsListar_({ id_venta: '100' });
  assert.equal(list.length, 1);
  assert.equal(list[0].id_item, '50');

  console.log('fudoSubitemsEscribirDesdeSales_ extrae e idempotencia: OK');
})();

// Un subitem de bebida identificada sí debe conservar la cantidad FUDO (excepción confirmada,
// ver regla DILANA arriba) — sin este caso, la regla de "comida sin cantidad" no queda probada
// del lado en que la cantidad SÍ debe pasar.
(function () {
  const subitems = [];
  const headers = ['id_subitem', 'clave_subitem', 'id_item', 'id_venta', 'creacion', 'producto', 'cantidad', 'precio',
    'cancelado', 'sede', 'archivo_origen', 'importado_en'];
  const mod = cargar('apps-script/FudoSubitems.gs', {
    SHEET_NAMES: { FUDO_SUBITEMS: 'subitems' },
    formatearFecha_: (v) => String(v).slice(0, 10),
    neutralizarObjetoFormulas_: (o) => o,
    fudoApiRelacionPtrs_,
    fudoApiIncluidoPorPtr_: (ptr, incluidos) => incluidos[ptr.type + ':' + ptr.id],
    fudoApiNombreIncluido_: (r) => r && r.attributes && r.attributes.name ? r.attributes.name : '',
    fudoApiReferenciasSedeDesdeSale_: () => ({ sala: 'Terraza Capri' }),
    fudoResolverSedeVenta_: () => ({ sede: 'Capri' }),
    cantidadFudoConfiableParaProducto_: (nombre) => nombre === 'Gaseosa',
    leerTabla_: () => subitems.slice(),
    appendRowsFromObjs_: (hoja, filas) => {
      if (hoja === 'subitems') subitems.push.apply(subitems, filas);
    },
    sheet_: () => ({
      getDataRange: () => ({
        getValues: () => [
          headers,
          ...subitems.map(s => headers.map(h => s[h]))
        ]
      }),
      getRange: (r, c) => ({
        setValue: (val) => {
          if (subitems[r - 2]) subitems[r - 2][headers[c - 1]] = val;
        }
      })
    })
  });

  const incluidos = {
    'Item:51': {
      type: 'Item', id: '51',
      attributes: { createdAt: '2026-07-21T12:05:00Z' },
      relationships: { subitems: { data: [{ type: 'Subitem', id: '61' }] } }
    },
    'Subitem:61': {
      type: 'Subitem', id: '61',
      attributes: { quantity: 3, price: 4500, canceled: false, createdAt: '2026-07-21T12:06:00Z' },
      relationships: { product: { data: { type: 'Product', id: '8' } } }
    },
    'Product:8': { type: 'Product', id: '8', attributes: { name: 'Gaseosa' } }
  };
  const sale = {
    id: '101',
    attributes: { createdAt: '2026-07-21T12:00:00Z' },
    relationships: { items: { data: [{ type: 'Item', id: '51' }] } }
  };

  mod.fudoSubitemsEscribirDesdeSales_([sale], incluidos, {}, { archivo_origen: 'test' });
  assert.equal(subitems[0].producto, 'Gaseosa');
  assert.equal(subitems[0].cantidad, 3);
  assert.equal(subitems[0].precio, 4500);

  console.log('fudoSubitemsEscribirDesdeSales_ conserva cantidad para bebida identificada: OK');
})();

console.log('fudo-subitems: OK');
