/**
 * REACTIVACIÓN POR MÓDULOS — Usuarios + Sincronización FUDO + Caja
 */
const ACCIONES_FUDO_PERMITIDAS_REACTIVACION_ = [
  'fudo_panel_estado',
  'fudo_api_probar_conexion',
  'fudo_api_sincronizar_ventas',
  'fudo_api_sincronizar_pagos'
];

const ACCIONES_CAJA_PERMITIDAS_REACTIVACION_ = [
  'caja_estado',
  'caja_abrir',
  'caja_movimiento_registrar',
  'caja_movimientos_listar',
  'caja_cerrar',
  'caja_sincronizar_ahora'
];

function accionPermitidaEnReactivacion_(action) {
  return !reactivacionBackendActiva_() ||
    ACCIONES_PERMITIDAS_REACTIVACION_BACKEND.indexOf(action) !== -1 ||
    ACCIONES_FUDO_PERMITIDAS_REACTIVACION_.indexOf(action) !== -1 ||
    ACCIONES_CAJA_PERMITIDAS_REACTIVACION_.indexOf(action) !== -1;
}

function cajaDiaAnteriorReactivacion_(fechaStr) {
  const p = String(fechaStr).slice(0, 10).split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Movimientos de custodia posteriores al último cierre DILANA y anteriores al nuevo turno. */
function cajaMovimientosPosterioresAlCierre_(ultimoCierre, fechaActual, sede) {
  if (!ultimoCierre) return [];
  const fechaCierre = formatearFecha_(ultimoCierre.fecha);
  const limiteFecha = formatearFecha_(fechaActual);
  const tsCierre = cajaFechaMs_(ultimoCierre.timestamp_cierre || ultimoCierre.hora_cierre);
  return leerTabla_(SHEET_NAMES.CAJA_MOVIMIENTOS).filter(function (m) {
    if (m.sede !== sede) return false;
    const fm = formatearFecha_(m.fecha);
    if (!fm || fm > limiteFecha || fm < fechaCierre) return false;
    if (fm > fechaCierre) return true;
    return cajaFechaMs_(m.timestamp || m.hora) > tsCierre;
  });
}

function cajaCustodiaEsperadaTrasCierre_(ultimoCierre, fechaActual, sede) {
  if (!ultimoCierre) {
    return { caja_operativa: 0, caja_fuerte: 0, total: 0, movimientos: [], resumen: cajaMovimientosResumen_([]) };
  }
  const movimientos = cajaMovimientosPosterioresAlCierre_(ultimoCierre, fechaActual, sede);
  const r = cajaMovimientosResumen_(movimientos);
  const base = Number(ultimoCierre.base_siguiente) || 0;
  const fuerte = Number(ultimoCierre.caja_fuerte_siguiente) || 0;
  const operativa = base + r.otros_ingresos + r.retiros_caja_fuerte - r.envios_caja_fuerte - r.entregas_admin_caja - r.gastos;
  const cajaFuerte = fuerte + r.envios_caja_fuerte - r.retiros_caja_fuerte - r.entregas_admin_caja_fuerte;
  return {
    caja_operativa: Number(operativa.toFixed(2)),
    caja_fuerte: Number(cajaFuerte.toFixed(2)),
    total: Number((operativa + cajaFuerte).toFixed(2)),
    movimientos: movimientos,
    resumen: r
  };
}

/** Apertura esperada = cierre DILANA anterior ajustado por movimientos posteriores. */
function cajaBaseEsperada_(fecha, sede) {
  const ultimo = cajaUltimoCierreAntes_(fecha, sede);
  if (!ultimo) return 0;
  return cajaCustodiaEsperadaTrasCierre_(ultimo, fecha, sede).caja_operativa;
}

function cajaSaldoFuerteAntes_(fecha, sede) {
  const ultimo = cajaUltimoCierreAntes_(fecha, sede);
  if (ultimo) return cajaCustodiaEsperadaTrasCierre_(ultimo, fecha, sede).caja_fuerte;
  const limite = new Date(fecha + 'T00:00:00').getTime();
  const movimientos = leerTabla_(SHEET_NAMES.CAJA_MOVIMIENTOS).filter(function (m) {
    return m.sede === sede && new Date(formatearFecha_(m.fecha) + 'T00:00:00').getTime() < limite;
  });
  const r = cajaMovimientosResumen_(movimientos);
  return Number((r.envios_caja_fuerte - r.retiros_caja_fuerte - r.entregas_admin_caja_fuerte).toFixed(2));
}

/**
 * Conciliación previa a la apertura:
 * - referencia FUDO del último cierre DILANA;
 * - cierre DILANA guardado;
 * - cierre DILANA recalculado con FUDO fresco;
 * - custodia esperada hoy después de movimientos posteriores al cierre.
 */
function cajaConciliacionApertura_(fecha, sede) {
  const fechaFmt = formatearFecha_(fecha);
  const ultimo = cajaUltimoCierreAntes_(fechaFmt, sede);
  const fechaReferencia = ultimo ? formatearFecha_(ultimo.fecha) : cajaDiaAnteriorReactivacion_(fechaFmt);
  const resumenFudo = typeof turnoResumenCierre_ === 'function'
    ? turnoResumenCierre_(fechaReferencia, sede)
    : { ok: true, pagos_efectivo_esperado: 0, pagos_fudo_total: 0, ventas_fudo_total: 0 };

  if (!ultimo) {
    const operativa = cajaBaseEsperada_(fechaFmt, sede);
    const fuerte = cajaSaldoFuerteAntes_(fechaFmt, sede);
    return {
      disponible: true,
      tiene_cierre_dilana: false,
      fecha_referencia: fechaReferencia,
      mensaje: 'No existe un cierre anterior de DILANA para comparar. FUDO se usa como referencia y el cajero confirma el dinero físico.',
      fudo: {
        ventas_total: Number(resumenFudo.ventas_fudo_total) || 0,
        pagos_total: Number(resumenFudo.pagos_fudo_total) || 0,
        efectivo: Number(resumenFudo.pagos_efectivo_esperado) || 0,
        descuentos: Number(resumenFudo.descuentos_total) || 0,
        propinas: Number(resumenFudo.propinas_total) || 0
      },
      dilana: null,
      custodia_esperada_hoy: { caja_operativa: operativa, caja_fuerte: fuerte, total: Number((operativa + fuerte).toFixed(2)) },
      cuadra_fudo_dilana: null,
      diferencia_fudo_dilana: null
    };
  }

  const recalculo = cajaEfectivoEsperado_(ultimo, cajaMovimientosDelDia_(fechaReferencia, sede), fechaReferencia, sede);
  const esperadoGuardado = Number(ultimo.efectivo_esperado) || 0;
  const diferenciaFudoDilana = Number((recalculo.esperado - esperadoGuardado).toFixed(2));
  const custodia = cajaCustodiaEsperadaTrasCierre_(ultimo, fechaFmt, sede);

  return {
    disponible: true,
    tiene_cierre_dilana: true,
    fecha_referencia: fechaReferencia,
    fudo: {
      ventas_total: Number(resumenFudo.ventas_fudo_total) || 0,
      pagos_total: Number(resumenFudo.pagos_fudo_total) || 0,
      efectivo: Number(recalculo.pagos_efectivo_esperado) || 0,
      efectivo_dia: Number(recalculo.pagos_efectivo_dia) || 0,
      descuentos: Number(resumenFudo.descuentos_total) || 0,
      propinas: Number(resumenFudo.propinas_total) || 0
    },
    dilana: {
      esperado_cierre_guardado: esperadoGuardado,
      esperado_cierre_con_fudo_actual: Number(recalculo.esperado) || 0,
      contado_cierre: Number(ultimo.efectivo_contado) || 0,
      diferencia_fisica_cierre: Number(ultimo.diferencia) || 0,
      caja_fuerte_esperada_cierre: Number(ultimo.caja_fuerte_esperada) || 0,
      caja_fuerte_contada_cierre: Number(ultimo.caja_fuerte_contada) || 0,
      diferencia_caja_fuerte_cierre: Number(ultimo.diferencia_caja_fuerte) || 0,
      base_siguiente: Number(ultimo.base_siguiente) || 0,
      caja_fuerte_siguiente: Number(ultimo.caja_fuerte_siguiente) || 0,
      usuario_cierre: ultimo.usuario_cierre || '',
      hora_cierre: ultimo.hora_cierre || ultimo.timestamp_cierre || ''
    },
    movimientos_posteriores: {
      cantidad: custodia.movimientos.length,
      entregado_personas: Number(custodia.resumen.entregas_administrador) || 0,
      enviado_caja_fuerte: Number(custodia.resumen.envios_caja_fuerte) || 0,
      retirado_caja_fuerte: Number(custodia.resumen.retiros_caja_fuerte) || 0,
      otros_ingresos: Number(custodia.resumen.otros_ingresos) || 0
    },
    custodia_esperada_hoy: { caja_operativa: custodia.caja_operativa, caja_fuerte: custodia.caja_fuerte, total: custodia.total },
    diferencia_fudo_dilana: diferenciaFudoDilana,
    cuadra_fudo_dilana: Math.abs(diferenciaFudoDilana) < 0.01,
    cuadra_fisico_cierre_anterior:
      Math.abs(Number(ultimo.diferencia) || 0) < 0.01 && Math.abs(Number(ultimo.diferencia_caja_fuerte) || 0) < 0.01
  };
}

/**
 * `caja_sincronizar_ahora` prepara también la apertura: sincroniza hoy y la fecha del último cierre
 * DILANA (o ayer si aún no existe historial), y devuelve la conciliación completa.
 */
function cajaSincronizarAhora_(fecha, sede, usuario) {
  if (!fecha || !sede) return { ok: false, error: 'Falta la fecha o la sede' };
  const fechaFmt = formatearFecha_(fecha);
  const syncActual = cajaSincronizarFudo_(fechaFmt, sede, usuario, true);
  const turnoActual = cajaTurnoFila_(fechaFmt, sede);
  let syncAnterior = null;
  let conciliacionApertura = null;

  if (!turnoActual) {
    const ultimo = cajaUltimoCierreAntes_(fechaFmt, sede);
    const fechaReferencia = ultimo ? formatearFecha_(ultimo.fecha) : cajaDiaAnteriorReactivacion_(fechaFmt);
    if (fechaReferencia && fechaReferencia !== fechaFmt) {
      syncAnterior = cajaSincronizarFudo_(fechaReferencia, sede, usuario, true);
    }
    conciliacionApertura = cajaConciliacionApertura_(fechaFmt, sede);
  }

  return {
    ok: !!syncActual.ok && (!syncAnterior || !!syncAnterior.ok),
    fecha: fechaFmt,
    sede: sede,
    sincronizacion_actual: syncActual,
    sincronizacion_anterior: syncAnterior,
    conciliacion_apertura: conciliacionApertura,
    error: !syncActual.ok ? (syncActual.error || 'No se pudo sincronizar FUDO para el día actual.') :
      (syncAnterior && !syncAnterior.ok ? (syncAnterior.error || 'No se pudo sincronizar FUDO para el cierre anterior.') : '')
  };
}

/** Sincronización financiera periódica exclusiva de la fase Caja: HOY + AYER. */
function fudoSincronizacionCajaAutomatica_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('FUDO_API_KEY') || !props.getProperty('FUDO_API_SECRET')) return { ok: true, omitida: 'sin_credenciales' };

  const hoy = new Date();
  const ayer = new Date(hoy.getTime());
  ayer.setDate(ayer.getDate() - 1);
  const fechaDesde = formatearFecha_(ayer);
  const fechaHasta = formatearFecha_(hoy);
  const usuarioAutomatico = { id: 'sistema-fudo', nombre: 'Sincronización automática FUDO', rol: 'Administrador', sede: 'Ambas' };
  const resultado = { ok: true, fecha_desde: fechaDesde, fecha_hasta: fechaHasta, ventas: null, pagos: null };

  try {
    resultado.ventas = fudoApiSincronizarVentas_(fechaDesde, fechaHasta, usuarioAutomatico, {});
    if (resultado.ventas && resultado.ventas.ok === false) resultado.ok = false;
  } catch (err) {
    resultado.ok = false;
    resultado.error_ventas = err && err.message ? err.message : String(err);
    Logger.log('fudoSincronizacionCajaAutomatica_ (ventas) falló: ' + resultado.error_ventas);
    if (typeof fudoApiSyncRegistrar_ === 'function') fudoApiSyncRegistrar_('ventas', { ok:false, fecha_desde:fechaDesde, fecha_hasta:fechaHasta, usuario:usuarioAutomatico.nombre, error:resultado.error_ventas });
  }

  try {
    resultado.pagos = fudoApiSincronizarPagos_(fechaDesde, fechaHasta, usuarioAutomatico, {});
    if (resultado.pagos && resultado.pagos.ok === false) resultado.ok = false;
  } catch (err) {
    resultado.ok = false;
    resultado.error_pagos = err && err.message ? err.message : String(err);
    Logger.log('fudoSincronizacionCajaAutomatica_ (pagos) falló: ' + resultado.error_pagos);
    if (typeof fudoApiSyncRegistrar_ === 'function') fudoApiSyncRegistrar_('pagos', { ok:false, fecha_desde:fechaDesde, fecha_hasta:fechaHasta, usuario:usuarioAutomatico.nombre, error:resultado.error_pagos });
  }
  return resultado;
}

/** Durante reactivación crea SOLO el trigger financiero FUDO cada 15 minutos. */
function configurarTriggers() {
  let eliminados = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'tareaDiaria_' || fn === 'fudoSincronizacionAutomatica_' || fn === 'fudoSincronizacionCajaAutomatica_') {
      ScriptApp.deleteTrigger(t); eliminados++;
    }
  });
  if (reactivacionBackendActiva_()) {
    ScriptApp.newTrigger('fudoSincronizacionCajaAutomatica_').timeBased().everyMinutes(15).create();
    return { reactivacion:true, creados:1, eliminados:eliminados, handler:'fudoSincronizacionCajaAutomatica_' };
  }
  ScriptApp.newTrigger('tareaDiaria_').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('fudoSincronizacionAutomatica_').timeBased().everyMinutes(15).create();
  return { reactivacion:false, creados:2, eliminados:eliminados };
}

function requiereRol_(usuario, rolesPermitidos) {
  const equivalencias = { Caja:'Encargado', Gerencia:'Lectura' };
  const rolEfectivo = equivalencias[usuario.rol] || usuario.rol;
  if (rolesPermitidos.indexOf(usuario.rol) === -1 && rolesPermitidos.indexOf(rolEfectivo) === -1) {
    throw new Error('Esta acción requiere uno de estos roles: ' + rolesPermitidos.join(', '));
  }
}

function cajaPuedeCerrar_(usuario, fecha) {
  return usuario.rol === 'Administrador' || usuario.rol === 'Caja' || usuario.rol === 'Encargado';
}
