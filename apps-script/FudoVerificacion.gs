/**
 * FUDO — VERIFICACIÓN CONTROLADA DURANTE FASE 0
 *
 * Ejecutar MANUALMENTE desde el editor de Apps Script:
 *   fudoVerificarSincronizacionFase0_()
 *
 * Objetivo: comprobar la conexión y los flujos reales de FUDO sin reactivar el módulo FUDO en la
 * Web App y sin crear triggers. La función sincroniza de forma idempotente HOY + AYER para ventas y
 * pagos, actualiza el snapshot consolidado de stock, y compara el catálogo SOLO EN LECTURA.
 *
 * NO hace:
 * - no llama configurarTriggers();
 * - no activa fudoSincronizacionAutomatica_();
 * - no modifica el catálogo desde FUDO;
 * - no hace PATCH de nombres hacia FUDO;
 * - no habilita ninguna action del router HTTP.
 */

function fudoVerificacionConteos_() {
  return {
    ventas_flat: leerTabla_(SHEET_NAMES.VENTAS_FUDO).length,
    ventas: leerTabla_(SHEET_NAMES.FUDO_VENTAS).length,
    items: leerTabla_(SHEET_NAMES.FUDO_ITEMS).length,
    pagos_flat: leerTabla_(SHEET_NAMES.PAGOS_FUDO).length,
    pagos: leerTabla_(SHEET_NAMES.FUDO_PAGOS).length,
    descuentos: leerTabla_(SHEET_NAMES.FUDO_DESCUENTOS).length,
    propinas: leerTabla_(SHEET_NAMES.FUDO_PROPINAS).length,
    subitems: leerTabla_(SHEET_NAMES.FUDO_SUBITEMS).length,
    stock_base: leerTabla_(SHEET_NAMES.STOCK_FUDO_BASE).length
  };
}

function fudoVerificacionDiferencias_(antes, despues) {
  const out = {};
  Object.keys(despues || {}).forEach(function (k) {
    out[k] = (Number(despues[k]) || 0) - (Number(antes && antes[k]) || 0);
  });
  return out;
}

function fudoVerificacionResumirSonda_(respuesta) {
  if (!respuesta) return { ok: false, error: 'Sin respuesta' };
  if (respuesta.error) return { ok: false, error: respuesta.error };
  const data = Array.isArray(respuesta) ? respuesta : (Array.isArray(respuesta.data) ? respuesta.data : []);
  const incluidos = Array.isArray(respuesta.included) ? respuesta.included : [];
  const tipos = {};
  incluidos.forEach(function (r) {
    if (r && r.type) tipos[r.type] = (tipos[r.type] || 0) + 1;
  });
  return {
    ok: true,
    registros_muestra: data.length,
    tipos_incluidos: tipos
  };
}

function fudoVerificacionSondas_() {
  return {
    ventas: fudoVerificacionResumirSonda_(fudoApiProbarConexionRecursoSeguro_('sales', {
      pageSize: 1,
      orden: '-id',
      include: FUDO_API_SALES_INCLUDE_,
      campos: { cashRegister: 'name' }
    })),
    pagos: fudoVerificacionResumirSonda_(fudoApiProbarConexionRecursoSeguro_('payments', {
      pageSize: 1,
      orden: '-id',
      include: 'paymentMethod,sale'
    })),
    productos: fudoVerificacionResumirSonda_(fudoApiProbarConexionRecursoSeguro_('products', {
      pageSize: 1,
      include: 'unit'
    })),
    ingredientes: fudoVerificacionResumirSonda_(fudoApiProbarConexionRecursoSeguro_('ingredients', {
      pageSize: 1,
      include: 'unit'
    })),
    salas: fudoVerificacionResumirSonda_(fudoApiProbarConexionRecursoSeguro_('rooms', {
      pageSize: 10
    })),
    usuarios_fudo: fudoVerificacionResumirSonda_(fudoApiProbarConexionRecursoSeguro_('users', {
      pageSize: 10,
      include: 'role,tablesCashRegister,deliveryCashRegister,takeAwayCashRegister'
    })),
    gastos: fudoVerificacionResumirSonda_(fudoApiProbarConexionRecursoSeguro_('expenses', {
      pageSize: 5,
      orden: '-date',
      include: 'cashRegister,paymentMethod',
      campos: {
        expense: 'amount,canceled,createdAt,date,description,dueDate,paymentDate,receiptNumber,status,useInCashCount,cashRegister,paymentMethod',
        cashRegister: 'name'
      }
    })),
    metodos_pago: fudoVerificacionResumirSonda_(fudoApiProbarConexionRecursoSeguro_('payment-methods', {
      pageSize: 20
    })),
    mesas: fudoVerificacionResumirSonda_(fudoApiProbarConexionRecursoSeguro_('tables', {
      pageSize: 20,
      include: 'activeSales,activeSales.payments,activeSales.tips,room'
    }))
  };
}

function fudoVerificacionTriggers_() {
  const handlers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  const operativos = handlers.filter(function (fn) {
    return fn === 'tareaDiaria_' || fn === 'fudoSincronizacionAutomatica_';
  });
  return {
    handlers: handlers,
    operativos_activos: operativos,
    ok_fase_0: operativos.length === 0
  };
}

function fudoVerificarSincronizacionFase0_() {
  const ahora = new Date();
  const ayerDate = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
  const fechaHasta = formatearFecha_(ahora);
  const fechaDesde = formatearFecha_(ayerDate);
  const usuario = { nombre: 'Verificación manual FUDO — Fase 0' };
  const props = PropertiesService.getScriptProperties();
  const credenciales = !!(props.getProperty(FUDO_API_PROP_KEY_) && props.getProperty(FUDO_API_PROP_SECRET_));

  const informe = {
    ok: false,
    modo: 'FASE_0_VERIFICACION_MANUAL',
    periodo: { desde: fechaDesde, hasta: fechaHasta },
    credenciales_configuradas: credenciales,
    triggers: fudoVerificacionTriggers_(),
    automatizacion_reactivada: false,
    advertencias: [
      'La sincronización automática permanece apagada durante Fase 0.',
      'Stock_FUDO_Base es referencia consolidada de FUDO, no inventario oficial por sede.',
      'Gastos, mesas, salas, usuarios y métodos de pago se verifican como recursos de API; no se persisten como módulos operativos en esta función.',
      'Catálogo se compara en solo lectura; esta verificación no crea, vincula ni renombra productos.'
    ]
  };

  if (!credenciales) {
    informe.error = 'No hay credenciales FUDO configuradas en Propiedades del Script.';
    Logger.log(JSON.stringify(informe));
    return informe;
  }

  informe.sondas = fudoVerificacionSondas_();
  informe.antes = fudoVerificacionConteos_();

  try {
    informe.sincronizacion_ventas = fudoApiSincronizarVentas_(fechaDesde, fechaHasta, usuario, {});
  } catch (err) {
    informe.sincronizacion_ventas = { ok: false, error: err.message };
  }

  try {
    informe.sincronizacion_pagos = fudoApiSincronizarPagos_(fechaDesde, fechaHasta, usuario, {});
  } catch (err) {
    informe.sincronizacion_pagos = { ok: false, error: err.message };
  }

  try {
    informe.snapshot_stock = fudoApiTomarSnapshotStock_(usuario);
  } catch (err) {
    informe.snapshot_stock = { ok: false, error: err.message };
  }

  try {
    const comparacion = catalogoCompararConFudo_();
    informe.catalogo_solo_lectura = comparacion && comparacion.resumen
      ? comparacion.resumen
      : { ok: comparacion && comparacion.ok !== false };
  } catch (err) {
    informe.catalogo_solo_lectura = { ok: false, error: err.message };
  }

  informe.despues = fudoVerificacionConteos_();
  informe.diferencias = fudoVerificacionDiferencias_(informe.antes, informe.despues);

  try {
    const pendientes = ventasPendientesSedeListar_();
    informe.ventas_sin_sede = {
      grupos: pendientes.length,
      lineas: pendientes.reduce(function (acc, p) { return acc + (Number(p.cantidad) || 0); }, 0),
      muestra: pendientes.slice(0, 10)
    };
  } catch (err) {
    informe.ventas_sin_sede = { error: err.message };
  }

  const ventasOk = informe.sincronizacion_ventas && informe.sincronizacion_ventas.ok !== false;
  const pagosOk = informe.sincronizacion_pagos && informe.sincronizacion_pagos.ok !== false;
  const stockOk = informe.snapshot_stock && informe.snapshot_stock.ok !== false;
  const sondasCriticas = ['ventas', 'pagos', 'productos', 'ingredientes'];
  const sondasOk = sondasCriticas.every(function (k) {
    return informe.sondas[k] && informe.sondas[k].ok === true;
  });

  informe.ok = !!(ventasOk && pagosOk && stockOk && sondasOk);
  Logger.log(JSON.stringify(informe));
  return informe;
}
