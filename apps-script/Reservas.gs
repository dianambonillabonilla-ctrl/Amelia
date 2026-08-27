/**
 * RESERVAS — Amelia + La Wafflería (San Antonio y Capri)
 *
 * Uso interno para que quien atiende WhatsApp registre cada solicitud de reserva en un solo lugar
 * (nunca solo en el chat), asigne mesa sin choques y confirme con un mensaje listo para copiar.
 *
 * Reglas de negocio de este módulo (ver también CLAUDE.md):
 * - Obligatorio SIEMPRE al crear: nombre, teléfono, sede, fecha, hora, personas, motivo. Sin esto no
 *   hay reserva que registrar — es la información mínima que llega por WhatsApp.
 * - Mesa es obligatoria para que San Antonio quede "Confirmada", pero NO bloquea guardar la reserva:
 *   una reserva sin mesa se guarda como "Pendiente de asignar mesa" (objetivo explícito: que nada
 *   quede solo en WhatsApp mientras se resuelve el detalle).
 * - Capri no exige mesa todavía (pedido explícito), pero usa la misma tabla Reservas_Mesas — si el
 *   día de mañana Capri quiere mesas, solo hay que cargarlas ahí, no hace falta tocar código.
 * - El estado de una reserva se recalcula automáticamente a partir de sus datos (reservaEstadoCalculado_)
 *   MIENTRAS esté en un estado "vivo" (de información a Confirmada). Los estados operativos —
 *   Cliente llegó / No llegó / Finalizada / Cancelada — solo cambian por acción explícita
 *   (reservaCambiarEstado_) y nunca se recalculan solos.
 * - RESERVA_DURACION_OCUPACION_MINUTOS_ (2 horas) es un valor PROVISIONAL para decidir si dos
 *   reservas de una misma mesa se chocan en el tiempo — no es un dato confirmado por Diana, es una
 *   estimación razonable de cuánto dura una mesa ocupada. Igual que RESERVA_GRUPO_GRANDE_MIN_ (8
 *   personas). Ajustar aquí si Diana da un número distinto.
 */

const RESERVAS_SEDES_ = ['San Antonio', 'Capri'];
const RESERVA_MOTIVOS_ = ['Cumpleaños', 'Aniversario', 'Cena', 'Reunión', 'Evento', 'Ninguno', 'Otro'];
const RESERVA_ESTADOS_ = [
  'Pendiente de información', 'Pendiente de asignar mesa', 'Pendiente de pago',
  'Pendiente de verificar pago', 'Confirmada', 'Cliente llegó', 'Finalizada', 'No llegó', 'Cancelada'
];
// Estos cinco nunca se recalculan solos a partir de los datos — solo cambian por acción explícita.
const RESERVA_ESTADOS_TERMINALES_ = ['Cliente llegó', 'Finalizada', 'No llegó', 'Cancelada'];
// Una reserva en uno de estos estados sigue "ocupando" su mesa para el chequeo de choques.
const RESERVA_ESTADOS_EXCLUIDOS_OCUPACION_ = ['Cancelada', 'No llegó', 'Finalizada'];
const RESERVA_DECORACION_ESTADOS_PAGO_ = ['No aplica', 'Pendiente', 'Pagado', 'Pago por verificar'];

const RESERVA_TOLERANCIA_MINUTOS_ = 15; // "mesa reservada hasta" = hora + esto
const RESERVA_DURACION_OCUPACION_MINUTOS_ = 120; // provisional — ver nota arriba
const RESERVA_GRUPO_GRANDE_MIN_ = 8; // provisional — ver nota arriba
const RESERVA_DECORACION_VALOR_DEFAULT_ = 40000;
const RESERVA_DECORACION_TIPO_DEFAULT_ = 'Cumpleaños (decoración + porción de torta)';

const RESERVAS_MESAS_COLUMNAS_ = ['id', 'sede', 'numero', 'capacidad_min', 'capacidad_max', 'ubicacion', 'activa', 'puede_unirse_con', 'observaciones'];

// ---------------------------------------------------------------------------
// ESTRUCTURA
// ---------------------------------------------------------------------------

function reservasAsegurarEstructura_() {
  const ss = ss_();
  let mesas = ss.getSheetByName(SHEET_NAMES.RESERVAS_MESAS);
  if (!mesas) mesas = ss.insertSheet(SHEET_NAMES.RESERVAS_MESAS);
  if (mesas.getLastRow() === 0) {
    mesas.getRange(1, 1, 1, RESERVAS_MESAS_COLUMNAS_.length).setValues([RESERVAS_MESAS_COLUMNAS_]);
    mesas.setFrozenRows(1);
  } else {
    asegurarColumnas_(mesas, RESERVAS_MESAS_COLUMNAS_);
  }
  reservasSembrarMesasSanAntonio_();
}

/**
 * San Antonio tiene 11 mesas en la terraza (pedido explícito). Capacidad/ubicación son valores
 * PROVISIONALES de arranque — Diana los ajusta desde "Configuración de mesas" con los números
 * reales; esto solo evita que la pantalla arranque vacía.
 */
function reservasSembrarMesasSanAntonio_() {
  const existentes = leerTabla_(SHEET_NAMES.RESERVAS_MESAS).filter(function (m) { return m.sede === 'San Antonio'; });
  if (existentes.length > 0) return;
  const sh = sheet_(SHEET_NAMES.RESERVAS_MESAS);
  for (let n = 1; n <= 11; n++) {
    appendRowFromObj_(SHEET_NAMES.RESERVAS_MESAS, {
      id: Utilities.getUuid(), sede: 'San Antonio', numero: String(n),
      capacidad_min: 2, capacidad_max: 4, ubicacion: 'Terraza', activa: true,
      puede_unirse_con: '', observaciones: ''
    });
  }
  SpreadsheetApp.flush();
}

function reservasSedeValidar_(sede) {
  if (RESERVAS_SEDES_.indexOf(sede) === -1) throw new Error('Reservas solo existe en San Antonio y Capri.');
}

// ---------------------------------------------------------------------------
// HELPERS DE FECHA/HORA
// ---------------------------------------------------------------------------

function reservasFecha_(v) { return formatearFecha_(v); }

function reservasHoraValida_(hora) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(hora || '')); }

function reservasMinutosDesdeHora_(hora) {
  const partes = String(hora || '0:0').split(':');
  return (Number(partes[0]) || 0) * 60 + (Number(partes[1]) || 0);
}

function reservasHoraDesdeMinutos_(minutosTotales) {
  const m = ((minutosTotales % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), min = m % 60;
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

function reservasSumarMinutos_(hora, minutos) {
  return reservasHoraDesdeMinutos_(reservasMinutosDesdeHora_(hora) + minutos);
}

function reservasSeSolapan_(horaA, horaB, duracionMinutos) {
  const a = reservasMinutosDesdeHora_(horaA), b = reservasMinutosDesdeHora_(horaB);
  return a < b + duracionMinutos && b < a + duracionMinutos;
}

/** SA-030926-001 / CP-030926-001 — prefijo de sede + fecha DDMMYY + consecutivo del día para esa sede. */
function reservasGenerarCodigo_(sede, fecha) {
  const prefijo = sede === 'San Antonio' ? 'SA' : 'CP';
  const partes = reservasFecha_(fecha).split('-'); // yyyy-mm-dd
  const ddmmyy = partes[2] + partes[1] + partes[0].slice(2);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('No se pudo generar el código de la reserva, intenta de nuevo.');
  try {
    const consecutivo = leerTabla_(SHEET_NAMES.RESERVAS).filter(function (r) {
      return r.sede === sede && reservasFecha_(r.fecha) === reservasFecha_(fecha);
    }).length + 1;
    return prefijo + '-' + ddmmyy + '-' + String(consecutivo).padStart(3, '0');
  } finally {
    lock.releaseLock();
  }
}

function reservasMesasDeInput_(mesas) {
  const lista = Array.isArray(mesas) ? mesas : String(mesas || '').split(',');
  return lista.map(function (m) { return String(m).trim(); }).filter(function (m) { return m !== ''; })
    .sort(function (a, b) { return (Number(a) || 0) - (Number(b) || 0); });
}

function reservasMesasAString_(mesas) { return reservasMesasDeInput_(mesas).join(','); }

// ---------------------------------------------------------------------------
// VALIDACIÓN Y ESTADO
// ---------------------------------------------------------------------------

function reservaEsDecoracion_(v) { return v === true || normalizar_(v) === 'si' || normalizar_(v) === 'true'; }

/** Devuelve {completa, faltantes:[frases en español listas para mostrar]}. Ver sección 8 del pedido. */
function reservaValidarCompleta_(r) {
  const faltantes = [];
  if (!String(r.nombre_cliente || '').trim()) faltantes.push('Falta el nombre de la persona de la reserva.');
  if (!String(r.telefono || '').trim()) faltantes.push('Falta el teléfono / WhatsApp del cliente.');
  if (!r.sede) faltantes.push('Falta la sede.');
  if (!r.fecha) faltantes.push('Falta la fecha de la reserva.');
  if (!reservasHoraValida_(r.hora)) faltantes.push('Falta definir la hora de la reserva.');
  if (!(Number(r.personas) > 0)) faltantes.push('Falta el número de personas.');
  if (r.sede === 'San Antonio' && reservasMesasDeInput_(r.mesas).length === 0) faltantes.push('Falta asignar una mesa.');
  if (reservaEsDecoracion_(r.decoracion) && r.decoracion_estado_pago === 'Pagado') {
    if (!String(r.decoracion_fecha_pago || '').trim()) faltantes.push('Falta registrar la fecha de pago de la decoración.');
    if (!String(r.decoracion_medio_pago || '').trim()) faltantes.push('Falta registrar el medio de pago de la decoración.');
  }
  return { completa: faltantes.length === 0, faltantes: faltantes };
}

/** Estado automático mientras la reserva sigue "viva" (ver RESERVA_ESTADOS_TERMINALES_). */
function reservaEstadoCalculado_(r) {
  const val = reservaValidarCompleta_(r);
  if (!val.completa) {
    if (r.sede === 'San Antonio' && reservasMesasDeInput_(r.mesas).length === 0 &&
      val.faltantes.length === 1 && val.faltantes[0] === 'Falta asignar una mesa.') {
      return 'Pendiente de asignar mesa';
    }
    return 'Pendiente de información';
  }
  if (reservaEsDecoracion_(r.decoracion)) {
    if (r.decoracion_estado_pago === 'Pendiente') return 'Pendiente de pago';
    if (r.decoracion_estado_pago === 'Pago por verificar') return 'Pendiente de verificar pago';
  }
  return 'Confirmada';
}

// ---------------------------------------------------------------------------
// LECTURA / ESCRITURA DE FILAS
// ---------------------------------------------------------------------------

function reservasTodas_() { reservasAsegurarEstructura_(); return leerTabla_(SHEET_NAMES.RESERVAS); }

function reservaFilaPorId_(id) {
  return reservasTodas_().find(function (r) { return String(r.id) === String(id); }) || null;
}

function reservaActualizarFila_(id, cambios) {
  const sh = sheet_(SHEET_NAMES.RESERVAS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const limpio = neutralizarObjetoFormulas_(cambios || {});
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) !== String(id)) continue;
    headers.forEach(function (h, c) { if (limpio[h] !== undefined) sh.getRange(r + 1, c + 1).setValue(limpio[h]); });
    return true;
  }
  return false;
}

/** Busca conflicto de mesa: misma sede+fecha, alguna mesa en común, horario que se solapa. */
function reservasBuscarConflictoMesa_(sede, fecha, hora, mesas, excluirId) {
  const mesasSet = reservasMesasDeInput_(mesas);
  if (mesasSet.length === 0) return null;
  const f = reservasFecha_(fecha);
  const candidatas = reservasTodas_().filter(function (r) {
    return r.sede === sede && reservasFecha_(r.fecha) === f &&
      String(r.id) !== String(excluirId || '') &&
      RESERVA_ESTADOS_EXCLUIDOS_OCUPACION_.indexOf(r.estado) === -1;
  });
  for (let i = 0; i < candidatas.length; i++) {
    const r = candidatas[i];
    if (!reservasSeSolapan_(hora, r.hora, RESERVA_DURACION_OCUPACION_MINUTOS_)) continue;
    const mesasR = reservasMesasDeInput_(r.mesas);
    const comun = mesasSet.some(function (m) { return mesasR.indexOf(m) !== -1; });
    if (comun) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// CREAR / ACTUALIZAR / CAMBIAR ESTADO
// ---------------------------------------------------------------------------

function reservaNormalizarDecoracion_(item, base) {
  const out = {
    decoracion: reservaEsDecoracion_(item.decoracion),
    decoracion_tipo: '', decoracion_valor: 0, decoracion_estado_pago: 'No aplica',
    decoracion_medio_pago: '', decoracion_fecha_pago: '', decoracion_comprobante: false, decoracion_observaciones: ''
  };
  if (!out.decoracion) return { ok: true, valor: out };
  out.decoracion_tipo = String(item.decoracion_tipo || (base && base.decoracion_tipo) || RESERVA_DECORACION_TIPO_DEFAULT_);
  const valorNum = item.decoracion_valor !== undefined && item.decoracion_valor !== ''
    ? Number(item.decoracion_valor) : (base ? Number(base.decoracion_valor) : RESERVA_DECORACION_VALOR_DEFAULT_);
  if (!isFinite(valorNum) || valorNum < 0) return { ok: false, error: 'El valor de la decoración debe ser un número válido.' };
  out.decoracion_valor = valorNum;
  out.decoracion_estado_pago = item.decoracion_estado_pago || (base && base.decoracion_estado_pago) || 'Pendiente';
  if (RESERVA_DECORACION_ESTADOS_PAGO_.indexOf(out.decoracion_estado_pago) === -1) {
    return { ok: false, error: 'Estado de pago de decoración inválido.' };
  }
  out.decoracion_medio_pago = String(item.decoracion_medio_pago !== undefined ? item.decoracion_medio_pago : (base && base.decoracion_medio_pago) || '');
  out.decoracion_fecha_pago = String(item.decoracion_fecha_pago !== undefined ? item.decoracion_fecha_pago : (base && base.decoracion_fecha_pago) || '');
  out.decoracion_comprobante = item.decoracion_comprobante !== undefined ? reservaEsDecoracion_(item.decoracion_comprobante) : !!(base && reservaEsDecoracion_(base.decoracion_comprobante));
  out.decoracion_observaciones = String(item.decoracion_observaciones !== undefined ? item.decoracion_observaciones : (base && base.decoracion_observaciones) || '');
  return { ok: true, valor: out };
}

function reservaValidarMesasContraConfig_(sede, mesas) {
  if (mesas.length === 0) return { ok: true };
  const config = leerTabla_(SHEET_NAMES.RESERVAS_MESAS).filter(function (m) { return m.sede === sede; });
  for (let i = 0; i < mesas.length; i++) {
    const fila = config.find(function (m) { return String(m.numero) === String(mesas[i]); });
    if (!fila) return { ok: false, error: 'La mesa ' + mesas[i] + ' no existe en ' + sede + '.' };
    if (fila.activa === false || normalizar_(fila.activa) === 'no') {
      return { ok: false, error: 'La mesa ' + mesas[i] + ' está fuera de servicio.' };
    }
  }
  return { ok: true };
}

function reservaCrear_(item, usuario) {
  reservasAsegurarEstructura_();
  if (!item) return { ok: false, error: 'Faltan los datos de la reserva.' };
  if (RESERVAS_SEDES_.indexOf(item.sede) === -1) return { ok: false, error: 'Sede inválida.' };
  if (!sedeEscrituraPermitida_(usuario, item.sede)) return { ok: false, error: 'No puedes crear reservas de otra sede.' };
  if (!String(item.nombre_cliente || '').trim()) return { ok: false, error: 'Falta el nombre de la persona de la reserva.' };
  if (!String(item.telefono || '').trim()) return { ok: false, error: 'Falta el teléfono / WhatsApp.' };
  if (!item.fecha) return { ok: false, error: 'Falta la fecha.' };
  if (!reservasHoraValida_(item.hora)) return { ok: false, error: 'Falta u hora inválida (usa formato HH:MM).' };
  const personas = Number(item.personas);
  if (!isFinite(personas) || personas <= 0) return { ok: false, error: 'El número de personas debe ser mayor a cero.' };
  const motivo = item.motivo || 'Ninguno';
  if (RESERVA_MOTIVOS_.indexOf(motivo) === -1) return { ok: false, error: 'Motivo de visita inválido.' };

  const decoRes = reservaNormalizarDecoracion_(item, null);
  if (!decoRes.ok) return decoRes;

  const mesas = reservasMesasDeInput_(item.mesas);
  const mesasCheck = reservaValidarMesasContraConfig_(item.sede, mesas);
  if (!mesasCheck.ok) return mesasCheck;
  const fecha = reservasFecha_(item.fecha);
  if (mesas.length > 0) {
    const conflicto = reservasBuscarConflictoMesa_(item.sede, fecha, item.hora, mesas, null);
    if (conflicto) {
      return {
        ok: false,
        error: '⚠️ Esta mesa ya tiene una reserva para esta fecha y horario. Seleccione otra mesa.',
        conflicto: { codigo: conflicto.codigo, nombre_cliente: conflicto.nombre_cliente, hora: conflicto.hora }
      };
    }
  }

  const base = {
    sede: item.sede, fecha: fecha, hora: item.hora, personas: personas,
    nombre_cliente: String(item.nombre_cliente).trim(), telefono: String(item.telefono).trim(),
    motivo: motivo, motivo_otro: motivo === 'Otro' ? String(item.motivo_otro || '').trim() : '',
    observaciones: String(item.observaciones || '').trim(),
    mesas: reservasMesasAString_(mesas)
  };
  Object.assign(base, decoRes.valor);

  const fila = Object.assign({}, base, {
    id: Utilities.getUuid(),
    codigo: reservasGenerarCodigo_(item.sede, fecha),
    hora_limite: reservasSumarMinutos_(item.hora, RESERVA_TOLERANCIA_MINUTOS_),
    creado_por_id: usuario.id, creado_por_nombre: usuario.nombre, creado_en: new Date(),
    actualizado_por_id: '', actualizado_por_nombre: '', actualizado_en: '',
    cancelado_por_id: '', cancelado_por_nombre: '', cancelado_en: '', motivo_cancelacion: ''
  });
  fila.estado = reservaEstadoCalculado_(fila);

  appendRowFromObj_(SHEET_NAMES.RESERVAS, fila);
  if (typeof auditoriaRegistrar_ === 'function') auditoriaRegistrar_(usuario, 'reserva_crear', 'Reserva', fila.id, null, fila, item.sede, '');
  return { ok: true, item: fila, validacion: reservaValidarCompleta_(fila) };
}

const RESERVA_CAMPOS_EDITABLES_ = ['fecha', 'hora', 'personas', 'nombre_cliente', 'telefono', 'motivo', 'motivo_otro', 'observaciones', 'mesas'];

function reservaActualizar_(id, cambios, usuario) {
  const fila = reservaFilaPorId_(id);
  if (!fila) return { ok: false, error: 'Reserva no encontrada.' };
  if (!sedeEscrituraPermitida_(usuario, fila.sede)) return { ok: false, error: 'No puedes modificar reservas de otra sede.' };
  cambios = cambios || {};
  if (cambios.sede && cambios.sede !== fila.sede) return { ok: false, error: 'No se puede cambiar la sede de una reserva ya creada.' };

  const propuesta = Object.assign({}, fila);
  RESERVA_CAMPOS_EDITABLES_.forEach(function (campo) { if (cambios[campo] !== undefined) propuesta[campo] = cambios[campo]; });
  if (cambios.decoracion !== undefined || Object.keys(cambios).some(function (k) { return k.indexOf('decoracion_') === 0; })) {
    const decoRes = reservaNormalizarDecoracion_(Object.assign({}, fila, cambios), fila);
    if (!decoRes.ok) return decoRes;
    Object.assign(propuesta, decoRes.valor);
  }

  if (!String(propuesta.nombre_cliente || '').trim()) return { ok: false, error: 'Falta el nombre de la persona de la reserva.' };
  if (!String(propuesta.telefono || '').trim()) return { ok: false, error: 'Falta el teléfono / WhatsApp.' };
  if (!reservasHoraValida_(propuesta.hora)) return { ok: false, error: 'Hora inválida (usa formato HH:MM).' };
  const personas = Number(propuesta.personas);
  if (!isFinite(personas) || personas <= 0) return { ok: false, error: 'El número de personas debe ser mayor a cero.' };
  propuesta.personas = personas;
  if (RESERVA_MOTIVOS_.indexOf(propuesta.motivo) === -1) return { ok: false, error: 'Motivo de visita inválido.' };
  propuesta.fecha = reservasFecha_(propuesta.fecha);

  const mesas = reservasMesasDeInput_(propuesta.mesas);
  const mesasCheck = reservaValidarMesasContraConfig_(fila.sede, mesas);
  if (!mesasCheck.ok) return mesasCheck;
  if (mesas.length > 0) {
    const conflicto = reservasBuscarConflictoMesa_(fila.sede, propuesta.fecha, propuesta.hora, mesas, fila.id);
    if (conflicto) {
      return {
        ok: false,
        error: '⚠️ Esta mesa ya tiene una reserva para esta fecha y horario. Seleccione otra mesa.',
        conflicto: { codigo: conflicto.codigo, nombre_cliente: conflicto.nombre_cliente, hora: conflicto.hora }
      };
    }
  }
  propuesta.mesas = reservasMesasAString_(mesas);
  propuesta.hora_limite = reservasSumarMinutos_(propuesta.hora, RESERVA_TOLERANCIA_MINUTOS_);

  if (RESERVA_ESTADOS_TERMINALES_.indexOf(fila.estado) === -1) {
    propuesta.estado = reservaEstadoCalculado_(propuesta);
  }
  propuesta.actualizado_por_id = usuario.id;
  propuesta.actualizado_por_nombre = usuario.nombre;
  propuesta.actualizado_en = new Date();

  const cambiosFinales = {};
  Object.keys(propuesta).forEach(function (k) { if (k !== 'id' && k !== 'codigo') cambiosFinales[k] = propuesta[k]; });
  reservaActualizarFila_(id, cambiosFinales);
  if (typeof auditoriaRegistrar_ === 'function') auditoriaRegistrar_(usuario, 'reserva_actualizar', 'Reserva', id, fila, propuesta, fila.sede, '');
  return { ok: true, item: propuesta, validacion: reservaValidarCompleta_(propuesta) };
}

function reservaCambiarEstado_(id, estado, usuario, motivo) {
  if (RESERVA_ESTADOS_.indexOf(estado) === -1) return { ok: false, error: 'Estado inválido.' };
  const fila = reservaFilaPorId_(id);
  if (!fila) return { ok: false, error: 'Reserva no encontrada.' };
  if (!sedeEscrituraPermitida_(usuario, fila.sede)) return { ok: false, error: 'No puedes modificar reservas de otra sede.' };

  const cambios = { estado: estado, actualizado_por_id: usuario.id, actualizado_por_nombre: usuario.nombre, actualizado_en: new Date() };

  if (estado === 'Confirmada') {
    const val = reservaValidarCompleta_(fila);
    if (!val.completa) return { ok: false, error: '⚠️ FALTAN DATOS', faltantes: val.faltantes };
  }
  if (estado === 'Cancelada') {
    if (!String(motivo || '').trim()) return { ok: false, error: 'Escribe el motivo de cancelación.' };
    cambios.cancelado_por_id = usuario.id;
    cambios.cancelado_por_nombre = usuario.nombre;
    cambios.cancelado_en = new Date();
    cambios.motivo_cancelacion = String(motivo).trim();
  }

  reservaActualizarFila_(id, cambios);
  if (typeof auditoriaRegistrar_ === 'function') auditoriaRegistrar_(usuario, 'reserva_cambiar_estado', 'Reserva', id, { estado: fila.estado }, { estado: estado }, fila.sede, motivo || '');
  return { ok: true, item: Object.assign({}, fila, cambios) };
}

function reservaCancelar_(id, motivo, usuario) { return reservaCambiarEstado_(id, 'Cancelada', usuario, motivo); }

// ---------------------------------------------------------------------------
// LISTADOS / BÚSQUEDA / HISTORIAL
// ---------------------------------------------------------------------------

function reservasListar_(filtros, usuario) {
  filtros = filtros || {};
  const sede = sedeConsultaPermitida_(usuario, filtros.sede);
  let rows = reservasTodas_();
  if (sede) rows = rows.filter(function (r) { return r.sede === sede; });
  if (filtros.fecha) { const f = reservasFecha_(filtros.fecha); rows = rows.filter(function (r) { return reservasFecha_(r.fecha) === f; }); }
  if (filtros.fecha_desde) { const d = reservasFecha_(filtros.fecha_desde); rows = rows.filter(function (r) { return reservasFecha_(r.fecha) >= d; }); }
  if (filtros.fecha_hasta) { const h = reservasFecha_(filtros.fecha_hasta); rows = rows.filter(function (r) { return reservasFecha_(r.fecha) <= h; }); }
  if (filtros.estado) rows = rows.filter(function (r) { return r.estado === filtros.estado; });
  if (filtros.mesa) rows = rows.filter(function (r) { return reservasMesasDeInput_(r.mesas).indexOf(String(filtros.mesa)) !== -1; });
  return rows.sort(function (a, b) {
    const fa = reservasFecha_(a.fecha), fb = reservasFecha_(b.fecha);
    return fa === fb ? String(a.hora || '').localeCompare(String(b.hora || '')) : fa.localeCompare(fb);
  });
}

function reservasBuscar_(query, usuario) {
  const q = normalizar_(query);
  if (!q) return [];
  const sede = sedeConsultaPermitida_(usuario, null);
  let rows = reservasTodas_();
  if (sede) rows = rows.filter(function (r) { return r.sede === sede; });
  return rows.filter(function (r) {
    return normalizar_(r.nombre_cliente).indexOf(q) !== -1 ||
      normalizar_(r.telefono).indexOf(q) !== -1 ||
      normalizar_(r.codigo).indexOf(q) !== -1 ||
      normalizar_(r.fecha).indexOf(q) !== -1 ||
      reservasMesasDeInput_(r.mesas).indexOf(query.trim()) !== -1;
  }).sort(function (a, b) { return reservasFecha_(b.fecha).localeCompare(reservasFecha_(a.fecha)); });
}

/**
 * Historial de un cliente por teléfono. Acotado a la sede del usuario (Administrador/'Ambas' ven
 * todo) — "las trabajadoras solamente deben acceder a la información necesaria para operar".
 */
function reservaHistorialCliente_(telefono, usuario) {
  const sede = sedeConsultaPermitida_(usuario, null);
  let rows = reservasTodas_().filter(function (r) { return r.telefono === telefono; });
  if (sede) rows = rows.filter(function (r) { return r.sede === sede; });
  rows = rows.sort(function (a, b) { return reservasFecha_(b.fecha).localeCompare(reservasFecha_(a.fecha)); });
  return {
    ok: true,
    telefono: telefono,
    total_visitas: rows.filter(function (r) { return ['Cliente llegó', 'Finalizada'].indexOf(r.estado) !== -1; }).length,
    cancelaciones: rows.filter(function (r) { return r.estado === 'Cancelada'; }).length,
    no_shows: rows.filter(function (r) { return r.estado === 'No llegó'; }).length,
    celebraciones: rows.filter(function (r) { return r.motivo && r.motivo !== 'Ninguno'; })
      .map(function (r) { return { fecha: r.fecha, motivo: r.motivo, codigo: r.codigo }; }),
    observaciones: rows.filter(function (r) { return String(r.observaciones || '').trim(); })
      .map(function (r) { return { fecha: r.fecha, observaciones: r.observaciones, codigo: r.codigo }; }),
    reservas: rows.map(function (r) {
      return { id: r.id, codigo: r.codigo, fecha: r.fecha, hora: r.hora, sede: r.sede, personas: r.personas, motivo: r.motivo, estado: r.estado, mesas: r.mesas };
    })
  };
}

function reservasCalendario_(sede, desde, hasta, usuario) {
  const sedePermitida = sedeConsultaPermitida_(usuario, sede);
  const d = reservasFecha_(desde), h = reservasFecha_(hasta);
  let rows = reservasTodas_().filter(function (r) { return reservasFecha_(r.fecha) >= d && reservasFecha_(r.fecha) <= h; });
  if (sedePermitida) rows = rows.filter(function (r) { return r.sede === sedePermitida; });
  const porDia = {};
  rows.forEach(function (r) {
    if (r.estado === 'Cancelada') return;
    const f = reservasFecha_(r.fecha);
    porDia[f] = (porDia[f] || 0) + 1;
  });
  return { ok: true, dias: porDia };
}

// ---------------------------------------------------------------------------
// MESAS (configuración + estado en vivo)
// ---------------------------------------------------------------------------

function mesasListar_(sede) {
  reservasAsegurarEstructura_();
  return leerTabla_(SHEET_NAMES.RESERVAS_MESAS).filter(function (m) { return m.sede === sede; })
    .sort(function (a, b) { return (Number(a.numero) || 0) - (Number(b.numero) || 0); });
}

function mesasGuardar_(item, usuario) {
  reservasAsegurarEstructura_();
  if (!item || !item.sede || !String(item.numero || '').trim()) return { ok: false, error: 'Falta sede o número de mesa.' };
  reservasSedeValidar_(item.sede);
  const capMin = Number(item.capacidad_min), capMax = Number(item.capacidad_max);
  if (!isFinite(capMin) || !isFinite(capMax) || capMin <= 0 || capMax < capMin) {
    return { ok: false, error: 'Capacidad mínima/máxima inválida.' };
  }
  const sh = sheet_(SHEET_NAMES.RESERVAS_MESAS);
  const todas = leerTabla_(SHEET_NAMES.RESERVAS_MESAS);
  const fila = {
    sede: item.sede, numero: String(item.numero).trim(), capacidad_min: capMin, capacidad_max: capMax,
    ubicacion: String(item.ubicacion || ''), activa: item.activa !== false,
    puede_unirse_con: reservasMesasAString_(item.puede_unirse_con), observaciones: String(item.observaciones || '')
  };
  if (item.id) {
    const existente = todas.find(function (m) { return String(m.id) === String(item.id); });
    if (!existente) return { ok: false, error: 'Mesa no encontrada.' };
    const data = sh.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][idCol]) !== String(item.id)) continue;
      headers.forEach(function (h, c) { if (fila[h] !== undefined) sh.getRange(r + 1, c + 1).setValue(neutralizarFormula_(fila[h])); });
      break;
    }
    if (typeof auditoriaRegistrar_ === 'function') auditoriaRegistrar_(usuario, 'mesa_guardar', 'ReservaMesa', item.id, existente, fila, item.sede, '');
    return { ok: true, item: Object.assign({ id: item.id }, fila) };
  }
  const duplicada = todas.find(function (m) { return m.sede === item.sede && String(m.numero) === fila.numero; });
  if (duplicada) return { ok: false, error: 'Ya existe la mesa ' + fila.numero + ' en ' + item.sede + '.' };
  fila.id = Utilities.getUuid();
  appendRowFromObj_(SHEET_NAMES.RESERVAS_MESAS, fila);
  if (typeof auditoriaRegistrar_ === 'function') auditoriaRegistrar_(usuario, 'mesa_guardar', 'ReservaMesa', fila.id, null, fila, item.sede, '');
  return { ok: true, item: fila };
}

function reservaMesaActiva_(m) { return !(m.activa === false || normalizar_(m.activa) === 'no'); }

/** Estado visual de cada mesa para una fecha+hora (🟢🔴🟡🔵⚫ — ver mapeo de colores en el frontend). */
function mesasEstado_(sede, fecha, hora, usuario) {
  sedeConsultaPermitida_(usuario, sede);
  const f = reservasFecha_(fecha);
  const mesas = mesasListar_(sede);
  const reservasDia = reservasTodas_().filter(function (r) {
    return r.sede === sede && reservasFecha_(r.fecha) === f && RESERVA_ESTADOS_EXCLUIDOS_OCUPACION_.indexOf(r.estado) === -1;
  });
  return mesas.map(function (m) {
    if (!reservaMesaActiva_(m)) return Object.assign({}, m, { estado: 'fuera_servicio', reserva: null });
    const ocupante = reservasDia.find(function (r) {
      if (reservasMesasDeInput_(r.mesas).indexOf(String(m.numero)) === -1) return false;
      return !hora || reservasSeSolapan_(hora, r.hora, RESERVA_DURACION_OCUPACION_MINUTOS_);
    });
    if (!ocupante) return Object.assign({}, m, { estado: 'libre', reserva: null });
    let estadoVisual = 'pendiente';
    if (ocupante.estado === 'Cliente llegó') estadoVisual = 'llego';
    else if (['Confirmada', 'Pendiente de pago', 'Pendiente de verificar pago'].indexOf(ocupante.estado) !== -1) estadoVisual = 'reservada';
    return Object.assign({}, m, {
      estado: estadoVisual,
      reserva: { id: ocupante.id, codigo: ocupante.codigo, nombre_cliente: ocupante.nombre_cliente, personas: ocupante.personas, hora: ocupante.hora, estado: ocupante.estado }
    });
  });
}

/** Sugerencia simple de mesa según capacidad; si ninguna sola alcanza, propone combos permitidos. */
function mesasSugeridas_(sede, fecha, hora, personas, usuario) {
  const n = Number(personas);
  const estados = mesasEstado_(sede, fecha, hora, usuario);
  const libres = estados.filter(function (m) { return m.estado === 'libre'; });
  const exactas = libres.filter(function (m) { return n <= Number(m.capacidad_max) && n >= Number(m.capacidad_min); })
    .sort(function (a, b) { return Number(a.capacidad_max) - Number(b.capacidad_max); });
  if (exactas.length > 0) return { ok: true, sugerencias: exactas.map(function (m) { return [m.numero]; }) };

  const combos = [];
  const vistos = {};
  libres.forEach(function (m) {
    reservasMesasDeInput_(m.puede_unirse_con).forEach(function (otroNumero) {
      const socio = libres.find(function (x) { return String(x.numero) === otroNumero; });
      if (!socio) return;
      const clave = [m.numero, socio.numero].sort().join('+');
      if (vistos[clave]) return;
      vistos[clave] = true;
      if (Number(m.capacidad_max) + Number(socio.capacidad_max) >= n) combos.push([m.numero, socio.numero].sort(function (a, b) { return Number(a) - Number(b); }));
    });
  });
  return { ok: true, sugerencias: combos };
}

// ---------------------------------------------------------------------------
// PANEL PRINCIPAL (dashboard)
// ---------------------------------------------------------------------------

function reservasDetectarChoquesMesa_(rows) {
  const alertas = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (RESERVA_ESTADOS_EXCLUIDOS_OCUPACION_.indexOf(a.estado) !== -1 || RESERVA_ESTADOS_EXCLUIDOS_OCUPACION_.indexOf(b.estado) !== -1) continue;
      if (!reservasSeSolapan_(a.hora, b.hora, RESERVA_DURACION_OCUPACION_MINUTOS_)) continue;
      const comun = reservasMesasDeInput_(a.mesas).some(function (m) { return reservasMesasDeInput_(b.mesas).indexOf(m) !== -1; });
      if (comun) alertas.push('⚠️ Dos reservas están usando la misma mesa: ' + a.codigo + ' y ' + b.codigo + '.');
    }
  }
  return alertas;
}

function reservasAlertas_(hoy, sede, fecha) {
  const alertas = [];
  const ahoraEsHoy = fecha === reservasFecha_(new Date());
  const minsAhora = ahoraEsHoy ? (new Date().getHours() * 60 + new Date().getMinutes()) : null;
  hoy.forEach(function (r) {
    if (r.estado === 'Cancelada') return;
    if (!reservasHoraValida_(r.hora)) { alertas.push('⚠️ Reserva sin hora — ' + r.codigo + ' (' + r.nombre_cliente + ').'); return; }
    if (sede === 'San Antonio' && reservasMesasDeInput_(r.mesas).length === 0 && r.estado !== 'No llegó') {
      alertas.push('⚠️ Reserva sin mesa — ' + r.codigo + ' (' + r.nombre_cliente + ').');
    }
    if (reservaEsDecoracion_(r.decoracion) && r.decoracion_estado_pago === 'Pendiente') {
      alertas.push('⚠️ Decoración pendiente de pago — ' + r.codigo + '.');
    }
    if (r.decoracion_estado_pago === 'Pago por verificar') alertas.push('⚠️ Pago pendiente de verificar — ' + r.codigo + '.');
    if (Number(r.personas) >= RESERVA_GRUPO_GRANDE_MIN_) alertas.push('⚠️ Reserva de grupo grande (' + r.personas + ' personas) — ' + r.codigo + '.');
    if (ahoraEsHoy && RESERVA_ESTADOS_TERMINALES_.indexOf(r.estado) === -1) {
      const minsHora = reservasMinutosDesdeHora_(r.hora);
      if (minsHora - minsAhora <= 30 && minsHora - minsAhora >= 0) alertas.push('⚠️ Reserva próxima a iniciar (' + r.hora + ') — ' + r.codigo + '.');
      if (minsAhora > minsHora + RESERVA_TOLERANCIA_MINUTOS_) alertas.push('⚠️ Cliente llegó tarde, mesa fuera del tiempo de cortesía — ' + r.codigo + '.');
    }
  });
  return alertas.concat(reservasDetectarChoquesMesa_(hoy));
}

function reservasDashboard_(fecha, sede, usuario) {
  const sedeValidada = sedeConsultaPermitida_(usuario, sede) || sede;
  reservasSedeValidar_(sedeValidada);
  const f = reservasFecha_(fecha);
  const rows = reservasTodas_().filter(function (r) { return r.sede === sedeValidada; });
  const hoy = rows.filter(function (r) { return reservasFecha_(r.fecha) === f; }).sort(function (a, b) { return String(a.hora || '').localeCompare(String(b.hora || '')); });
  const hoyActivas = hoy.filter(function (r) { return r.estado !== 'Cancelada' && r.estado !== 'No llegó'; });
  const proximas = rows.filter(function (r) { return reservasFecha_(r.fecha) > f && r.estado !== 'Cancelada' && r.estado !== 'No llegó'; })
    .sort(function (a, b) {
      const fa = reservasFecha_(a.fecha), fb = reservasFecha_(b.fecha);
      return fa === fb ? String(a.hora || '').localeCompare(String(b.hora || '')) : fa.localeCompare(fb);
    }).slice(0, 8);

  return {
    ok: true, fecha: f, sede: sedeValidada,
    hoy: hoy, proximas: proximas,
    total_personas: hoyActivas.reduce(function (s, r) { return s + (Number(r.personas) || 0); }, 0),
    pendientes_completar: hoy.filter(function (r) { return ['Pendiente de información', 'Pendiente de asignar mesa'].indexOf(r.estado) !== -1; }).length,
    pendientes_pago: hoy.filter(function (r) { return r.estado === 'Pendiente de pago'; }).length,
    pendientes_verificar_pago: hoy.filter(function (r) { return r.estado === 'Pendiente de verificar pago'; }).length,
    confirmadas: hoy.filter(function (r) { return ['Confirmada', 'Cliente llegó', 'Finalizada'].indexOf(r.estado) !== -1; }).length,
    alertas: reservasAlertas_(hoy, sedeValidada, f),
    resumen: {
      reservas_hoy: hoy.filter(function (r) { return r.estado !== 'Cancelada'; }).length,
      personas_esperadas: hoyActivas.reduce(function (s, r) { return s + (Number(r.personas) || 0); }, 0),
      cumpleanos: hoy.filter(function (r) { return r.motivo === 'Cumpleaños' && r.estado !== 'Cancelada'; }).length,
      decoraciones: hoy.filter(function (r) { return reservaEsDecoracion_(r.decoracion) && r.estado !== 'Cancelada'; }).length,
      decoraciones_pendientes_pago: hoy.filter(function (r) { return reservaEsDecoracion_(r.decoracion) && r.decoracion_estado_pago === 'Pendiente'; }).length,
      cancelaciones: hoy.filter(function (r) { return r.estado === 'Cancelada'; }).length,
      no_shows: hoy.filter(function (r) { return r.estado === 'No llegó'; }).length
    }
  };
}
