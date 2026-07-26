const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

function normalizar_(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

const VENTAS_HEADERS = ['id_venta', 'creacion', 'producto', 'categoria', 'cantidad', 'precio', 'cancelada', 'creada_por', 'sede', 'formato_origen', 'archivo_origen', 'importado_en'];
const ITEMS_HEADERS = ['id', 'clave_item', 'id_venta', 'creacion', 'producto', 'categoria', 'cantidad', 'precio', 'cancelada', 'sede', 'creada_por', 'formato_origen', 'archivo_origen', 'importado_en'];
const MAPEO_HEADERS = ['id', 'tipo_referencia', 'id_fudo', 'nombre', 'sede', 'creado_por', 'timestamp'];

function hoja_(headers, filas) {
  return {
    getDataRange: () => ({
      getValues: () => [headers].concat(filas.map((f) => headers.map((h) => f[h] !== undefined ? f[h] : '')))
    }),
    getRange: (fila, columna) => ({
      setValue: (valor) => { filas[fila - 2][headers[columna - 1]] = valor; }
    }),
    deleteRow: (fila) => filas.splice(fila - 2, 1)
  };
}

(function () {
  const ventas = [
    { id_venta: '31377', creacion: '2026-07-25T22:04:51Z', producto: 'Chanchostilla', creada_por: '', sede: 'Sin identificar' },
    { id_venta: '31377', creacion: '2026-07-25T22:04:51Z', producto: 'Reducción Balsámica', creada_por: '', sede: 'Sin identificar' },
    { id_venta: '31377', creacion: '2026-07-25T22:04:51Z', producto: 'domi 9k', creada_por: '', sede: 'Sin identificar' },
    { id_venta: '31359', creacion: '2026-07-25T01:15:38Z', producto: 'Combo Libra', creada_por: '', sede: 'Sin identificar' },
    { id_venta: '31359', creacion: '2026-07-25T01:15:38Z', producto: 'domi 16k', creada_por: '', sede: 'Sin identificar' },
    { id_venta: '40000', creacion: '2026-07-25T18:00:00Z', producto: 'Poker', creada_por: 'Terraza Nueva', sede: 'Sin identificar' },
    { id_venta: '40001', creacion: '2026-07-25T19:00:00Z', producto: 'Águila', creada_por: 'Terraza Nueva', sede: 'Sin identificar' }
  ];
  const items = ventas.map((v, i) => Object.assign({ id: 'i' + i }, v));
  const mapeos = [];
  const recalculadas = [];

  const mod = cargar('apps-script/FudoMapeoSedes.gs', {
    SHEET_NAMES: { FUDO_MAPEO_SEDES: 'mapeo', VENTAS_FUDO: 'ventas', FUDO_ITEMS: 'items' },
    normalizar_: normalizar_,
    formatearFecha_: (v) => String(v).slice(0, 10),
    neutralizarObjetoFormulas_: (o) => o,
    Utilities: { getUuid: () => 'map-' + (mapeos.length + 1) },
    leerTabla_: (nombre) => nombre === 'ventas' ? ventas : nombre === 'items' ? items : mapeos,
    appendRowFromObj_: (nombre, fila) => { if (nombre === 'mapeo') mapeos.push(fila); },
    sheet_: (nombre) => nombre === 'ventas' ? hoja_(VENTAS_HEADERS, ventas) : nombre === 'items' ? hoja_(ITEMS_HEADERS, items) : hoja_(MAPEO_HEADERS, mapeos),
    fudoVentasRecalcularCabecera_: (id) => recalculadas.push(String(id))
  });

  const bandeja = mod.ventasPendientesSedeListar_();
  assert.equal(bandeja.length, 3, 'dos ventas sin referencia deben quedar separadas, más un grupo con referencia');
  assert.equal(bandeja.find((g) => g.id_venta === '31377').cantidad, 3);
  assert.equal(bandeja.find((g) => g.id_venta === '31359').cantidad, 2);
  assert.equal(bandeja.find((g) => g.id_venta === '31377').creada_por, 'Venta FUDO #31377');
  assert.equal(bandeja.find((g) => g.creada_por === 'Terraza Nueva').cantidad, 2);

  const asignada = mod.ventasPendientesSedeAsignar_('Venta FUDO #31377', 'Capri', { nombre: 'Diana' });
  assert.equal(asignada.ok, true);
  assert.equal(asignada.actualizadas, 3);
  assert.equal(asignada.actualizadas_items, 3);
  assert.equal(asignada.regla_creada, false, 'una asignación por venta no debe crear una regla reutilizable');
  assert.ok(ventas.filter((v) => v.id_venta === '31377').every((v) => v.sede === 'Capri'));
  assert.ok(ventas.filter((v) => v.id_venta === '31359').every((v) => v.sede === 'Sin identificar'), 'la otra venta vacía no debe tocarse');
  assert.deepEqual(recalculadas, ['31377']);

  const porReferencia = mod.ventasPendientesSedeAsignar_('Terraza Nueva', 'San Antonio', { nombre: 'Diana' });
  assert.equal(porReferencia.actualizadas, 2);
  assert.equal(porReferencia.regla_creada, true, 'una referencia real sí debe aprender la regla');
  assert.equal(mapeos.length, 1);

  console.log('fudo-pendientes-sede-id: OK');
})();
