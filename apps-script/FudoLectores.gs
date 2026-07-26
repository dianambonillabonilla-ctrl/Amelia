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

/**
 * Agrupa una tabla por el día de `creacion`, calculando la fecha UNA vez por fila.
 *
 * Sin esto, pedir las líneas de un día filtraba la tabla completa, y los cálculos que recorren un
 * rango (Disponible Hoy, libro, conciliación) hacen eso una vez por día: con un año de ventas eran
 * ~20 millones de conversiones de fecha, y formatearFecha_ es una llamada nativa de Apps Script.
 * Se memoiza en el alcance de solo lectura de conCacheDeTablas_ (ver Code.gs); fuera de ese alcance
 * se recalcula, que es exactamente el comportamiento anterior.
 */
function fudoLineasPorFecha_(nombreHoja) {
  function construir() {
    const porFecha = {};
    leerTabla_(nombreHoja).forEach(function (fila) {
      const f = formatearFecha_(fila.creacion);
      if (!f) return;
      if (!porFecha[f]) porFecha[f] = [];
      porFecha[f].push(fila);
    });
    return porFecha;
  }
  // Sin Code.gs cargado (pruebas que usan este archivo suelto) se construye sin memoizar.
  return typeof memoEnCacheDeTablas_ === 'function'
    ? memoEnCacheDeTablas_('lineas_por_fecha|' + nombreHoja, construir)
    : construir();
}

/**
 * Líneas de venta de un día — Fudo_Items si hay datos ese día, si no Ventas_FUDO.
 * El fallback se decide POR DÍA (no por tabla): una instalación puede tener julio ya normalizado en
 * Fudo_Items y junio solo en la tabla plana.
 */
function ventasFudoLineasParaFecha_(fecha, opciones) {
  opciones = opciones || {};
  const items = fudoLineasPorFecha_(SHEET_NAMES.FUDO_ITEMS)[fecha] || [];
  if (items.length) {
    return ventasFudoLineasFiltrar_(items.map(fudoItemALineaPlana_), opciones, 'Fudo_Items');
  }
  const planas = fudoLineasPorFecha_(SHEET_NAMES.VENTAS_FUDO)[fecha] || [];
  return ventasFudoLineasFiltrar_(planas.slice(), opciones, 'Ventas_FUDO');
}

/** Subítems/modificadores de un día — solo Fudo_Subitems (sin tabla plana). */
function subitemsFudoParaFecha_(fecha, opciones) {
  opciones = opciones || {};
  const lineas = fudoLineasPorFecha_(SHEET_NAMES.FUDO_SUBITEMS)[fecha] || [];
  if (!lineas.length) return { lineas: [], fuente: null };
  return ventasFudoLineasFiltrar_(lineas.map(fudoSubitemALineaPlana_), opciones, 'Fudo_Subitems');
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

const FUDO_FECHAS_CACHE_PREFIJO_ = '__fechas_con_ventas__';

/**
 * Días (yyyy-MM-dd) que de verdad tienen alguna línea de venta en `sede`, leyendo las tablas de
 * Fudo UNA sola vez y memoizando el resultado en el mismo objeto de caché que ya comparten
 * movimientosDesdeVentas_/movimientosDesdeCancelaciones_.
 *
 * Existe porque los cálculos que necesitan "consumo por venta acumulado" (Disponible Hoy, libro,
 * inventario teórico) recorrían el rango de fechas día por día con fechasEnRangoMovimientos_ y
 * pedían las tablas completas de Fudo una vez por día de CALENDARIO — no por día con datos. Con un
 * producto que todavía no tiene conteo físico el rango arrancaba en 1970, o sea ~20.000 días y
 * ~62.000 lecturas al Sheet para un solo producto: imposible de terminar dentro del límite de 6
 * minutos de Apps Script.
 *
 * Devuelve la unión de las fechas presentes en Fudo_Items, Ventas_FUDO y Fudo_Subitems (no solo la
 * tabla que "gane" el fallback) a propósito: es un superconjunto de los días que
 * ventasFudoLineasParaConsumo_ podría resolver por cualquiera de sus dos caminos, así que ningún
 * día con datos se queda fuera. Un día de más solo cuesta una consulta memoizada que devuelve [].
 */
function fudoFechasConVentas_(sede, cache) {
  const claveCache = FUDO_FECHAS_CACHE_PREFIJO_ + '|' + (sede || '');
  if (cache && cache[claveCache]) return cache[claveCache];

  // Reutiliza el índice por fecha (fudoLineasPorFecha_) en vez de recorrer las tres tablas de nuevo:
  // la fecha de cada fila ya se calculó al armarlo.
  const fechas = {};
  [SHEET_NAMES.FUDO_ITEMS, SHEET_NAMES.VENTAS_FUDO, SHEET_NAMES.FUDO_SUBITEMS].forEach(function (hoja) {
    const porFecha = fudoLineasPorFecha_(hoja);
    Object.keys(porFecha).forEach(function (f) {
      if (fechas[f]) return;
      const hayDeEsaSede = !sede || sede === 'Ambas' ||
        porFecha[f].some(function (linea) { return linea.sede === sede; });
      if (hayDeEsaSede) fechas[f] = true;
    });
  });

  const lista = Object.keys(fechas).sort();
  if (cache) cache[claveCache] = lista;
  return lista;
}

/**
 * Igual que fudoFechasConVentas_ pero acotado: solo los días estrictamente posteriores a
 * `despuesDe` (vacío = sin tope inferior) y hasta `hasta` inclusive. Sin `hasta` no devuelve nada,
 * porque un cálculo "hasta el corte" sin fecha de corte no tiene rango que recorrer.
 */
function fudoFechasConVentasEnRango_(sede, despuesDe, hasta, cache) {
  if (!hasta) return [];
  return fudoFechasConVentas_(sede, cache).filter(function (f) {
    if (despuesDe && f <= despuesDe) return false;
    return f <= hasta;
  });
}
