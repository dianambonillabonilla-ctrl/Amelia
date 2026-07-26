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
  const pagosNorm = [
    { fecha: '2026-07-21', sede: 'Capri', monto: 40000, cancelado: false, es_efectivo: true },
    { fecha: '2026-07-21', sede: 'Capri', monto: 20000, cancelado: false, es_efectivo: false }
  ];
  const pagosFlat = [
    { fecha: '2026-07-21', sede: 'Capri', monto: 99999, cancelado: false, metodo_tipo: 'cash', metodo_pago: 'Efectivo' }
  ];

  const modPagos = cargar('apps-script/FudoPagos.gs', {
    SHEET_NAMES: { FUDO_PAGOS: 'norm', PAGOS_FUDO: 'flat' },
    formatearFecha_: (v) => String(v).slice(0, 10),
    normalizar_: normalizarSimple_,
    neutralizarObjetoFormulas_: (o) => o,
    pagosFudoEsEfectivo_: () => true,
    leerTabla_: (h) => h === 'norm' ? pagosNorm : pagosFlat
  });

  const totNorm = modPagos.fudoPagosTotalesSedeFecha_('2026-07-21', 'Capri');
  assert.equal(totNorm.registros, 2);
  assert.equal(totNorm.pagos_fudo_total, 60000);
  assert.equal(totNorm.pagos_efectivo_esperado, 40000);

  const modPagosFudo = cargar('apps-script/PagosFudo.gs', {
    SHEET_NAMES: { PAGOS_FUDO: 'flat', FUDO_PAGOS: 'norm' },
    formatearFecha_: (v) => String(v).slice(0, 10),
    normalizar_: normalizarSimple_,
    pagosFudoEsEfectivo_: (p) => normalizarSimple_(p.metodo_tipo) === 'cash',
    fudoPagosTotalesSedeFecha_: modPagos.fudoPagosTotalesSedeFecha_,
    leerTabla_: (h) => h === 'norm' ? pagosNorm : pagosFlat
  });
  const conNorm = modPagosFudo.pagosFudoTotalesSedeFecha_('2026-07-21', 'Capri');
  assert.equal(conNorm.fuente, 'Fudo_Pagos');
  assert.equal(conNorm.pagos_fudo_total, 60000);

  const sinNorm = cargar('apps-script/PagosFudo.gs', {
    SHEET_NAMES: { PAGOS_FUDO: 'flat', FUDO_PAGOS: 'norm' },
    formatearFecha_: (v) => String(v).slice(0, 10),
    normalizar_: normalizarSimple_,
    pagosFudoEsEfectivo_: (p) => normalizarSimple_(p.metodo_tipo) === 'cash',
    fudoPagosTotalesSedeFecha_: () => ({ pagos_fudo_total: 0, pagos_efectivo_esperado: 0, pagos_fudo_cantidad: 0, registros: 0 }),
    leerTabla_: (h) => h === 'flat' ? pagosFlat : []
  }).pagosFudoTotalesSedeFecha_('2026-07-21', 'Capri');
  assert.equal(sinNorm.fuente, 'Pagos_FUDO');
  assert.equal(sinNorm.pagos_fudo_total, 99999);

  console.log('pagosFudoTotalesSedeFecha_ prefiere Fudo_Pagos con fallback: OK');
})();

(function () {
  const mod = cargar('apps-script/Turnos.gs', {
    SHEET_NAMES: { VENTAS_FUDO: 'ventas', FUDO_VENTAS: 'ventasNorm', TRASLADOS: 'traslados', PRODUCCIONES: 'prod' },
    leerTabla_: (h) => {
      if (h === 'ventasNorm') return [{ creacion: '2026-07-21', sede: 'Capri', monto_total: 120000 }];
      if (h === 'ventas') return [{ creacion: '2026-07-21', sede: 'Capri', precio: 1, cantidad: 999, cancelada: false }];
      return [];
    },
    formatearFecha_: (v) => String(v).slice(0, 10),
    normalizar_: normalizarSimple_,
    fudoVentasTotalesSedeFecha_: (fecha, sede) => ({
      ventas_fudo_total: 120000, ventas_fudo_cantidad: 1, registros: 1
    }),
    pagosFudoTotalesSedeFecha_: () => ({
      pagos_fudo_total: 50000, pagos_efectivo_esperado: 30000, pagos_fudo_cantidad: 2, fuente: 'Fudo_Pagos'
    }),
    fudoDescuentosPropinasTotalesSedeFecha_: () => ({
      descuentos_total: 5000, descuentos_cantidad: 1, propinas_total: 8000, propinas_cantidad: 2
    }),
    fudoApiSyncLeer_: (tipo) => tipo === 'ventas'
      ? { ok: true, timestamp: '2026-07-21T18:00:00.000Z' }
      : { ok: true, timestamp: '2026-07-21T19:00:00.000Z' },
    resumenDiferenciasInventarioFechaSede_: () => ({ ok: true, productos_contados: 0, productos_con_diferencia: 0, diferencias: [] })
  });

  const resumen = mod.turnoResumenCierre_('2026-07-21', 'Capri');
  assert.equal(resumen.fuente_ventas, 'Fudo_Ventas');
  assert.equal(resumen.ventas_fudo_total, 120000);
  assert.equal(resumen.fuente_pagos, 'Fudo_Pagos');
  assert.equal(resumen.descuentos_total, 5000);
  assert.equal(resumen.propinas_total, 8000);
  assert.ok(resumen.sync_ventas_en);
  assert.ok(resumen.sync_pagos_en);

  console.log('turnoResumenCierre_ enriquecido con normalizados y sync: OK');
})();

console.log('cierre-turno-enriquecido: OK');
