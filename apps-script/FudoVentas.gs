/**
 * FUDO VENTAS NORMALIZADAS (Fase 2 — paso incremental)
 * Dual-write desde Ventas_FUDO (plana) hacia Fudo_Ventas + Fudo_Items.
 * Ventas_FUDO sigue siendo la fuente de lectura para Conciliación y el resto del sistema —
 * estas tablas preparan la migración sin romper nada existente.
 */

/**
 * Cantidad de ocurrencias ya guardadas por clave_item.
 *
 * Una venta de FUDO puede traer el mismo producto varias veces como ítems distintos (por ejemplo,
 * tres Combo Libra agregados por separado). La clave de negocio es igual para los tres, así que un
 * índice booleano descartaba el segundo y el tercero. Contar ocurrencias permite conservarlos y, al
 * mismo tiempo, seguir siendo idempotentes cuando se vuelve a migrar el mismo histórico.
 */
function fudoVentasIndiceItems_() {
  const indice = {};
  leerTabla_(SHEET_NAMES.FUDO_ITEMS).forEach(function (item) {
    const clave = String(item.clave_item || '');
    if (!clave) return;
    indice[clave] = (indice[clave] || 0) + 1;
  });
  return indice;
}

function fudoVentasFilaItem_(filaFlat) {
  const cancelada = ventaCancelada_(filaFlat);
  return neutralizarObjetoFormulas_({
    id: Utilities.getUuid(),
    clave_item: claveVenta_(filaFlat),
    id_venta: String(filaFlat.id_venta || ''),
    creacion: filaFlat.creacion,
    producto: filaFlat.producto,
    categoria: filaFlat.categoria || '',
    cantidad: Number(filaFlat.cantidad) || 0,
    precio: Number(filaFlat.precio) || 0,
    cancelada: cancelada,
    sede: filaFlat.sede || '',
    creada_por: filaFlat.creada_por || '',
    formato_origen: filaFlat.formato_origen || '',
    archivo_origen: filaFlat.archivo_origen || '',
    importado_en: filaFlat.importado_en || new Date()
  });
}

function fudoVentasCabeceraDesdeItems_(idVenta, items) {
  if (!items.length) return null;
  const primera = items[0];
  let montoTotal = 0;
  let canceladas = 0;
  items.forEach(function (it) {
    const cancelada = it.cancelada === true || ventaCancelada_(it);
    if (cancelada) canceladas++;
    // En la API/export detallado de FUDO, `precio` ya es el total de esa línea. `cantidad` describe
    // cuántas unidades contiene la línea, pero volver a multiplicarla infla extras como "Aioli x2".
    // Caso real 31359: 3×Combo (tres filas) + Aioli x2 ($6.000 línea) + Cebollita x2 ($6.000 línea)
    // + domicilio $16.000 = $304.000, exactamente el pago reportado por FUDO.
    else montoTotal += Number(it.precio) || 0;
  });
  return neutralizarObjetoFormulas_({
    id_venta: String(idVenta),
    creacion: primera.creacion,
    sede: primera.sede || '',
    creada_por: primera.creada_por || '',
    formato_origen: primera.formato_origen || '',
    archivo_origen: primera.archivo_origen || '',
    importado_en: primera.importado_en || new Date(),
    items_count: items.length,
    monto_total: Number(montoTotal.toFixed(2)),
    lineas_canceladas: canceladas
  });
}

function fudoVentasRecalcularCabecera_(idVenta) {
  const items = leerTabla_(SHEET_NAMES.FUDO_ITEMS).filter(function (it) {
    return String(it.id_venta) === String(idVenta);
  });
  const cabecera = fudoVentasCabeceraDesdeItems_(idVenta, items);
  if (!cabecera) return;

  const sh = sheet_(SHEET_NAMES.FUDO_VENTAS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id_venta');
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) !== String(idVenta)) continue;
    headers.forEach(function (h, c) {
      if (cabecera[h] !== undefined) sh.getRange(r + 1, c + 1).setValue(cabecera[h]);
    });
    return;
  }
  appendRowFromObj_(SHEET_NAMES.FUDO_VENTAS, cabecera);
}

/**
 * Escribe filas del formato plano en Fudo_Items/Fudo_Ventas.
 *
 * Idempotencia por NÚMERO DE OCURRENCIA de clave_item: si el histórico plano tiene tres filas con la
 * misma clave y Fudo_Items solo conserva una por el bug anterior, una migración crea las dos faltantes.
 * Al repetir la migración, las tres ocurrencias ya existen y no se duplica ninguna.
 */
function fudoVentasEscribirDesdeFlat_(filasFlat) {
  if (!filasFlat || !filasFlat.length) return { ok: true, items_creados: 0, ventas_actualizadas: 0, omitidos: 0 };

  const ocurrenciasExistentes = fudoVentasIndiceItems_();
  const ocurrenciasVistas = {};
  const itemsNuevos = [];
  const ventasTocadas = {};
  let omitidos = 0;

  filasFlat.forEach(function (fila) {
    const idVenta = String(fila.id_venta || '');
    if (idVenta) ventasTocadas[idVenta] = true;

    const clave = claveVenta_(fila);
    ocurrenciasVistas[clave] = (ocurrenciasVistas[clave] || 0) + 1;
    if (ocurrenciasVistas[clave] <= (ocurrenciasExistentes[clave] || 0)) {
      omitidos++;
      return;
    }

    itemsNuevos.push(fudoVentasFilaItem_(fila));
  });

  if (itemsNuevos.length) appendRowsFromObjs_(SHEET_NAMES.FUDO_ITEMS, itemsNuevos);
  // Se recalculan también ventas cuyas filas ya existían. Esto repara montos históricos calculados
  // como cantidad × precio, incluso cuando no hacía falta insertar un ítem nuevo.
  Object.keys(ventasTocadas).forEach(function (idVenta) { fudoVentasRecalcularCabecera_(idVenta); });

  return {
    ok: true,
    items_creados: itemsNuevos.length,
    ventas_actualizadas: Object.keys(ventasTocadas).length,
    omitidos: omitidos
  };
}

/** Migra todo Ventas_FUDO a las tablas normalizadas (idempotente y reparadora). Solo Administrador vía API. */
function fudoVentasMigrarDesdeFlat_() {
  const filas = leerTabla_(SHEET_NAMES.VENTAS_FUDO);
  return fudoVentasEscribirDesdeFlat_(filas);
}

/** Totales de ventas agrupadas para una fecha/sede — usado en cierre de turno con fallback a plana. */
function fudoVentasTotalesSedeFecha_(fecha, sede) {
  let total = 0;
  let cantidad = 0;
  leerTabla_(SHEET_NAMES.FUDO_VENTAS).forEach(function (v) {
    if (formatearFecha_(v.creacion) !== fecha || v.sede !== sede) return;
    cantidad++;
    total += Number(v.monto_total) || 0;
  });
  return {
    ventas_fudo_total: Number(total.toFixed(2)),
    ventas_fudo_cantidad: cantidad,
    registros: cantidad
  };
}

function fudoVentasEstado_() {
  return {
    flat_lineas: leerTabla_(SHEET_NAMES.VENTAS_FUDO).length,
    ventas: leerTabla_(SHEET_NAMES.FUDO_VENTAS).length,
    items: leerTabla_(SHEET_NAMES.FUDO_ITEMS).length
  };
}

function fudoVentasListar_(filtros) {
  filtros = filtros || {};
  let ventas = leerTabla_(SHEET_NAMES.FUDO_VENTAS);
  if (filtros.fecha_desde) {
    ventas = ventas.filter(function (v) { return formatearFecha_(v.creacion) >= filtros.fecha_desde; });
  }
  if (filtros.fecha_hasta) {
    ventas = ventas.filter(function (v) { return formatearFecha_(v.creacion) <= filtros.fecha_hasta; });
  }
  if (filtros.sede && filtros.sede !== 'Ambas') {
    ventas = ventas.filter(function (v) { return v.sede === filtros.sede; });
  }
  return ventas.sort(function (a, b) {
    return new Date(b.creacion) - new Date(a.creacion);
  });
}

function fudoItemsListar_(filtros) {
  filtros = filtros || {};
  let items = leerTabla_(SHEET_NAMES.FUDO_ITEMS);
  if (filtros.id_venta) {
    items = items.filter(function (it) { return String(it.id_venta) === String(filtros.id_venta); });
  }
  if (filtros.fecha_desde) {
    items = items.filter(function (it) { return formatearFecha_(it.creacion) >= filtros.fecha_desde; });
  }
  if (filtros.fecha_hasta) {
    items = items.filter(function (it) { return formatearFecha_(it.creacion) <= filtros.fecha_hasta; });
  }
  if (filtros.sede && filtros.sede !== 'Ambas') {
    items = items.filter(function (it) { return it.sede === filtros.sede; });
  }
  return items.sort(function (a, b) {
    return new Date(b.creacion) - new Date(a.creacion);
  });
}
