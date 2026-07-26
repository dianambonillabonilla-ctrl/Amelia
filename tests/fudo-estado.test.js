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
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function claveProductoMock_(texto, indice) {
  const n = normalizarSimple_(texto);
  const canonico = indice && indice[n];
  return canonico ? normalizarSimple_(canonico) : n;
}

let props = {};
const fakePropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => (props[k] !== undefined ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
    deleteProperty: (k) => { delete props[k]; }
  })
};

(function () {
  props = { FUDO_API_KEY: 'k', FUDO_API_SECRET: 's' };
  const hoy = '2026-07-26';
  const mod = cargar('apps-script/FudoEstado.gs', {
    PropertiesService: fakePropertiesService,
    formatearFecha_: (v) => {
      if (v && typeof v === 'object' && typeof v.getTime === 'function') return hoy;
      return String(v || '').slice(0, 10);
    },
    normalizar_: normalizarSimple_,
    claveProducto_: claveProductoMock_,
    nombreCanonico_: (t) => t,
    indiceCatalogo_: () => ({}),
    ventaCancelada_: (v) => v.cancelada === true,
    ventasPendientesSedeListar_: () => [{ creada_por: 'Delivery', cantidad: 3, primera_fecha: '2026-07-20', ultima_fecha: '2026-07-21' }],
    leerTabla_: (h) => {
      if (h === 'Ventas_FUDO') return [{ creacion: hoy, cancelada: false }, { creacion: hoy, cancelada: true }];
      if (h === 'Pagos_FUDO') return [{ fecha: hoy, cancelado: false }];
      if (h === 'Stock_FUDO_Base') return [
        { nombre_fudo: 'Coca nueva', importado_en: '2026-07-21T10:00:00', importado_por: 'Diana', fecha_base: '2026-07-21' },
        { nombre_fudo: 'Aceite', importado_en: '2026-07-20T10:00:00', importado_por: 'Diana', fecha_base: '2026-07-20' }
      ];
      if (h === 'Catalogo') return [{ nombre_estandar: 'Aceite' }];
      return [];
    },
    SHEET_NAMES: { VENTAS_FUDO: 'Ventas_FUDO', PAGOS_FUDO: 'Pagos_FUDO', STOCK_FUDO_BASE: 'Stock_FUDO_Base', CATALOGO: 'Catalogo' }
  });

  mod.fudoApiSyncRegistrar_('ventas', {
    ok: true, fecha_desde: '2026-07-21', fecha_hasta: '2026-07-21', usuario: 'Diana', importados: 10
  });
  const leido = mod.fudoApiSyncLeer_('ventas');
  assert.equal(leido.importados, 10);
  assert.equal(leido.usuario, 'Diana');

  const panel = mod.fudoApiEstadoPanel_();
  assert.equal(panel.ok, true);
  assert.equal(panel.credenciales_configuradas, true);
  assert.equal(panel.resumen_hoy.ventas_lineas, 1, 'solo la venta no cancelada de hoy');
  assert.equal(panel.ventas_pendientes_sede.grupos, 1);
  assert.equal(panel.productos_sin_catalogo.total, 1, 'Coca nueva no está en catálogo');
  assert.equal(panel.ultima_sincronizacion.ventas.importados, 10);
  console.log('fudoApiEstadoPanel_ y fudoApiSyncRegistrar_: OK');
})();

console.log('fudo-estado: OK');
