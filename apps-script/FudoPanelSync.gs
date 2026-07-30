/**
 * ESTADO Y PANEL DE SINCRONIZACIÓN FUDO (antes FudoEstado.gs)
 *
 * Si ves "FUDO_SYNC_PROP_VENTAS_ has already been declared" en Apps Script:
 * borra el archivo viejo "FudoEstado" del editor (menú ⋮ → Eliminar) y vuelve a
 * hacer clasp push — no pegues este código a mano en otro archivo.
 */

var FUDO_PANEL_SYNC_PROP_VENTAS_ = 'FUDO_SYNC_ULTIMA_VENTAS';
var FUDO_PANEL_SYNC_PROP_PAGOS_ = 'FUDO_SYNC_ULTIMA_PAGOS';
var FUDO_PANEL_SYNC_PROP_STOCK_ = 'FUDO_SYNC_ULTIMA_STOCK';
var FUDO_PANEL_SYNC_PROP_CATALOGO_ = 'FUDO_SYNC_ULTIMA_CATALOGO';
var FUDO_PANEL_SYNC_PROP_CATALOGO_PUSH_ = 'FUDO_SYNC_ULTIMA_CATALOGO_PUSH';

function fudoApiSyncPropKey_(tipo) {
  if (tipo === 'ventas') return FUDO_PANEL_SYNC_PROP_VENTAS_;
  if (tipo === 'pagos') return FUDO_PANEL_SYNC_PROP_PAGOS_;
  if (tipo === 'stock') return FUDO_PANEL_SYNC_PROP_STOCK_;
  if (tipo === 'catalogo') return FUDO_PANEL_SYNC_PROP_CATALOGO_;
  if (tipo === 'catalogo_push') return FUDO_PANEL_SYNC_PROP_CATALOGO_PUSH_;
  return null;
}

/** Guarda el resultado de una sincronización — llamado desde FudoApi.gs tras cada sync. */
function fudoApiSyncRegistrar_(tipo, payload) {
  const key = fudoApiSyncPropKey_(tipo);
  if (!key) return;
  const datos = Object.assign({
    tipo: tipo,
    timestamp: new Date().toISOString()
  }, payload || {});
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(datos));
}

function fudoApiSyncLeer_(tipo) {
  const key = fudoApiSyncPropKey_(tipo);
  if (!key) return null;
  const raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

/**
 * Nombres en Stock_FUDO_Base que no calzan con ningún producto del catálogo (ni por alias).
 * Referencia para detectar productos nuevos en Fudo — no bloquea nada.
 */
function fudoProductosFudoSinCatalogo_(limite) {
  limite = limite || 15;
  const indice = indiceCatalogo_();
  const vistos = {};
  const sinCatalogo = [];
  leerTabla_(SHEET_NAMES.STOCK_FUDO_BASE).forEach(function (r) {
    if (!r.nombre_fudo) return;
    const n = normalizar_(r.nombre_fudo);
    if (vistos[n]) return;
    vistos[n] = true;
    const clave = claveProducto_(r.nombre_fudo, indice);
    const existe = leerTabla_(SHEET_NAMES.CATALOGO).some(function (c) {
      return claveProducto_(c.nombre_estandar || c.producto, indice) === clave;
    });
    if (!existe) sinCatalogo.push(r.nombre_fudo);
  });
  return { total: sinCatalogo.length, muestra: sinCatalogo.slice(0, limite) };
}

/** Resumen para fudo.html — solo lectura, no ejecuta sync. */
function fudoApiEstadoPanel_() {
  if (typeof conCacheDeTablas_ === 'function') {
    return conCacheDeTablas_(fudoApiEstadoPanelSinCache_);
  }
  return fudoApiEstadoPanelSinCache_();
}

function fudoApiEstadoPanelSinCache_() {
  const props = PropertiesService.getScriptProperties();
  const tieneCredenciales = !!(props.getProperty('FUDO_API_KEY') && props.getProperty('FUDO_API_SECRET'));

  const hoy = formatearFecha_(new Date());
  const ventasHoyData = typeof ventasFudoLineasParaFecha_ === 'function'
    ? ventasFudoLineasParaFecha_(hoy, { sin_canceladas: true })
    : { lineas: leerTabla_(SHEET_NAMES.VENTAS_FUDO).filter(function (v) {
      return formatearFecha_(v.creacion) === hoy && !ventaCancelada_(v);
    }), fuente: 'Ventas_FUDO' };
  const pagosHoyData = typeof pagosFudoCantidadFecha_ === 'function'
    ? pagosFudoCantidadFecha_(hoy)
    : { registros: leerTabla_(SHEET_NAMES.PAGOS_FUDO).filter(function (p) {
      return formatearFecha_(p.fecha) === hoy && !(p.cancelado === true || normalizar_(p.cancelado) === 'si');
    }).length, fuente: 'Pagos_FUDO' };

  const pendientes = typeof ventasPendientesSedeListar_ === 'function' ? ventasPendientesSedeListar_() : [];
  const lineasPendientes = pendientes.reduce(function (acc, g) { return acc + (Number(g.cantidad) || 0); }, 0);

  const stockBase = leerTabla_(SHEET_NAMES.STOCK_FUDO_BASE);
  let ultimoStockImport = null;
  stockBase.forEach(function (r) {
    const ts = r.importado_en ? new Date(r.importado_en).getTime() : 0;
    if (!ultimoStockImport || ts > ultimoStockImport.ts) {
      ultimoStockImport = {
        fecha_base: r.fecha_base ? formatearFecha_(r.fecha_base) : '',
        importado_en: r.importado_en,
        importado_por: r.importado_por || '',
        ts: ts
      };
    }
  });

  const sinCatalogo = fudoProductosFudoSinCatalogo_(15);

  return {
    ok: true,
    credenciales_configuradas: tieneCredenciales,
    ultima_sincronizacion: {
      ventas: fudoApiSyncLeer_('ventas'),
      pagos: fudoApiSyncLeer_('pagos'),
      stock: fudoApiSyncLeer_('stock'),
      catalogo: fudoApiSyncLeer_('catalogo'),
      catalogo_push: fudoApiSyncLeer_('catalogo_push')
    },
    resumen_hoy: {
      fecha: hoy,
      ventas_lineas: ventasHoyData.lineas.length,
      pagos_registros: pagosHoyData.registros,
      fuente_ventas: ventasHoyData.fuente,
      fuente_pagos: pagosHoyData.fuente
    },
    ventas_pendientes_sede: {
      grupos: pendientes.length,
      lineas: lineasPendientes,
      detalle: pendientes.slice(0, 8)
    },
    stock_fudo_base: {
      productos: stockBase.length,
      ultimo_import: ultimoStockImport
    },
    productos_sin_catalogo: sinCatalogo,
    ventas_normalizadas: typeof fudoVentasEstado_ === 'function' ? fudoVentasEstado_() : null,
    pagos_normalizados: typeof fudoPagosEstado_ === 'function' ? fudoPagosEstado_() : null,
    descuentos_propinas: typeof fudoDescuentosPropinasEstado_ === 'function' ? fudoDescuentosPropinasEstado_() : null,
    subitems_normalizados: typeof fudoSubitemsEstado_ === 'function' ? fudoSubitemsEstado_() : null
  };
}
