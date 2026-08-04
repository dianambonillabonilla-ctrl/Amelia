/**
 * CAJA — apertura, movimientos y cierre del turno de caja.
 *
 * Fuente única:
 * - Caja_Turno: apertura, base esperada, Rappi y cierre.
 * - Caja_Movimientos: entregas al administrador, gastos y otros ingresos.
 *
 * Efectivo esperado = efectivo contado al abrir
 *   + efectivo FUDO registrado desde la apertura
 *   + otros ingresos
 *   - entregas al administrador
 *   - gastos.
 */

const CAJA_TIPOS_MOVIMIENTO_ = ['Entrega administrador', 'Gasto', 'Otro ingreso'];

const CAJA_COLUMNAS_TURNO_ = [
  'id', 'fecha', 'sede', 'estado',
  'base_esperada', 'base_inicial', 'diferencia_apertura', 'observacion_apertura',
  'hora_apertura', 'usuario_apertura_id', 'usuario_apertura', 'efectivo_fudo_al_abrir',
  'rappi_encendido', 'rappi_confirmado_por', 'rappi_confirmado_en',
  'efectivo_contado', 'efectivo_esperado', 'diferencia',
  'entrega_cierre', 'persona_recibe_cierre', 'base_siguiente',
  'usuario_cierre', 'hora_cierre', 'observacion_cierre', 'timestamp_cierre'
];

const CAJA_COLUMNAS_MOVIMIENTOS_ = [
  'id', 'fecha', 'sede', 'tipo', 'valor', 'persona_entrega', 'persona_recibe',
  'hora', 'motivo', 'evidencia_url', 'usuario_id', 'usuario', 'timestamp'
];

function cajaAsegurarEstructura_() {
  asegurarColumnas_(sheet_(SHEET_NAMES.CAJA_TURNO), CAJA_COLUMNAS_TURNO_);
  asegurarColumnas_(sheet_(SHEET_NAMES.CAJA_MOVIMIENTOS), CAJA_COLUMNAS_MOVIMIENTOS_);
}

function cajaPuedeCerrar_(usuario, fecha) {
  if (usuario.rol === 'Administrador' || usuario.rol === 'Encargado') return true;
  return turnoSectorDeHoy_(usuario, fecha).sector === 'Caja';
}

function cajaFechaMs_(valor) {
  if (!valor) return 0;
  const d = valor instanceof Date ? valor : new Date(valor);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function cajaTurnoFila_(fecha, sede) {
  cajaAsegurarEstructura_();
  return leerTabla_(SHEET_NAMES.CAJA_TURNO).find(function (r) {
    return formatearFecha_(r.fecha) === fecha && r.sede === sede;
  });
}

function cajaUltimoCierreAntes_(fecha, sede) {
  cajaAsegurarEstructura_();
  const limite = new Date(fecha + 'T23:59:59').getTime();
  return leerTabla_(SHEET_NAMES.CAJA_TURNO)
    .filter(function (r) {
      if (r.sede !== sede || r.estado !== 'Cerrado') return false;
      const marca = cajaFechaMs_(r.timestamp_cierre || r.hora_cierre || r.fecha);
      return marca && marca <= limite;
    })
    .sort(function (a, b) {
      return cajaFechaMs_(b.timestamp_cierre || b.hora_cierre || b.fecha)
        - cajaFechaMs_(a.timestamp_cierre || a.hora_cierre || a.fecha);
    })[0] || null;
}

function cajaBaseEsperada_(fecha, sede) {
  const ultimo = cajaUltimoCierreAntes_(fecha, sede);
  return ultimo && ultimo.base_siguiente !== '' && ultimo.base_siguiente !== null
    ? Number(ultimo.base_siguiente) || 0
    : 0;
}

function cajaMovimientosDelDia_(fecha, sede) {
  cajaAsegurarEstructura_();
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

/**
 * Cuánto se entregó DE VERDAD al administrador ese día en esa sede, sumando las dos formas en que
 * el dinero sale de la caja hacia él: las entregas registradas durante el turno (Caja_Movimientos,
 * tipo "Entrega administrador") más lo que se le entrega al cerrar (Caja_Turno.entrega_cierre — lo
 * que sobra después de apartar la base del turno siguiente). Esto es lo que en teoría debería
 * terminar guardado en la Caja Fuerte de esa sede — ver cajaConciliacionListar_ (ConciliacionCaja.gs)
 * y baseCajaGuardar_ (BaseCaja.gs), que lo usan para avisar cuando Base_Caja.caja_fuerte no coincide.
 */
function cajaEntregadoTotalDia_(fecha, sede) {
  cajaAsegurarEstructura_();
  const fechaFmt = formatearFecha_(fecha);
  const turno = cajaTurnoFila_(fechaFmt, sede);
  const entregasMovimiento = cajaMovimientosResumen_(cajaMovimientosDelDia_(fechaFmt, sede)).entregas_administrador;
  const entregaCierre = (turno && turno.estado === 'Cerrado') ? (Number(turno.entrega_cierre) || 0) : 0;
  return Number((entregasMovimiento + entregaCierre).toFixed(2));
}

function cajaEfectivoFudoDia_(fecha, sede) {
  const fudo = typeof turnoResumenCierre_ === 'function'
    ? turnoResumenCierre_(fecha, sede)
    : { pagos_efectivo_esperado: 0 };
  return Number(fudo.pagos_efectivo_esperado) || 0;
}

function cajaEfectivoEsperado_(apertura, movimientos, fecha, sede) {
  const resumen = cajaMovimientosResumen_(movimientos);
  const efectivoFudoActual = cajaEfectivoFudoDia_(fecha, sede);
  const efectivoFudoTurno = Math.max(0, efectivoFudoActual - (Number(apertura.efectivo_fudo_al_abrir) || 0));
  const esperado = Number(apertura.base_inicial || 0)
    + efectivoFudoTurno
    + resumen.otros_ingresos
    - resumen.entregas_administrador
    - resumen.gastos;
  return {
    esperado: Number(esperado.toFixed(2)),
    pagos_efectivo_esperado: Number(efectivoFudoTurno.toFixed(2)),
    pagos_efectivo_dia: Number(efectivoFudoActual.toFixed(2)),
    resumen: resumen
  };
}

function cajaTurnoActualizarFila_(fecha, sede, cambios) {
  cajaAsegurarEstructura_();
  const sh = sheet_(SHEET_NAMES.CAJA_TURNO);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const fechaCol = headers.indexOf('fecha');
  const sedeCol = headers.indexOf('sede');
  const limpio = neutralizarObjetoFormulas_(cambios);
  for (let r = 1; r < data.length; r++) {
    if (formatearFecha_(data[r][fechaCol]) === fecha && data[r][sedeCol] === sede) {
      headers.forEach(function (h, c) {
        if (limpio[h] !== undefined) sh.getRange(r + 1, c + 1).setValue(limpio[h]);
      });
      return true;
    }
  }
  return false;
}

function cajaAbrir_(item, usuario) {
  cajaAsegurarEstructura_();
  if (!item || !item.fecha || !item.sede) return { ok: false, error: 'Falta la fecha o la sede' };
  if (item.base_inicial === '' || item.base_inicial === undefined || item.base_inicial === null) {
    return { ok: false, error: 'Falta el efectivo contado al abrir la caja' };
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

  const baseEsperada = cajaBaseEsperada_(fecha, item.sede);
  const baseInicial = Number(item.base_inicial) || 0;
  const diferenciaApertura = Number((baseInicial - baseEsperada).toFixed(2));
  const fila = {
    id: Utilities.getUuid(),
    fecha: fecha,
    sede: item.sede,
    estado: 'Abierto',
    base_esperada: baseEsperada,
    base_inicial: baseInicial,
    diferencia_apertura: diferenciaApertura,
    observacion_apertura: item.observacion_apertura || '',
    hora_apertura: new Date(),
    usuario_apertura_id: usuario.id,
    usuario_apertura: usuario.nombre,
    efectivo_fudo_al_abrir: cajaEfectivoFudoDia_(fecha, item.sede),
    rappi_encendido: false
  };
  appendRowFromObj_(SHEET_NAMES.CAJA_TURNO, fila);
  auditoriaRegistrar_(usuario, 'caja_abrir', 'CajaTurno', fecha + '|' + item.sede, null,
    { base_esperada: baseEsperada, base_inicial: baseInicial, diferencia_apertura: diferenciaApertura },
    item.sede, item.observacion_apertura || '');
  return { ok: true, item: fila };
}

function cajaEstado_(fecha, sede, usuario) {
  cajaAsegurarEstructura_();
  if (!fecha || !sede) return { ok: false, error: 'Falta la fecha o la sede' };
  const apertura = cajaTurnoFila_(fecha, sede);
  if (!apertura) {
    return {
      ok: true,
      abierta: false,
      base_esperada: cajaBaseEsperada_(fecha, sede),
      puede_cerrar: cajaPuedeCerrar_(usuario, fecha)
    };
  }
  const movimientos = cajaMovimientosDelDia_(fecha, sede);
  const calculo = cajaEfectivoEsperado_(apertura, movimientos, fecha, sede);
  return {
    ok: true,
    abierta: apertura.estado === 'Abierto',
    apertura: apertura,
    movimientos_resumen: calculo.resumen,
    pagos_efectivo_esperado: calculo.pagos_efectivo_esperado,
    pagos_efectivo_dia: calculo.pagos_efectivo_dia,
    efectivo_esperado: calculo.esperado,
    puede_cerrar: cajaPuedeCerrar_(usuario, fecha)
  };
}

function cajaRappiMarcar_(fecha, sede, usuario) {
  cajaAsegurarEstructura_();
  if (!fecha || !sede) return { ok: false, error: 'Falta la fecha o la sede' };
  const fechaFmt = formatearFecha_(fecha);
  const turno = cajaTurnoFila_(fechaFmt, sede);
  if (!turno) return { ok: false, error: 'Primero hay que abrir la caja de hoy en ' + sede + '.' };
  if (turno.estado === 'Cerrado') return { ok: false, error: 'La caja ya está cerrada.' };
  cajaTurnoActualizarFila_(fechaFmt, sede, {
    rappi_encendido: true,
    rappi_confirmado_por: usuario ? usuario.nombre : '',
    rappi_confirmado_en: new Date()
  });
  return { ok: true };
}

function cajaMovimientoRegistrar_(item, usuario) {
  cajaAsegurarEstructura_();
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
    { tipo: fila.tipo, valor: fila.valor, persona_recibe: fila.persona_recibe }, item.sede, item.motivo);
  return { ok: true, item: fila };
}

function cajaMovimientosListar_(fecha, sede) {
  if (!fecha || !sede) return [];
  return cajaMovimientosDelDia_(formatearFecha_(fecha), sede).sort(function (a, b) {
    return new Date(b.timestamp) - new Date(a.timestamp);
  });
}

function cajaCerrar_(item, usuario) {
  cajaAsegurarEstructura_();
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
    persona_recibe_cierre: item.persona_recibe_cierre || '',
    base_siguiente: baseSiguiente,
    usuario_cierre: usuario.nombre,
    hora_cierre: new Date(),
    observacion_cierre: item.observacion || '',
    timestamp_cierre: new Date()
  });

  auditoriaRegistrar_(usuario, 'caja_cerrar', 'CajaTurno', fecha + '|' + item.sede, null,
    {
      efectivo_esperado: calculo.esperado,
      efectivo_contado: efectivoContado,
      diferencia: diferencia,
      entrega_cierre: entregaCierre,
      persona_recibe_cierre: item.persona_recibe_cierre || '',
      base_siguiente: baseSiguiente
    }, item.sede, item.observacion || '');

  return {
    ok: true,
    efectivo_esperado: calculo.esperado,
    efectivo_contado: efectivoContado,
    diferencia: diferencia,
    entrega_cierre: entregaCierre,
    persona_recibe_cierre: item.persona_recibe_cierre || '',
    base_siguiente: baseSiguiente
  };
}
