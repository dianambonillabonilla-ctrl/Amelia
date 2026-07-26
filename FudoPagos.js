/**
 * FUDO PAGOS NORMALIZADOS (Fase 2 — paso incremental)
 * Dual-write desde Pagos_FUDO hacia Fudo_Pagos.
 * Pagos_FUDO sigue siendo la fuente de lectura para cierre de turno y conciliación —
 * esta tabla prepara la migración sin romper nada existente.
 */

function fudoPagosFilaDesdeFlat_(pago) {
  return neutralizarObjetoFormulas_({
    id_pago: String(pago.id_pago || ''),
    id_venta: String(pago.id_venta || ''),
    fecha: pago.fecha || (pago.creacion ? formatearFecha_(pago.creacion) : ''),
    creacion: pago.creacion || '',
    monto: Number(pago.monto) || 0,
    cancelado: !!pago.cancelado,
    metodo_pago: pago.metodo_pago || '',
    metodo_tipo: pago.metodo_tipo || '',
    sede: pago.sede || '',
    es_efectivo: pagosFudoEsEfectivo_(pago),
    archivo_origen: pago.archivo_origen || '',
    importado_por: pago.importado_por || '',
    importado_en: pago.importado_en || new Date()
  });
}

/**
 * UPSERT por id_pago — idempotente. Se invoca desde pagosFudoImportar_ tras cada sync/import.
 */
function fudoPagosEscribirDesdeFlat_(filasFlat) {
  if (!filasFlat || !filasFlat.length) return { ok: true, creados: 0, actualizados: 0, omitidos: 0 };

  const sh = sheet_(SHEET_NAMES.FUDO_PAGOS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id_pago');
  const filaPorId = {};
  for (let r = 1; r < data.length; r++) {
    filaPorId[String(data[r][idCol] || '')] = r + 1;
  }

  let creados = 0;
  let actualizados = 0;
  let omitidos = 0;
  const nuevasFilas = [];

  filasFlat.forEach(function (f) {
    const idPago = String(f.id_pago || '');
    if (!idPago) { omitidos++; return; }
    const obj = fudoPagosFilaDesdeFlat_(f);
    const filaExistente = filaPorId[idPago];
    if (filaExistente && filaExistente > 0) {
      headers.forEach(function (h, c) {
        if (obj[h] !== undefined) sh.getRange(filaExistente, c + 1).setValue(obj[h]);
      });
      actualizados++;
    } else if (!filaPorId[idPago]) {
      nuevasFilas.push(obj);
      filaPorId[idPago] = -1;
      creados++;
    } else {
      omitidos++;
    }
  });

  if (nuevasFilas.length) appendRowsFromObjs_(SHEET_NAMES.FUDO_PAGOS, nuevasFilas);
  return { ok: true, creados: creados, actualizados: actualizados, omitidos: omitidos };
}

/** Migra todo Pagos_FUDO a Fudo_Pagos (idempotente). Solo Administrador vía API. */
function fudoPagosMigrarDesdeFlat_() {
  return fudoPagosEscribirDesdeFlat_(leerTabla_(SHEET_NAMES.PAGOS_FUDO));
}

/** Totales de pagos normalizados para una fecha/sede — usado en cierre de turno con fallback a plana. */
function fudoPagosTotalesSedeFecha_(fecha, sede) {
  let total = 0;
  let efectivo = 0;
  let cantidad = 0;
  leerTabla_(SHEET_NAMES.FUDO_PAGOS).forEach(function (p) {
    if (formatearFecha_(p.fecha || p.creacion) !== fecha || p.sede !== sede) return;
    if (p.cancelado === true || normalizar_(p.cancelado) === 'si') return;
    const monto = Number(p.monto) || 0;
    total += monto;
    cantidad++;
    if (p.es_efectivo === true) efectivo += monto;
  });
  return {
    pagos_fudo_total: total,
    pagos_efectivo_esperado: efectivo,
    pagos_fudo_cantidad: cantidad,
    registros: cantidad
  };
}

function fudoPagosEstado_() {
  const norm = leerTabla_(SHEET_NAMES.FUDO_PAGOS);
  let efectivo = 0;
  norm.forEach(function (p) {
    if (p.cancelado === true || normalizar_(p.cancelado) === 'si') return;
    if (p.es_efectivo === true) efectivo += Number(p.monto) || 0;
  });
  return {
    flat_registros: leerTabla_(SHEET_NAMES.PAGOS_FUDO).length,
    pagos: norm.length,
    efectivo_total: Number(efectivo.toFixed(2))
  };
}

function fudoPagosListar_(filtros) {
  filtros = filtros || {};
  let pagos = leerTabla_(SHEET_NAMES.FUDO_PAGOS);
  if (filtros.fecha_desde) {
    pagos = pagos.filter(function (p) { return formatearFecha_(p.fecha || p.creacion) >= filtros.fecha_desde; });
  }
  if (filtros.fecha_hasta) {
    pagos = pagos.filter(function (p) { return formatearFecha_(p.fecha || p.creacion) <= filtros.fecha_hasta; });
  }
  if (filtros.sede && filtros.sede !== 'Ambas') {
    pagos = pagos.filter(function (p) { return p.sede === filtros.sede; });
  }
  if (filtros.id_venta) {
    pagos = pagos.filter(function (p) { return String(p.id_venta) === String(filtros.id_venta); });
  }
  if (filtros.solo_efectivo) {
    pagos = pagos.filter(function (p) { return p.es_efectivo === true; });
  }
  return pagos.sort(function (a, b) {
    return new Date(b.creacion || b.fecha) - new Date(a.creacion || a.fecha);
  });
}