/**
 * PAGOS DE FUDO
 * Snapshot de GET /payments hacia Pagos_FUDO — referencia para cierre de turno y conciliación de
 * efectivo. La sede de cada pago se infiere del id de venta ya sincronizado en Ventas_FUDO (por eso
 * conviene sincronizar ventas antes que pagos en el mismo rango de fechas).
 */

function pagosFudoIndiceSedePorVenta_() {
  const indice = {};
  leerTabla_(SHEET_NAMES.VENTAS_FUDO).forEach(function (v) {
    const id = String(v.id_venta || '');
    if (!id || indice[id]) return;
    if (v.sede) indice[id] = v.sede;
  });
  return indice;
}

function pagosFudoEsEfectivo_(pago) {
  if (normalizar_(pago.metodo_tipo) === 'cash') return true;
  const nombre = normalizar_(pago.metodo_pago);
  return nombre.indexOf('efectivo') !== -1 || nombre === 'cash' || nombre.indexOf('cash') !== -1;
}

/** Totales de pagos Fudo no cancelados para una fecha/sede — usado en turnoResumenCierre_ (Turnos.gs). */
function pagosFudoTotalesSedeFecha_(fecha, sede) {
  let total = 0;
  let efectivo = 0;
  let cantidad = 0;
  leerTabla_(SHEET_NAMES.PAGOS_FUDO).forEach(function (p) {
    if (formatearFecha_(p.fecha || p.creacion) !== fecha || p.sede !== sede) return;
    if (p.cancelado === true || normalizar_(p.cancelado) === 'si') return;
    const monto = Number(p.monto) || 0;
    total += monto;
    cantidad++;
    if (pagosFudoEsEfectivo_(p)) efectivo += monto;
  });
  return { pagos_fudo_total: total, pagos_efectivo_esperado: efectivo, pagos_fudo_cantidad: cantidad };
}

function clavePagoFudo_(p) {
  return String(p.id_pago || '');
}

/**
 * UPSERT por id_pago — un mismo pago de Fudo no se duplica aunque se sincronice dos veces el mismo
 * rango. Pagos sin id se omiten.
 */
function pagosFudoImportar_(filas, usuario, opciones) {
  if (!filas || !filas.length) return { ok: true, importados: 0, actualizados: 0, omitidos: 0 };
  opciones = opciones || {};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, error: 'Otra importación de pagos FUDO está en curso ahora mismo — espera un momento y vuelve a intentarlo.' };
  }
  try {
    const sh = sheet_(SHEET_NAMES.PAGOS_FUDO);
    const data = sh.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id_pago');
    const filaPorId = {};
    for (let r = 1; r < data.length; r++) {
      filaPorId[String(data[r][idCol] || '')] = r + 1;
    }

    const ahora = new Date();
    const archivo = opciones.archivo || '';
    let importados = 0;
    let actualizados = 0;
    let omitidos = 0;
    const nuevasFilas = [];
    const procesados = [];

    filas.forEach(function (f) {
      const idPago = String(f.id_pago || '');
      if (!idPago) { omitidos++; return; }
      const obj = neutralizarObjetoFormulas_({
        id_pago: idPago,
        id_venta: String(f.id_venta || ''),
        fecha: f.fecha || (f.creacion ? formatearFecha_(f.creacion) : ''),
        creacion: f.creacion || '',
        monto: f.monto,
        cancelado: !!f.cancelado,
        metodo_pago: f.metodo_pago || '',
        metodo_tipo: f.metodo_tipo || '',
        sede: f.sede || FUDO_SEDE_SIN_IDENTIFICAR_,
        archivo_origen: archivo,
        importado_por: usuario.nombre,
        importado_en: ahora
      });
      procesados.push(obj);
      const filaExistente = filaPorId[idPago];
      if (filaExistente) {
        headers.forEach(function (h, c) {
          if (obj[h] !== undefined) sh.getRange(filaExistente, c + 1).setValue(obj[h]);
        });
        actualizados++;
      } else {
        nuevasFilas.push(obj);
        importados++;
      }
    });
    appendRowsFromObjs_(SHEET_NAMES.PAGOS_FUDO, nuevasFilas);
    if (typeof fudoPagosEscribirDesdeFlat_ === 'function' && procesados.length) {
      fudoPagosEscribirDesdeFlat_(procesados);
    }
    return { ok: true, importados: importados, actualizados: actualizados, omitidos: omitidos, tipo: 'pagos' };
  } finally {
    lock.releaseLock();
  }
}
