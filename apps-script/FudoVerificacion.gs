/**
 * FUDO — VERIFICACIÓN CONTROLADA DURANTE FASE 0
 *
 * Ejecutar MANUALMENTE desde el editor de Apps Script:
 *   fudoVerificarSincronizacionFase0_()
 *
 * Objetivo: comprobar la conexión y los flujos reales de FUDO sin reactivar el módulo FUDO en la
 * Web App y sin crear triggers. La función sincroniza de forma idempotente HOY + AYER para ventas y
 * pagos, actualiza el snapshot consolidado de stock, compara el catálogo SOLO EN LECTURA y prueba
 * las 18 familias de recursos publicadas en el OpenAPI de FUDO versionado con DILANA OS.
 *
 * NO hace:
 * - no llama configurarTriggers();
 * - no activa fudoSincronizacionAutomatica_();
 * - no modifica el catálogo desde FUDO;
 * - no hace PATCH de nombres hacia FUDO;
 * - no habilita ninguna action del router HTTP.
 */

const FUDO_VERIFICACION_RECURSOS_OPENAPI_ = [
  'customers',
  'discounts',
  'expenses',
  'expense-categories',
  'ingredients',
  'items',
  'kitchens',
  'payments',
  'payment-methods',
  'product-categories',
  'product-modifiers',
  'products',
  'providers',
  'roles',
  'rooms',
  'sales',
  'subitems',
  'tables',
  'users'
];

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

function fudoVerificacionSondaSimple_(recurso, opciones) {
  return fudoVerificacionResumirSonda_(
    fudoApiProbarConexionRecursoSeguro_(recurso, opciones || { pageSize: 1 })
  );
}

function fudoVerificacionSondas_() {
  return {
    customers: fudoVerificacionSondaSimple_('customers', { pageSize: 2, orden: '-id' }),
    discounts: fudoVerificacionSondaSimple_('discounts', { pageSize: 2, orden: '-id' }),
    expenses: fudoVerificacionSondaSimple_('expenses', {
      pageSize: 5,
      orden: '-date',
      include: 'cashRegister,paymentMethod',
      campos: {
        expense: 'amount,canceled,createdAt,date,description,dueDate,paymentDate,receiptNumber,status,useInCashCount,cashRegister,paymentMethod',
        cashRegister: 'name'
      }
    }),
    expense_categories: fudoVerificacionSondaSimple_('expense-categories', { pageSize: 5 }),
    ingredients: fudoVerificacionSondaSimple_('ingredients', { pageSize: 2, include: 'unit' }),
    items: fudoVerificacionSondaSimple_('items', { pageSize: 2, orden: '-id' }),
    kitchens: fudoVerificacionSondaSimple_('kitchens', { pageSize: 5 }),
    payments: fudoVerificacionSondaSimple_('payments', {
      pageSize: 2,
      orden: '-id',
      include: 'paymentMethod,sale'
    }),
    payment_methods: fudoVerificacionSondaSimple_('payment-methods', { pageSize: 20 }),
    product_categories: fudoVerificacionSondaSimple_('product-categories', { pageSize: 20 }),
    product_modifiers: fudoVerificacionSondaSimple_('product-modifiers', { pageSize: 20 }),
    products: fudoVerificacionSondaSimple_('products', { pageSize: 2, include: 'unit' }),
    providers: fudoVerificacionSondaSimple_('providers', { pageSize: 10 }),
    roles: fudoVerificacionSondaSimple_('roles', { pageSize: 10 }),
    rooms: fudoVerificacionSondaSimple_('rooms', { pageSize: 10 }),
    sales: fudoVerificacionSondaSimple_('sales', {
      pageSize: 2,
      orden: '-id',
      include: FUDO_API_SALES_INCLUDE_,
      campos: { cashRegister: 'name' }
    }),
    subitems: fudoVerificacionSondaSimple_('subitems', { pageSize: 2, orden: '-id' }),
    tables: fudoVerificacionSondaSimple_('tables', {
      pageSize: 20,
      include: 'activeSales,activeSales.payments,activeSales.tips,room'
    }),
    users: fudoVerificacionSondaSimple_('users', {
      pageSize: 10,
      include: 'role,tablesCashRegister,deliveryCashRegister,takeAwayCashRegister'
    })
  };
}

function fudoVerificacionResumenSondas_(sondas) {
  const nombres = Object.keys(sondas || {});
  const exitosos = nombres.filter(function (k) { return sondas[k] && sondas[k].ok === true; });
  const fallidos = nombres.filter(function (k) { return !sondas[k] || sondas[k].ok !== true; });
  return {
    recursos_esperados: FUDO_VERIFICACION_RECURSOS_OPENAPI_.length,
    recursos_probados: nombres.length,
    exitosos: exitosos.length,
    fallidos: fallidos.length,
    recursos_fallidos: fallidos,
    todos_accesibles: nombres.length === FUDO_VERIFICACION_RECURSOS_OPENAPI_.length && fallidos.length === 0
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
    integracion_completa: false,
    modo: 'FASE_0_VERIFICACION_MANUAL',
    periodo: { desde: fechaDesde, hasta: fechaHasta },
    credenciales_configuradas: credenciales,
    triggers: fudoVerificacionTriggers_(),
    automatizacion_reactivada: false,
    cobertura_persistente_actual: {
      sincronizacion_principal: ['sales', 'payments', 'products', 'ingredients'],
      derivados_de_sales: ['items', 'discounts', 'tips', 'subitems'],
      solo_consulta_diagnostico: ['customers', 'expenses', 'expense-categories', 'kitchens', 'payment-methods', 'product-categories', 'product-modifiers', 'providers', 'roles', 'rooms', 'tables', 'users'],
      nota: 'Los recursos de solo consulta se prueban contra la API, pero DILANA OS aún no tiene persistencia completa para ellos.'
    },
    advertencias: [
      'La sincronización automática permanece apagada durante Fase 0.',
      'Stock_FUDO_Base es referencia consolidada de FUDO, no inventario oficial por sede.',
      'La disponibilidad de un endpoint no significa que DILANA OS ya persista todos sus campos.',
      'Catálogo se compara en solo lectura; esta verificación no crea, vincula ni renombra productos.'
    ]
  };

  if (!credenciales) {
    informe.error = 'No hay credenciales FUDO configuradas en Propiedades del Script.';
    Logger.log(JSON.stringify(informe));
    return informe;
  }

  informe.sondas = fudoVerificacionSondas_();
  informe.resumen_sondas = fudoVerificacionResumenSondas_(informe.sondas);
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
  const sondasCriticas = ['sales', 'payments', 'products', 'ingredients'];
  const sondasCriticasOk = sondasCriticas.every(function (k) {
    return informe.sondas[k] && informe.sondas[k].ok === true;
  });

  informe.ok = !!(ventasOk && pagosOk && stockOk && sondasCriticasOk);
  // "integracion_completa" exige además que las 19 colecciones probadas sean accesibles, pero
  // seguirá siendo false a nivel funcional mientras haya recursos marcados como solo consulta.
  informe.integracion_completa = !!(
    informe.ok &&
    informe.resumen_sondas &&
    informe.resumen_sondas.todos_accesibles &&
    informe.cobertura_persistente_actual.solo_consulta_diagnostico.length === 0
  );

  Logger.log(JSON.stringify(informe));
  return informe;
}
