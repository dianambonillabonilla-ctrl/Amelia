/**
 * REACTIVACIÓN POR MÓDULOS — Usuarios + Sincronización FUDO + Caja
 *
 * Este archivo extiende temporalmente funciones del backend histórico mientras Caja termina de
 * migrarse. Además de habilitar los módulos aprobados, separa explícitamente los movimientos que
 * pertenecen AL turno de los movimientos físicos de custodia hechos antes de abrir o después de
 * cerrar. Esa separación evita dos errores graves: descontar dos veces una entrega pre-apertura y
 * confundir una entrega post-cierre con un cambio posterior de FUDO.
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

/**
 * Solo movimientos ocurridos dentro de la ventana real del turno.
 *
 * - Lo registrado antes de hora_apertura pertenece a la custodia que llegó al turno, no a su
 *   operación: ya quedó absorbido por base_inicial/caja_fuerte_inicial.
 * - Lo registrado después de timestamp_cierre pertenece a la custodia del siguiente turno.
 *
 * Filas históricas sin timestamp confiable se conservan por compatibilidad.
 */
function cajaMovimientosVentanaTurno_(turno, movimientos) {
  if (!turno) return movimientos || [];
  const desde = cajaFechaMs_(turno.hora_apertura);
  const hasta = turno.estado === 'Cerrado' ? cajaFechaMs_(turno.timestamp_cierre || turno.hora_cierre) : 0;
  return (movimientos || []).filter(function (m) {
    const ts = cajaFechaMs_(m.timestamp || m.hora);
    if (!ts) return true;
    if (desde && ts < desde) return false;
    if (hasta && ts > hasta) return false;
    return true;
  });
}

/**
 * Versión de cálculo de Caja consciente de la ventana del turno. Mantiene la fórmula histórica,
 * pero evita que entregas de custodia anteriores/posteriores al turno entren en el cuadre operativo.
 */
function cajaEfectivoEsperado_(apertura, movimientos, fecha, sede) {
  const movimientosTurno = cajaMovimientosVentanaTurno_(apertura, movimientos);
  const r = cajaMovimientosResumen_(movimientosTurno);
  const efectivoFudoActual = cajaEfectivoFudoDia_(fecha, sede);
  const efectivoFudoTurno = Math.max(0, efectivoFudoActual - (Number(apertura.efectivo_fudo_al_abrir) || 0));
  const esperado = Number(apertura.base_inicial || 0) + efectivoFudoTurno + r.otros_ingresos + r.retiros_caja_fuerte - r.envios_caja_fuerte - r.entregas_admin_caja - r.gastos;
  const fuerte = Number(apertura.caja_fuerte_inicial || 0) + r.envios_caja_fuerte - r.retiros_caja_fuerte - r.entregas_admin_caja_fuerte;
  return {
    esperado: Number(esperado.toFixed(2)),
    caja_fuerte_esperada: Number(fuerte.toFixed(2)),
    pagos_efectivo_esperado: Number(efectivoFudoTurno.toFixed(2)),
    pagos_efectivo_dia: Number(efectivoFudoActual.toFixed(2)),
    resumen: r
  };
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

/**
 * Cierre de custodia que sirve de referencia en ESTE instante.
 * Si el turno del mismo día ya está cerrado, ese cierre manda; si aún no existe turno, se usa el
 * último cierre anterior. Un turno abierto se calcula con su propia ventana y no entra aquí.
 */
function cajaCierreReferenciaCustodia_(fecha, sede) {
  const turnoDia = cajaTurnoFila_(fecha, sede);
  if (turnoDia && turnoDia.estado === 'Cerrado') return turnoDia;
  if (!turnoDia) return cajaUltimoCierreAntes_(fecha, sede);
  return null;
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

function cajaAsegurarColumnasCustodia_() {
  asegurarColumnas_(sheet_(SHEET_NAMES.CAJA_MOVIMIENTOS), [
    'turno_id','estado_turno_al_registrar','fuera_de_turno','saldo_validado','saldo_origen_antes'
  ]);
}

/**
 * Entregas a personas pueden ocurrir antes de abrir, durante el turno o después de cerrar.
 *
 * Cuando existe una custodia conocida (un cierre previo), una entrega fuera de turno también se
 * valida contra el saldo disponible del origen; no tiene sentido permitir sacar $1.000.000 de una
 * caja fuerte que DILANA sabe que tiene $100.000. Si no existe ningún cierre histórico todavía, la
 * entrega se permite pero queda marcada saldo_validado=false para que el primer conteo físico sea
 * quien establezca la realidad.
 */
function cajaMovimientoRegistrar_(item, usuario) {
  cajaAsegurarEstructura_();
  cajaAsegurarColumnasCustodia_();
  if (!item || !item.fecha || !item.sede) return { ok:false, error:'Falta fecha o sede' };
  if (!sedeEscrituraPermitida_(usuario, item.sede)) return { ok:false, error:'No puedes registrar movimientos de otra sede' };
  const fecha = formatearFecha_(item.fecha);
  if (CAJA_TIPOS_MOVIMIENTO_.indexOf(item.tipo) === -1) return { ok:false, error:'Tipo de movimiento inválido' };
  const valor = Number(item.valor);
  if (!valor || valor <= 0) return { ok:false, error:'El valor debe ser mayor a cero' };
  if (!String(item.motivo || '').trim()) return { ok:false, error:'Falta el motivo' };

  const esEntrega = String(item.tipo).indexOf('Entrega administrador') === 0;
  if (esEntrega && (!String(item.persona_entrega || '').trim() || !String(item.persona_recibe || '').trim())) {
    return { ok:false, error:'La entrega necesita quién entrega y quién recibe' };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok:false, error:'Otro movimiento se está guardando ahora mismo — espera un momento y vuelve a intentarlo.' };
  }
  try {
    const turnoDia = cajaTurnoFila_(fecha, item.sede);
    const cajaAbiertaAhora = !!turnoDia && turnoDia.estado === 'Abierto';
    if (!esEntrega && !cajaAbiertaAhora) return { ok:false, error:'La caja no está abierta' };

    const movimientosActuales = cajaMovimientosDelDia_(fecha, item.sede);
    if (item.idempotency_key) {
      const repetido = movimientosActuales.find(function (m) {
        return m.idempotency_key && m.idempotency_key === item.idempotency_key;
      });
      if (repetido) return { ok:true, item:repetido, fuera_de_turno:repetido.fuera_de_turno === true };
    }

    let fueraDeTurno = !cajaAbiertaAhora;
    let saldoValidado = true;
    let saldoOrigenAntes = null;
    let turnoReferencia = turnoDia;

    if (cajaAbiertaAhora) {
      const calculo = cajaEfectivoEsperado_(turnoDia, movimientosActuales, fecha, item.sede);
      if (CAJA_TIPOS_RESTAN_OPERATIVA_.indexOf(item.tipo) !== -1) {
        saldoOrigenAntes = calculo.esperado;
        if (valor > saldoOrigenAntes) return { ok:false, error:'No puedes registrar este movimiento: excede el efectivo disponible en la caja operativa en este momento.' };
      }
      if (CAJA_TIPOS_RESTAN_FUERTE_.indexOf(item.tipo) !== -1) {
        saldoOrigenAntes = calculo.caja_fuerte_esperada;
        if (valor > saldoOrigenAntes) return { ok:false, error:'No puedes registrar este movimiento: excede lo disponible en la caja fuerte en este momento.' };
      }
    } else if (esEntrega) {
      turnoReferencia = cajaCierreReferenciaCustodia_(fecha, item.sede);
      if (turnoReferencia) {
        const custodia = cajaCustodiaEsperadaTrasCierre_(turnoReferencia, fecha, item.sede);
        if (item.tipo === 'Entrega administrador desde caja fuerte') saldoOrigenAntes = custodia.caja_fuerte;
        else saldoOrigenAntes = custodia.caja_operativa;
        if (valor > saldoOrigenAntes) {
          const origenTexto = item.tipo === 'Entrega administrador desde caja fuerte' ? 'caja fuerte' : 'caja operativa';
          return { ok:false, error:'No puedes registrar la entrega: excede el dinero que DILANA tiene bajo custodia en ' + origenTexto + ' (' + saldoOrigenAntes + ').' };
        }
      } else {
        saldoValidado = false;
      }
    }

    const estadoTurno = cajaAbiertaAhora ? 'Abierto' : (turnoDia && turnoDia.estado === 'Cerrado' ? 'Cerrado' : 'Sin abrir');
    const fila = {
      id: Utilities.getUuid(),
      fecha: fecha,
      sede: item.sede,
      tipo: item.tipo,
      valor: valor,
      persona_entrega: item.persona_entrega || usuario.nombre,
      persona_recibe: item.persona_recibe || '',
      hora: new Date(),
      motivo: item.motivo,
      evidencia_url: item.evidencia_url || '',
      idempotency_key: item.idempotency_key || '',
      usuario_id: usuario.id,
      usuario: usuario.nombre,
      timestamp: new Date(),
      turno_id: turnoReferencia && turnoReferencia.id ? turnoReferencia.id : '',
      estado_turno_al_registrar: estadoTurno,
      fuera_de_turno: fueraDeTurno,
      saldo_validado: saldoValidado,
      saldo_origen_antes: saldoOrigenAntes === null ? '' : saldoOrigenAntes
    };
    appendRowFromObj_(SHEET_NAMES.CAJA_MOVIMIENTOS, fila);
    auditoriaRegistrar_(usuario, 'caja_movimiento_registrar', 'CajaMovimientos', fila.id, null, {
      tipo:fila.tipo, valor:fila.valor, fuera_de_turno:fueraDeTurno,
      estado_turno:estadoTurno, saldo_validado:saldoValidado, saldo_origen_antes:fila.saldo_origen_antes
    }, item.sede, item.motivo);
    return {
      ok:true,
      item:fila,
      fuera_de_turno:fueraDeTurno,
      saldo_validado:saldoValidado,
      saldo_origen_antes:saldoOrigenAntes
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Conciliación previa a la apertura:
 * - referencia FUDO del último cierre DILANA;
 * - cierre DILANA guardado;
 * - cierre DILANA recalculado con FUDO fresco SOLO con movimientos pertenecientes a ese turno;
 * - custodia esperada hoy después de movimientos posteriores al cierre.
 */
function cajaConciliacionApertura_(fecha, sede) {
  const fechaFmt = formatearFecha_(fecha);
  const ultimo = cajaUltimoCierreAntes_(fechaFmt, sede);
  const fechaReferencia = ultimo ? formatearFecha_(ultimo.fecha) : cajaDiaAnteriorReactivacion_(fechaFmt);
  const resumenFudo = typeof turnoResumenCierre_ === 'function'
    ? turnoResumenCierre_(fechaReferencia, sede)
    : { ok:true, pagos_efectivo_esperado:0, pagos_fudo_total:0, ventas_fudo_total:0 };

  if (!ultimo) {
    const operativa = cajaBaseEsperada_(fechaFmt, sede);
    const fuerte = cajaSaldoFuerteAntes_(fechaFmt, sede);
    return {
      disponible:true,
      tiene_cierre_dilana:false,
      fecha_referencia:fechaReferencia,
      mensaje:'No existe un cierre anterior de DILANA para comparar. FUDO se usa como referencia y el cajero confirma el dinero físico.',
      fudo:{
        ventas_total:Number(resumenFudo.ventas_fudo_total)||0,
        pagos_total:Number(resumenFudo.pagos_fudo_total)||0,
        efectivo:Number(resumenFudo.pagos_efectivo_esperado)||0,
        descuentos:Number(resumenFudo.descuentos_total)||0,
        propinas:Number(resumenFudo.propinas_total)||0
      },
      dilana:null,
      custodia_esperada_hoy:{ caja_operativa:operativa, caja_fuerte:fuerte, total:Number((operativa+fuerte).toFixed(2)) },
      cuadra_fudo_dilana:null,
      diferencia_fudo_dilana:null
    };
  }

  const movimientosTurnoAnterior = cajaMovimientosVentanaTurno_(ultimo, cajaMovimientosDelDia_(fechaReferencia, sede));
  const recalculo = cajaEfectivoEsperado_(ultimo, movimientosTurnoAnterior, fechaReferencia, sede);
  const esperadoGuardado = Number(ultimo.efectivo_esperado) || 0;
  const diferenciaFudoDilana = Number((recalculo.esperado - esperadoGuardado).toFixed(2));
  const custodia = cajaCustodiaEsperadaTrasCierre_(ultimo, fechaFmt, sede);

  return {
    disponible:true,
    tiene_cierre_dilana:true,
    fecha_referencia:fechaReferencia,
    fudo:{
      ventas_total:Number(resumenFudo.ventas_fudo_total)||0,
      pagos_total:Number(resumenFudo.pagos_fudo_total)||0,
      efectivo:Number(recalculo.pagos_efectivo_esperado)||0,
      efectivo_dia:Number(recalculo.pagos_efectivo_dia)||0,
      descuentos:Number(resumenFudo.descuentos_total)||0,
      propinas:Number(resumenFudo.propinas_total)||0
    },
    dilana:{
      esperado_cierre_guardado:esperadoGuardado,
      esperado_cierre_con_fudo_actual:Number(recalculo.esperado)||0,
      contado_cierre:Number(ultimo.efectivo_contado)||0,
      diferencia_fisica_cierre:Number(ultimo.diferencia)||0,
      caja_fuerte_esperada_cierre:Number(ultimo.caja_fuerte_esperada)||0,
      caja_fuerte_contada_cierre:Number(ultimo.caja_fuerte_contada)||0,
      diferencia_caja_fuerte_cierre:Number(ultimo.diferencia_caja_fuerte)||0,
      base_siguiente:Number(ultimo.base_siguiente)||0,
      caja_fuerte_siguiente:Number(ultimo.caja_fuerte_siguiente)||0,
      usuario_cierre:ultimo.usuario_cierre||'',
      hora_cierre:ultimo.hora_cierre||ultimo.timestamp_cierre||''
    },
    movimientos_posteriores:{
      cantidad:custodia.movimientos.length,
      entregado_personas:Number(custodia.resumen.entregas_administrador)||0,
      enviado_caja_fuerte:Number(custodia.resumen.envios_caja_fuerte)||0,
      retirado_caja_fuerte:Number(custodia.resumen.retiros_caja_fuerte)||0,
      otros_ingresos:Number(custodia.resumen.otros_ingresos)||0
    },
    custodia_esperada_hoy:{ caja_operativa:custodia.caja_operativa, caja_fuerte:custodia.caja_fuerte, total:custodia.total },
    diferencia_fudo_dilana:diferenciaFudoDilana,
    cuadra_fudo_dilana:Math.abs(diferenciaFudoDilana)<0.01,
    cuadra_fisico_cierre_anterior:
      Math.abs(Number(ultimo.diferencia)||0)<0.01 && Math.abs(Number(ultimo.diferencia_caja_fuerte)||0)<0.01
  };
}

/**
 * Un movimiento de custodia posterior al cierre NO es un cambio de FUDO. Recalcula el cierre usando
 * únicamente los movimientos que existían dentro de la ventana del turno cerrado.
 */
function cajaFudoCambioTrasCierre_(turno) {
  if (turno.estado !== 'Cerrado') return null;
  const fecha = formatearFecha_(turno.fecha);
  const limite = new Date();
  limite.setDate(limite.getDate() - CAJA_FUDO_POST_CIERRE_DIAS_);
  if (fecha < formatearFecha_(limite)) return null;
  const movimientosTurno = cajaMovimientosVentanaTurno_(turno, cajaMovimientosDelDia_(fecha, turno.sede));
  const recalculo = cajaEfectivoEsperado_(turno, movimientosTurno, fecha, turno.sede);
  const esperadoGuardado = Number(turno.efectivo_esperado) || 0;
  const diferencia = Number((recalculo.esperado - esperadoGuardado).toFixed(2));
  if (diferencia === 0) return null;
  return { esperado_guardado:esperadoGuardado, esperado_actual:recalculo.esperado, diferencia:diferencia };
}

/**
 * `caja_sincronizar_ahora` prepara también la apertura: sincroniza hoy y la fecha del último cierre
 * DILANA (o ayer si aún no existe historial), y devuelve la conciliación completa.
 */
function cajaSincronizarAhora_(fecha, sede, usuario) {
  if (!fecha || !sede) return { ok:false, error:'Falta la fecha o la sede' };
  const fechaFmt = formatearFecha_(fecha);
  const syncActual = cajaSincronizarFudo_(fechaFmt, sede, usuario, true);
  const turnoActual = cajaTurnoFila_(fechaFmt, sede);
  let syncAnterior = null;
  let conciliacionApertura = null;

  if (!turnoActual) {
    const ultimo = cajaUltimoCierreAntes_(fechaFmt, sede);
    const fechaReferencia = ultimo ? formatearFecha_(ultimo.fecha) : cajaDiaAnteriorReactivacion_(fechaFmt);
    if (fechaReferencia && fechaReferencia !== fechaFmt) syncAnterior = cajaSincronizarFudo_(fechaReferencia, sede, usuario, true);
    conciliacionApertura = cajaConciliacionApertura_(fechaFmt, sede);
  }

  return {
    ok:!!syncActual.ok && (!syncAnterior || !!syncAnterior.ok),
    fecha:fechaFmt,
    sede:sede,
    sincronizacion_actual:syncActual,
    sincronizacion_anterior:syncAnterior,
    conciliacion_apertura:conciliacionApertura,
    error:!syncActual.ok ? (syncActual.error||'No se pudo sincronizar FUDO para el día actual.') :
      (syncAnterior && !syncAnterior.ok ? (syncAnterior.error||'No se pudo sincronizar FUDO para el cierre anterior.') : '')
  };
}

/** Sincronización financiera periódica exclusiva de la fase Caja: HOY + AYER. */
function fudoSincronizacionCajaAutomatica_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('FUDO_API_KEY') || !props.getProperty('FUDO_API_SECRET')) return { ok:true, omitida:'sin_credenciales' };

  const hoy = new Date();
  const ayer = new Date(hoy.getTime());
  ayer.setDate(ayer.getDate() - 1);
  const fechaDesde = formatearFecha_(ayer);
  const fechaHasta = formatearFecha_(hoy);
  const usuarioAutomatico = { id:'sistema-fudo', nombre:'Sincronización automática FUDO', rol:'Administrador', sede:'Ambas' };
  const resultado = { ok:true, fecha_desde:fechaDesde, fecha_hasta:fechaHasta, ventas:null, pagos:null };

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
