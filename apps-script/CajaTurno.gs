/**
 * CAJA — apertura, movimientos y cierre del turno de caja
 *
 * Pedido real: "el dinero esperado debe cambiar de inmediato cuando se entrega al administrador, no
 * aparecer como un faltante al cerrar". Antes (BaseCaja.gs) el cuadre era una sola foto manual al
 * final del día, sin apertura ni registro de lo que salió de la caja durante el turno — por eso
 * cualquier entrega al administrador se veía como un faltante en vez de restarse del esperado.
 *
 * Modelo:
 * - Caja_Turno: una fila por fecha+sede — apertura (base_inicial, hora, quién abre) y, al cerrar,
 *   el resultado del cuadre. Vive todo el turno en estado 'Abierto' hasta que se cierra.
 * - Caja_Movimientos: una fila por cada entrega al administrador, gasto/salida u otro ingreso —
 *   valor, quién entrega, quién recibe, hora, motivo y evidencia opcional (Evidencias.gs).
 *
 * Efectivo esperado = base con la que abrió + efectivo que FUDO dice que entró (turnoResumenCierre_)
 * + otros ingresos − entregas al administrador − gastos, sumando Caja_Movimientos del día. Se
 * calcula en vivo (cajaEstado_) y se vuelve a calcular al cerrar (cajaCerrar_) contra lo contado.
 *
 * Quién puede abrir/registrar/cerrar: Administrador y Encargado siempre, o quien tenga el sector
 * "Caja" elegido hoy (Turnos.gs) — mismo criterio que turnoCerrar_.
 */

const CAJA_TIPOS_MOVIMIENTO_ = ['Entrega administrador', 'Gasto', 'Otro ingreso'];

function cajaPuedeCerrar_(usuario, fecha) {
  if (usuario.rol === 'Administrador' || usuario.rol === 'Encargado') return true;
  return turnoSectorDeHoy_(usuario, fecha).sector === 'Caja';
}

function cajaTurnoFila_(fecha, sede) {
  return leerTabla_(SHEET_NAMES.CAJA_TURNO).find(function (r) {
    return formatearFecha_(r.fecha) === fecha && r.sede === sede;
  });
}

function cajaMovimientosDelDia_(fecha, sede) {
  return leerTabla_(SHEET_NAMES.CAJA_MOVIMIENTOS).filter(function (r) {
    return formatearFecha_(r.fecha) === fecha && r.sede === sede;
  });
}

function cajaMovimientosResumen_(movimientos) {
  const resumen = { entregas_administrador: 0, gastos: 0, otros_ingresos: 0 };
  movimientos.forEach(function (m) {
    const valor = Number(m.valor) || 0;
    if (m.tipo === 'Entrega administrador') resumen.entregas_administrador += valor;
    else if (m.tipo === 'Gasto') resumen.gastos += valor;
    else if (m.tipo === 'Otro ingreso') resumen.otros_ingresos += valor;
  });
  resumen.entregas_administrador = Number(resumen.entregas_administrador.toFixed(2));
  resumen.gastos = Number(resumen.gastos.toFixed(2));
  resumen.otros_ingresos = Number(resumen.otros_ingresos.toFixed(2));
  return resumen;
}

function cajaEfectivoEsperado_(apertura, movimientos, fecha, sede) {
  const resumen = cajaMovimientosResumen_(movimientos);
  const fudo = typeof turnoResumenCierre_ === 'function'
    ? turnoResumenCierre_(fecha, sede)
    : { pagos_efectivo_esperado: 0 };
  const pagosEfectivoEsperado = Number(fudo.pagos_efectivo_esperado) || 0;
  const esperado = Number(apertura.base_inicial || 0)
    + pagosEfectivoEsperado
    + resumen.otros_ingresos
    - resumen.entregas_administrador
    - resumen.gastos;
  return {
    esperado: Number(esperado.toFixed(2)),
    pagos_efectivo_esperado: pagosEfectivoEsperado,
    resumen: resumen
  };
}

/** Actualiza en el sitio la fila de Caja_Turno de `fecha`+`sede` con los campos de `cambios`. */
function cajaTurnoActualizarFila_(fecha, sede, cambios) {
  const sh = sheet_(SHEET_NAMES.CAJA_TURNO);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const fechaCol = headers.indexOf('fecha');
  const sedeCol = headers.indexOf('sede');
  const limpio = neutralizarObjetoFormulas_(cambios);
  for (let r = 1; r < data.length; r++) {
    if (formatearFecha_(data[r][fechaCol]) === fecha && data[r][sedeCol] === sede) {
      headers.forEach(function (h, c) { if (limpio[h] !== undefined) sh.getRange(r + 1, c + 1).setValue(limpio[h]); });
      return true;
    }
  }
  return false;
}

/** Apertura del turno de caja: base inicial y hora, una vez por fecha+sede. Obligatoria antes de
 * poder registrar movimientos o cerrar (ver cajaMovimientoRegistrar_/cajaCerrar_). */
function cajaAbrir_(item, usuario) {
  if (!item || !item.fecha || !item.sede) return { ok: false, error: 'Falta la fecha o la sede' };
  if (item.base_inicial === '' || item.base_inicial === undefined || item.base_inicial === null) {
    return { ok: false, error: 'Falta la base inicial con la que abre la caja' };
  }
  if (!sedeEscrituraPermitida_(usuario, item.sede)) {
    return { ok: false, error: 'No puedes abrir la caja de una sede distinta a la tuya (' + usuario.sede + ')' };
  }
  const fecha = formatearFecha_(item.fecha);
  const existente = cajaTurnoFila_(fecha, item.sede);
  if (existente) {
    if (existente.estado === 'Cerrado') return { ok: false, error: 'La caja de hoy en ' + item.sede + ' ya se cerró.' };
    return { ok: true, ya_abierta: true, item: existente };
  }
  const fila = {
    id: Utilities.getUuid(),
    fecha: fecha,
    sede: item.sede,
    estado: 'Abierto',
    base_inicial: Number(item.base_inicial) || 0,
    hora_apertura: new Date(),
    usuario_apertura_id: usuario.id,
    usuario_apertura: usuario.nombre,
    rappi_encendido: false
  };
  appendRowFromObj_(SHEET_NAMES.CAJA_TURNO, fila);
  auditoriaRegistrar_(usuario, 'caja_abrir', 'CajaTurno', fecha + '|' + item.sede, null,
    { base_inicial: fila.base_inicial }, item.sede, '');
  return { ok: true, item: fila };
}

/** Estado de la caja de hoy para la pantalla de Inicio: si está abierta, la base y el efectivo
 * esperado calculado en vivo con los movimientos registrados hasta este momento. */
function cajaEstado_(fecha, sede, usuario) {
  if (!fecha || !sede) return { ok: false, error: 'Falta la fecha o la sede' };
  const apertura = cajaTurnoFila_(fecha, sede);
  if (!apertura) return { ok: true, abierta: false, puede_cerrar: cajaPuedeCerrar_(usuario, fecha) };
  const movimientos = cajaMovimientosDelDia_(fecha, sede);
  const calculo = cajaEfectivoEsperado_(apertura, movimientos, fecha, sede);
  return {
    ok: true,
    abierta: apertura.estado === 'Abierto',
    apertura: apertura,
    movimientos_resumen: calculo.resumen,
    pagos_efectivo_esperado: calculo.pagos_efectivo_esperado,
    efectivo_esperado: calculo.esperado,
    puede_cerrar: cajaPuedeCerrar_(usuario, fecha)
  };
}

/** Recordatorio de encender Rappi: un simple sí/no guardado en la apertura de hoy, no un estado
 * conectado a Rappi de verdad (no existe esa integración) — solo para que quede marcado y visible. */
function cajaRappiMarcar_(fecha, sede) {
  if (!fecha || !sede) return { ok: false, error: 'Falta la fecha o la sede' };
  const fechaFmt = formatearFecha_(fecha);
  if (!cajaTurnoFila_(fechaFmt, sede)) return { ok: false, error: 'Primero hay que abrir la caja de hoy en ' + sede + '.' };
  cajaTurnoActualizarFila_(fechaFmt, sede, { rappi_encendido: true });
  return { ok: true };
}

/** Un movimiento de efectivo durante el turno: entrega al administrador, gasto/salida u otro
 * ingreso. Cambia el efectivo esperado de inmediato (cajaEstado_/cajaCerrar_ ya lo reflejan). */
function cajaMovimientoRegistrar_(item, usuario) {
  if (!item || !item.fecha || !item.sede) return { ok: false, error: 'Falta la fecha o la sede' };
  if (!sedeEscrituraPermitida_(usuario, item.sede)) {
    return { ok: false, error: 'No puedes registrar movimientos de caja de una sede distinta a la tuya (' + usuario.sede + ')' };
  }
  const fecha = formatearFecha_(item.fecha);
  const apertura = cajaTurnoFila_(fecha, item.sede);
  if (!apertura) return { ok: false, error: 'Primero hay que abrir la caja de hoy en ' + item.sede + '.' };
  if (apertura.estado === 'Cerrado') return { ok: false, error: 'La caja de hoy en ' + item.sede + ' ya se cerró.' };
  if (CAJA_TIPOS_MOVIMIENTO_.indexOf(item.tipo) === -1) {
    return { ok: false, error: 'Tipo de movimiento inválido. Debe ser uno de: ' + CAJA_TIPOS_MOVIMIENTO_.join(', ') };
  }
  const valor = Number(item.valor);
  if (!valor || valor <= 0) return { ok: false, error: 'El valor debe ser mayor a cero' };
  if (!item.motivo) return { ok: false, error: 'Falta el motivo u observación' };
  if (item.tipo === 'Entrega administrador' && (!item.persona_entrega || !item.persona_recibe)) {
    return { ok: false, error: 'Una entrega al administrador necesita quién entrega y quién recibe' };
  }

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
    usuario_id: usuario.id,
    usuario: usuario.nombre,
    timestamp: new Date()
  };
  appendRowFromObj_(SHEET_NAMES.CAJA_MOVIMIENTOS, fila);
  auditoriaRegistrar_(usuario, 'caja_movimiento_registrar', 'CajaMovimientos', fila.id, null,
    { tipo: fila.tipo, valor: fila.valor }, item.sede, item.motivo);
  return { ok: true, item: fila };
}

/** Movimientos de caja de una fecha+sede, más recientes primero — para "Ver movimientos de caja". */
function cajaMovimientosListar_(fecha, sede) {
  if (!fecha || !sede) return [];
  return cajaMovimientosDelDia_(formatearFecha_(fecha), sede).sort(function (a, b) {
    return new Date(b.timestamp) - new Date(a.timestamp);
  });
}

/**
 * Cierre de caja: compara el efectivo contado contra el esperado (base + FUDO + otros ingresos −
 * entregas − gastos) y calcula sobrante/faltante, cuánto se entrega al administrador al cierre y con
 * cuánto queda la base para el día siguiente (por defecto, la misma base con la que abrió hoy).
 */
function cajaCerrar_(item, usuario) {
  if (!item || !item.fecha || !item.sede) return { ok: false, error: 'Falta la fecha o la sede' };
  if (!sedeEscrituraPermitida_(usuario, item.sede)) {
    return { ok: false, error: 'No puedes cerrar la caja de una sede distinta a la tuya (' + usuario.sede + ')' };
  }
  const fecha = formatearFecha_(item.fecha);
  if (!cajaPuedeCerrar_(usuario, fecha)) {
    return { ok: false, error: 'Solo quien tiene el sector "Caja" asignado hoy (o un Administrador/Encargado) puede cerrar la caja.' };
  }
  const apertura = cajaTurnoFila_(fecha, item.sede);
  if (!apertura) return { ok: false, error: 'La caja de hoy en ' + item.sede + ' no se ha abierto.' };
  if (apertura.estado === 'Cerrado') return { ok: true, ya_cerrado: true };
  if (item.efectivo_contado === '' || item.efectivo_contado === undefined || item.efectivo_contado === null) {
    return { ok: false, error: 'Falta el efectivo contado' };
  }

  const movimientos = cajaMovimientosDelDia_(fecha, item.sede);
  const calculo = cajaEfectivoEsperado_(apertura, movimientos, fecha, item.sede);
  const efectivoContado = Number(item.efectivo_contado) || 0;
  const diferencia = Number((efectivoContado - calculo.esperado).toFixed(2));
  const baseSiguiente = (item.base_siguiente !== '' && item.base_siguiente !== undefined && item.base_siguiente !== null)
    ? Number(item.base_siguiente) || 0
    : Number(apertura.base_inicial) || 0;
  const entregaCierre = Number((efectivoContado - baseSiguiente).toFixed(2));

  cajaTurnoActualizarFila_(fecha, item.sede, {
    estado: 'Cerrado',
    efectivo_contado: efectivoContado,
    efectivo_esperado: calculo.esperado,
    diferencia: diferencia,
    entrega_cierre: entregaCierre,
    base_siguiente: baseSiguiente,
    usuario_cierre: usuario.nombre,
    hora_cierre: new Date(),
    observacion_cierre: item.observacion || '',
    timestamp_cierre: new Date()
  });

  if (diferencia !== 0) {
    auditoriaRegistrar_(usuario, 'caja_no_cuadra', 'CajaTurno', fecha + '|' + item.sede, null,
      { diferencia: diferencia }, item.sede, diferencia > 0 ? 'Sobrante en caja' : 'Faltante en caja');
  }

  return {
    ok: true,
    efectivo_esperado: calculo.esperado,
    efectivo_contado: efectivoContado,
    diferencia: diferencia,
    entrega_cierre: entregaCierre,
    base_siguiente: baseSiguiente
  };
}
