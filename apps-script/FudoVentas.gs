/**
 * FUDO VENTAS NORMALIZADAS (Fase 2 — paso incremental)
 * Dual-write desde Ventas_FUDO (plana) hacia Fudo_Ventas + Fudo_Items.
 * Ventas_FUDO sigue siendo la fuente de lectura para Conciliación y el resto del sistema.
 *
 * Regla de cantidades (ago 2026): si Ventas_FUDO trae cantidad vacía porque el producto no es una
 * bebida confiable, Fudo_Items debe conservarla VACÍA. El valor económico va por separado.
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
  const cantidadVacia = filaFlat.cantidad === '' || filaFlat.cantidad === null || filaFlat.cantidad === undefined;
  return neutralizarObjetoFormulas_({
    id: Utilities.getUuid(),
    clave_item: claveVenta_(filaFlat),
    id_venta: String(filaFlat.id_venta || ''),
    creacion: filaFlat.creacion,
    producto: filaFlat.producto,
    categoria: filaFlat.categoria || '',
    cantidad: cantidadVacia ? '' : (Number(filaFlat.cantidad) || 0),
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
    // En FUDO, `precio` ya representa el valor económico de la línea; no depende de la cantidad.
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
  Object.keys(ventasTocadas).forEach(function (idVenta) { fudoVentasRecalcularCabecera_(idVenta); });

  return {
    ok: true,
    items_creados: itemsNuevos.length,
    ventas_actualizadas: Object.keys(ventasTocadas).length,
    omitidos: omitidos
  };
}

function fudoVentasMigrarDesdeFlat_() {
  const filas = leerTabla_(SHEET_NAMES.VENTAS_FUDO);
  return fudoVentasEscribirDesdeFlat_(filas);
}

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
