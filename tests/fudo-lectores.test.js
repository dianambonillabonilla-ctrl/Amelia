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
  return String(s || '').trim().toLowerCase();
}

(function () {
  const flat = [
    { creacion: '2026-07-21', sede: 'Capri', producto: 'Plano', categoria: 'Comida', cantidad: 1, precio: 100, cancelada: false }
  ];
  const items = [
    { id_venta: '1', creacion: '2026-07-21', sede: 'Capri', producto: 'Normalizado', categoria: 'Comida', cantidad: 2, precio: 50, cancelada: false }
  ];
  const mod = cargar('apps-script/FudoLectores.gs', {
    SHEET_NAMES: { FUDO_ITEMS: 'items', VENTAS_FUDO: 'flat', FUDO_PAGOS: 'pagosNorm', PAGOS_FUDO: 'pagosFlat' },
    formatearFecha_: (v) => String(v).slice(0, 10),
    normalizar_: normalizarSimple_,
    ventaCancelada_: (v) => v.cancelada === true || normalizarSimple_(v.cancelada) === 'si',
    leerTabla_: (h) => {
      if (h === 'items') return items;
      if (h === 'flat') return flat;
      if (h === 'pagosNorm') return [{ fecha: '2026-07-21', cancelado: false }];
      if (h === 'pagosFlat') return [{ fecha: '2026-07-21', cancelado: false }, { fecha: '2026-07-21', cancelado: false }];
      return [];
    }
  });

  const dia = mod.ventasFudoLineasParaFecha_('2026-07-21');
  assert.equal(dia.fuente, 'Fudo_Items');
  assert.equal(dia.lineas.length, 1);
  assert.equal(dia.lineas[0].producto, 'Normalizado');

  const sinItems = cargar('apps-script/FudoLectores.gs', {
    SHEET_NAMES: { FUDO_ITEMS: 'items', VENTAS_FUDO: 'flat', FUDO_PAGOS: 'pagosNorm', PAGOS_FUDO: 'pagosFlat' },
    formatearFecha_: (v) => String(v).slice(0, 10),
    normalizar_: normalizarSimple_,
    ventaCancelada_: (v) => v.cancelada === true,
    leerTabla_: (h) => h === 'flat' ? flat : []
  });
  const plano = sinItems.ventasFudoLineasParaFecha_('2026-07-21');
  assert.equal(plano.fuente, 'Ventas_FUDO');
  assert.equal(plano.lineas[0].producto, 'Plano');

  const pagos = mod.pagosFudoCantidadFecha_('2026-07-21');
  assert.equal(pagos.fuente, 'Fudo_Pagos');
  assert.equal(pagos.registros, 1);

  console.log('ventasFudoLineasParaFecha_ y pagosFudoCantidadFecha_ fallback: OK');
})();

(function () {
  const items = [
    { id_venta: '1', creacion: '2026-07-21', sede: 'Capri', producto: 'Waffle', categoria: 'Comida', cantidad: 1, precio: 10000, cancelada: false }
  ];
  const subitems = [
    { id_venta: '1', id_item: '50', creacion: '2026-07-21', sede: 'Capri', producto: 'Extra queso', cantidad: 2, precio: 1500, cancelado: false },
    { id_venta: '1', id_item: '50', creacion: '2026-07-21', sede: 'Capri', producto: 'Extra cancelado', cantidad: 9, precio: 0, cancelado: true }
  ];
  const mod = cargar('apps-script/FudoLectores.gs', {
    SHEET_NAMES: { FUDO_ITEMS: 'items', VENTAS_FUDO: 'flat', FUDO_SUBITEMS: 'subitems', FUDO_PAGOS: 'pagosNorm', PAGOS_FUDO: 'pagosFlat' },
    formatearFecha_: (v) => String(v).slice(0, 10),
    normalizar_: normalizarSimple_,
    ventaCancelada_: (v) => v.cancelada === true || normalizarSimple_(v.cancelada) === 'si',
    leerTabla_: (h) => {
      if (h === 'items') return items;
      if (h === 'subitems') return subitems;
      return [];
    }
  });

  const sub = mod.subitemsFudoParaFecha_('2026-07-21');
  assert.equal(sub.fuente, 'Fudo_Subitems');
  assert.equal(sub.lineas.length, 1, 'omite subítems cancelados');
  assert.equal(sub.lineas[0].producto, 'Extra queso');
  assert.equal(sub.lineas[0].es_subitem, true);

  const consumo = mod.ventasFudoLineasParaConsumo_('2026-07-21');
  assert.equal(consumo.lineas.length, 2, 'ítem + subítem');
  assert.equal(consumo.fuente_subitems, 'Fudo_Subitems');

  const sinSub = cargar('apps-script/FudoLectores.gs', {
    SHEET_NAMES: { FUDO_ITEMS: 'items', VENTAS_FUDO: 'flat', FUDO_SUBITEMS: 'subitems', FUDO_PAGOS: 'pagosNorm', PAGOS_FUDO: 'pagosFlat' },
    formatearFecha_: (v) => String(v).slice(0, 10),
    normalizar_: normalizarSimple_,
    ventaCancelada_: (v) => v.cancelada === true,
    leerTabla_: (h) => h === 'items' ? items : []
  });
  const soloItems = sinSub.ventasFudoLineasParaConsumo_('2026-07-21');
  assert.equal(soloItems.lineas.length, 1);
  assert.equal(soloItems.fuente_subitems, null);

  console.log('subitemsFudoParaFecha_ y ventasFudoLineasParaConsumo_: OK');
})();

(function () {
  const items = [
    { id_venta: '100', creacion: '2026-07-21', sede: 'Capri', producto: 'Waffle', cancelada: false }
  ];
  const flat = [
    { id_venta: '200', creacion: '2026-07-21', sede: 'San Antonio', producto: 'Plano', cancelada: false }
  ];
  const mod = cargar('apps-script/FudoLectores.gs', {
    SHEET_NAMES: { FUDO_ITEMS: 'items', VENTAS_FUDO: 'flat', FUDO_SUBITEMS: 'sub', FUDO_PAGOS: 'p', PAGOS_FUDO: 'pf' },
    formatearFecha_: (v) => String(v).slice(0, 10),
    normalizar_: normalizarSimple_,
    ventaCancelada_: (v) => v.cancelada === true,
    leerTabla_: (h) => {
      if (h === 'items') return items;
      if (h === 'flat') return flat;
      return [];
    }
  });
  const idx = mod.ventasFudoIndiceSedePorVenta_();
  assert.equal(idx['100'], 'Capri');
  assert.equal(idx['200'], undefined, 'con Fudo_Items no lee la plana');

  const todo = mod.ventasFudoLineasTodasParaConsumo_({ sin_canceladas: true });
  assert.equal(todo.lineas.length, 1);
  assert.equal(todo.lineas[0].producto, 'Waffle');
  console.log('ventasFudoIndiceSedePorVenta_ y ventasFudoLineasTodasParaConsumo_: OK');
})();

(function () {
  const items = [
    { id_venta: '10', creacion: '2026-07-21', sede: 'Capri', producto: 'Poker', categoria: 'Bebidas', cantidad: 3, precio: 5000, cancelada: false }
  ];
  const mod = cargar('apps-script/Conciliacion.gs', {
    SHEET_NAMES: { VENTAS_FUDO: 'flat', FUDO_ITEMS: 'items', MOVIMIENTOS_FUDO: 'mov', CATALOGO: 'cat', CONTEOS: 'conteos', TRASLADOS: 'traslados', AJUSTES_INVENTARIO: 'ajustes', PRODUCCIONES: 'prod', RECETAS: 'recetas' },
    formatearFecha_: (v) => String(v).slice(0, 10),
    normalizar_: normalizarSimple_,
    ventaCancelada_: (v) => v.cancelada === true,
    leerTabla_: (h) => {
      if (h === 'items') return items;
      if (h === 'flat') return [];
      if (h === 'mov') return [];
      if (h === 'cat') return [{ nombre_estandar: 'Poker', categoria: 'Bebidas', sede: 'Ambas' }];
      return [];
    },
    indiceCatalogo_: () => ({ poker: 'Poker' }),
    nombresPosiblesPorEstandar_: () => ({ Poker: ['poker'] }),
    conteoListar_: () => [],
    stockFudoBaseIndice_: () => ({}),
    ventasFudoLineasParaFecha_: (fecha, opciones) => {
      let lineas = items.filter((it) => String(it.creacion).slice(0, 10) === fecha);
      if (opciones && opciones.sin_canceladas !== false) lineas = lineas.filter((it) => !it.cancelada);
      return { lineas: lineas.map((it) => Object.assign({}, it)), fuente: 'Fudo_Items' };
    },
    ventasFudoLineasTodas_: (opciones) => {
      let lineas = items.slice();
      if (opciones && opciones.sin_canceladas !== false) lineas = lineas.filter((it) => !it.cancelada);
      return { lineas, fuente: 'Fudo_Items' };
    },
    stockEsperadoFudo_: () => null,
    diaAnterior_: () => '',
    claveProducto_: (p) => normalizarSimple_(p),
    nombreCanonico_: (p) => p
  });

  const bebidas = mod.conciliarBebidas_('2026-07-21', null);
  const poker = bebidas.find((b) => b.producto === 'Poker');
  assert.ok(poker);
  assert.equal(poker.consumo_fudo_total, 3, 'debe leer cantidad desde Fudo_Items vía ventasFudoLineasParaFecha_');

  const resumen = mod.resumirVentasFudo_('2026-07-21');
  assert.equal(resumen.length, 1);
  assert.equal(resumen[0].producto, 'Poker');
  assert.equal(resumen[0].cantidad, 3);

  console.log('conciliarBebidas_ usa Fudo_Items cuando hay datos normalizados: OK');
})();

console.log('fudo-lectores: OK');
