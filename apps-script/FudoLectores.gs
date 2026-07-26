/**
 * FUDO LECTORES — capa de lectura con fallback a tablas normalizadas.
 * Si Fudo_Items / Fudo_Pagos tienen datos para el alcance consultado, se usan primero;
 * si no, se lee Ventas_FUDO / Pagos_FUDO como antes.
 */

function fudoItemALineaPlana_(item) {
  return {
    id_venta: item.id_venta,
    creacion: item.creacion,
    producto: item.producto,
    categoria: item.categoria || '',
    cantidad: item.cantidad,
    precio: item.precio,
    cancelada: item.cancelada,
    sede: item.sede,
    creada_por: item.creada_por || '',
    formato_origen: item.formato_origen || '',
    archivo_origen: item.archivo_origen || '',
    importado_en: item.importado_en
  };
}

function ventasFudoLineasFiltrar_(lineas, opciones, fuente) {
  opciones = opciones || {};
  if (opciones.sin_canceladas !== false) {
    lineas = lineas.filter(function (v) {
      return typeof ventaCancelada_ === 'function' ? !ventaCancelada_(v)
        : !(v.cancelada === true || normalizar_(v.cancelada) === 'si');
    });
  }
  if (opciones.sede) {
    lineas = lineas.filter(function (v) { return v.sede === opciones.sede; });
  }
  return { lineas: lineas, fuente: fuente };
}

/** Líneas de venta de un día — Fudo_Items si hay datos ese día, si no Ventas_FUDO. */
function ventasFudoLineasParaFecha_(fecha, opciones) {
  opciones = opciones || {};
  let lineas = leerTabla_(SHEET_NAMES.FUDO_ITEMS).filter(function (it) {
    return formatearFecha_(it.creacion) === fecha;
  });
  let fuente = 'Fudo_Items';
  if (!lineas.length) {
    lineas = leerTabla_(SHEET_NAMES.VENTAS_FUDO).filter(function (v) {
      return formatearFecha_(v.creacion) === fecha;
    });
    fuente = 'Ventas_FUDO';
  } else {
    lineas = lineas.map(fudoItemALineaPlana_);
  }
  return ventasFudoLineasFiltrar_(lineas, opciones, fuente);
}

/** Todas las líneas de venta — Fudo_Items si la tabla tiene datos, si no Ventas_FUDO. */
function ventasFudoLineasTodas_(opciones) {
  opciones = opciones || {};
  const items = leerTabla_(SHEET_NAMES.FUDO_ITEMS);
  let lineas;
  let fuente;
  if (items.length) {
    lineas = items.map(fudoItemALineaPlana_);
    fuente = 'Fudo_Items';
  } else {
    lineas = leerTabla_(SHEET_NAMES.VENTAS_FUDO).slice();
    fuente = 'Ventas_FUDO';
  }
  return ventasFudoLineasFiltrar_(lineas, opciones, fuente);
}

/** Cantidad de pagos no cancelados en una fecha (todas las sedes) — Fudo_Pagos con fallback. */
function pagosFudoCantidadFecha_(fecha) {
  let count = 0;
  leerTabla_(SHEET_NAMES.FUDO_PAGOS).forEach(function (p) {
    if (formatearFecha_(p.fecha || p.creacion) !== fecha) return;
    if (p.cancelado === true || normalizar_(p.cancelado) === 'si') return;
    count++;
  });
  if (count > 0) return { registros: count, fuente: 'Fudo_Pagos' };

  count = 0;
  leerTabla_(SHEET_NAMES.PAGOS_FUDO).forEach(function (p) {
    if (formatearFecha_(p.fecha || p.creacion) !== fecha) return;
    if (p.cancelado === true || normalizar_(p.cancelado) === 'si') return;
    count++;
  });
  return { registros: count, fuente: 'Pagos_FUDO' };
}
