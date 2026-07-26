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

function fudoSubitemALineaPlana_(subitem) {
  return {
    id_venta: subitem.id_venta,
    id_item: subitem.id_item,
    creacion: subitem.creacion,
    producto: subitem.producto,
    categoria: '',
    cantidad: subitem.cantidad,
    precio: subitem.precio,
    cancelada: subitem.cancelado === true || normalizar_(subitem.cancelado) === 'si',
    sede: subitem.sede,
    creada_por: '',
    formato_origen: '',
    archivo_origen: subitem.archivo_origen || '',
    importado_en: subitem.importado_en,
    es_subitem: true
  };
}

function ventaFudoCancelada_(v) {
  return typeof ventaCancelada_ === 'function' ? ventaCancelada_(v)
    : (v.cancelada === true || normalizar_(v.cancelada) === 'si');
}

function ventasFudoLineasFiltrar_(lineas, opciones, fuente) {
  opciones = opciones || {};
  if (opciones.solo_canceladas) {
    lineas = lineas.filter(function (v) { return ventaFudoCancelada_(v); });
  } else if (opciones.sin_canceladas !== false) {
    lineas = lineas.filter(function (v) { return !ventaFudoCancelada_(v); });
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

/** Subítems/modificadores de un día — solo Fudo_Subitems (sin tabla plana). */
function subitemsFudoParaFecha_(fecha, opciones) {
  opciones = opciones || {};
  let lineas = leerTabla_(SHEET_NAMES.FUDO_SUBITEMS).filter(function (s) {
    return formatearFecha_(s.creacion) === fecha;
  });
  if (!lineas.length) return { lineas: [], fuente: null };
  lineas = lineas.map(fudoSubitemALineaPlana_);
  return ventasFudoLineasFiltrar_(lineas, opciones, 'Fudo_Subitems');
}

/** Líneas canceladas de un día — Fudo_Items con fallback a Ventas_FUDO. */
function ventasFudoLineasCanceladasParaFecha_(fecha, opciones) {
  return ventasFudoLineasParaFecha_(fecha, Object.assign({}, opciones || {}, { solo_canceladas: true, sin_canceladas: false }));
}

/**
 * Líneas para consumo por venta (conciliación comida, libro) — ítems + subítems si existen.
 * Si Fudo_Subitems está vacío para ese día, el resultado es idéntico a ventasFudoLineasParaFecha_.
 */
function ventasFudoLineasParaConsumo_(fecha, opciones) {
  const base = ventasFudoLineasParaFecha_(fecha, opciones);
  const subData = subitemsFudoParaFecha_(fecha, opciones);
  if (!subData.lineas.length) {
    return { lineas: base.lineas, fuente: base.fuente, fuente_subitems: null };
  }
  return {
    lineas: base.lineas.concat(subData.lineas),
    fuente: base.fuente,
    fuente_subitems: subData.fuente
  };
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

/** Índice id_venta → sede — Fudo_Items si hay datos, si no Ventas_FUDO. */
function ventasFudoIndiceSedePorVenta_() {
  const indice = {};
  const items = leerTabla_(SHEET_NAMES.FUDO_ITEMS);
  if (items.length) {
    items.forEach(function (it) {
      const id = String(it.id_venta || '');
      if (!id || indice[id] || !it.sede) return;
      indice[id] = it.sede;
    });
    return indice;
  }
  leerTabla_(SHEET_NAMES.VENTAS_FUDO).forEach(function (v) {
    const id = String(v.id_venta || '');
    if (!id || indice[id] || !v.sede) return;
    indice[id] = v.sede;
  });
  return indice;
}

/**
 * Todas las líneas para consumo por receta — ítems + subítems si Fudo_Subitems tiene datos.
 */
function ventasFudoLineasTodasParaConsumo_(opciones) {
  const base = ventasFudoLineasTodas_(opciones);
  const subData = subitemsFudoTodas_(opciones);
  if (!subData.lineas.length) {
    return { lineas: base.lineas, fuente: base.fuente, fuente_subitems: null };
  }
  return {
    lineas: base.lineas.concat(subData.lineas),
    fuente: base.fuente,
    fuente_subitems: subData.fuente
  };
}

/** Subítems de todo el histórico — solo Fudo_Subitems. */
function subitemsFudoTodas_(opciones) {
  opciones = opciones || {};
  let lineas = leerTabla_(SHEET_NAMES.FUDO_SUBITEMS);
  if (!lineas.length) return { lineas: [], fuente: null };
  lineas = lineas.map(fudoSubitemALineaPlana_);
  return ventasFudoLineasFiltrar_(lineas, opciones, 'Fudo_Subitems');
}
