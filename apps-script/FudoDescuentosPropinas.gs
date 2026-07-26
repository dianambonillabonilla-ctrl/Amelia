/**
 * FUDO DESCUENTOS Y PROPINAS (Fase 2 — paso incremental)
 * Extrae discounts/tips de cada venta sincronizada vía API hacia Fudo_Descuentos y Fudo_Propinas.
 * No hay tabla plana previa — se escribe solo desde la respuesta JSON:API de /sales.
 */

function fudoApiRelacionPtrs_(rel) {
  if (!rel) return [];
  if (rel.data) return Array.isArray(rel.data) ? rel.data : [rel.data];
  if (Array.isArray(rel)) {
    return rel.map(function (x) { return x && x.data ? x.data : x; }).filter(Boolean);
  }
  return [];
}

function fudoDescuentosFilasDesdeSale_(sale, incluidos, indiceMapeo, opciones) {
  opciones = opciones || {};
  const referencias = fudoApiReferenciasSedeDesdeSale_(sale, incluidos);
  const sedeResuelta = fudoResolverSedeVenta_(referencias, indiceMapeo);
  const creacion = sale.attributes && sale.attributes.createdAt;
  const filas = [];

  fudoApiRelacionPtrs_(sale.relationships && sale.relationships.discounts).forEach(function (ptr) {
    const discount = fudoApiIncluidoPorPtr_(ptr, incluidos);
    if (!discount || !discount.attributes) return;
    const attrs = discount.attributes;
    const tmplPtr = discount.relationships && discount.relationships.discountTemplate && discount.relationships.discountTemplate.data;
    const tmpl = fudoApiIncluidoPorPtr_(tmplPtr, incluidos);
    filas.push(neutralizarObjetoFormulas_({
      id_descuento: String(ptr.id),
      id_venta: String(sale.id),
      creacion: creacion ? new Date(creacion) : '',
      monto: attrs.amount != null ? Number(attrs.amount) : 0,
      porcentaje: attrs.percentage != null ? Number(attrs.percentage) : '',
      monto_max: attrs.maxAmount != null ? Number(attrs.maxAmount) : '',
      cancelado: !!attrs.canceled,
      plantilla_nombre: fudoApiNombreIncluido_(tmpl),
      sede: sedeResuelta.sede || '',
      archivo_origen: opciones.archivo_origen || '',
      importado_en: opciones.importado_en || new Date()
    }));
  });
  return filas;
}

function fudoPropinasFilasDesdeSale_(sale, incluidos, indiceMapeo, opciones) {
  opciones = opciones || {};
  const referencias = fudoApiReferenciasSedeDesdeSale_(sale, incluidos);
  const sedeResuelta = fudoResolverSedeVenta_(referencias, indiceMapeo);
  const creacion = sale.attributes && sale.attributes.createdAt;
  const filas = [];

  fudoApiRelacionPtrs_(sale.relationships && sale.relationships.tips).forEach(function (ptr) {
    const tip = fudoApiIncluidoPorPtr_(ptr, incluidos);
    if (!tip || !tip.attributes) return;
    const attrs = tip.attributes;
    filas.push(neutralizarObjetoFormulas_({
      id_propina: String(ptr.id),
      id_venta: String(sale.id),
      creacion: creacion ? new Date(creacion) : '',
      monto: attrs.amount != null ? Number(attrs.amount) : 0,
      cancelado: !!attrs.canceled,
      sede: sedeResuelta.sede || '',
      archivo_origen: opciones.archivo_origen || '',
      importado_en: opciones.importado_en || new Date()
    }));
  });
  return filas;
}

function fudoDescuentosPropinasUpsert_(hoja, idCol, filas, idField) {
  if (!filas || !filas.length) return { creados: 0, actualizados: 0, omitidos: 0 };

  const sh = sheet_(hoja);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const colId = headers.indexOf(idCol);
  const filaPorId = {};
  for (let r = 1; r < data.length; r++) {
    filaPorId[String(data[r][colId] || '')] = r + 1;
  }

  let creados = 0;
  let actualizados = 0;
  let omitidos = 0;
  const nuevasFilas = [];

  filas.forEach(function (f) {
    const id = String(f[idField] || '');
    if (!id) { omitidos++; return; }
    const filaExistente = filaPorId[id];
    if (filaExistente && filaExistente > 0) {
      headers.forEach(function (h, c) {
        if (f[h] !== undefined) sh.getRange(filaExistente, c + 1).setValue(f[h]);
      });
      actualizados++;
    } else if (!filaPorId[id]) {
      nuevasFilas.push(f);
      filaPorId[id] = -1;
      creados++;
    } else {
      omitidos++;
    }
  });

  if (nuevasFilas.length) appendRowsFromObjs_(hoja, nuevasFilas);
  return { creados: creados, actualizados: actualizados, omitidos: omitidos };
}

/**
 * Escribe descuentos y propinas de un lote de ventas API — idempotente por id_descuento/id_propina.
 */
function fudoDescuentosPropinasEscribirDesdeSales_(sales, incluidos, indiceMapeo, opciones) {
  if (!sales || !sales.length) return { ok: true, descuentos_creados: 0, descuentos_actualizados: 0, propinas_creadas: 0, propinas_actualizadas: 0, omitidos: 0 };

  opciones = opciones || {};
  const descuentos = [];
  const propinas = [];
  sales.forEach(function (sale) {
    descuentos.push.apply(descuentos, fudoDescuentosFilasDesdeSale_(sale, incluidos, indiceMapeo, opciones));
    propinas.push.apply(propinas, fudoPropinasFilasDesdeSale_(sale, incluidos, indiceMapeo, opciones));
  });

  const rDesc = fudoDescuentosPropinasUpsert_(SHEET_NAMES.FUDO_DESCUENTOS, 'id_descuento', descuentos, 'id_descuento');
  const rProp = fudoDescuentosPropinasUpsert_(SHEET_NAMES.FUDO_PROPINAS, 'id_propina', propinas, 'id_propina');

  return {
    ok: true,
    descuentos_creados: rDesc.creados,
    descuentos_actualizados: rDesc.actualizados,
    propinas_creadas: rProp.creados,
    propinas_actualizadas: rProp.actualizados,
    omitidos: rDesc.omitidos + rProp.omitidos
  };
}

/** Re-sincroniza descuentos/propinas desde la API para un rango (sin reimportar Ventas_FUDO). */
function fudoDescuentosPropinasMigrarDesdeApi_(fechaDesde, fechaHasta) {
  if (!fechaDesde || !fechaHasta) return { ok: false, error: 'Faltan fecha_desde/fecha_hasta' };

  const indiceMapeo = fudoMapeoSedeIndice_();
  const resultado = fudoApiObtenerTodoCompleto_('sales', {
    filtros: {
      createdAt: 'and(gte.' + fechaDesde + 'T00:00:00,lte.' + fechaHasta + 'T23:59:59)',
      saleState: 'in.(CLOSED)'
    },
    include: FUDO_API_SALES_INCLUDE_,
    orden: 'createdAt'
  });

  return fudoDescuentosPropinasEscribirDesdeSales_(resultado.registros, resultado.incluidos, indiceMapeo, {
    archivo_origen: 'Migración API ' + fechaDesde + ' a ' + fechaHasta
  });
}

function fudoDescuentosPropinasEstado_() {
  const descuentos = leerTabla_(SHEET_NAMES.FUDO_DESCUENTOS);
  const propinas = leerTabla_(SHEET_NAMES.FUDO_PROPINAS);
  let montoDescuentos = 0;
  let montoPropinas = 0;
  descuentos.forEach(function (d) {
    if (d.cancelado === true || normalizar_(d.cancelado) === 'si') return;
    montoDescuentos += Number(d.monto) || 0;
  });
  propinas.forEach(function (p) {
    if (p.cancelado === true || normalizar_(p.cancelado) === 'si') return;
    montoPropinas += Number(p.monto) || 0;
  });
  return {
    descuentos: descuentos.length,
    propinas: propinas.length,
    monto_descuentos: Number(montoDescuentos.toFixed(2)),
    monto_propinas: Number(montoPropinas.toFixed(2))
  };
}

function fudoDescuentosListar_(filtros) {
  filtros = filtros || {};
  let rows = leerTabla_(SHEET_NAMES.FUDO_DESCUENTOS);
  if (filtros.fecha_desde) {
    rows = rows.filter(function (d) { return formatearFecha_(d.creacion) >= filtros.fecha_desde; });
  }
  if (filtros.fecha_hasta) {
    rows = rows.filter(function (d) { return formatearFecha_(d.creacion) <= filtros.fecha_hasta; });
  }
  if (filtros.sede && filtros.sede !== 'Ambas') {
    rows = rows.filter(function (d) { return d.sede === filtros.sede; });
  }
  if (filtros.id_venta) {
    rows = rows.filter(function (d) { return String(d.id_venta) === String(filtros.id_venta); });
  }
  return rows.sort(function (a, b) { return new Date(b.creacion) - new Date(a.creacion); });
}

function fudoPropinasListar_(filtros) {
  filtros = filtros || {};
  let rows = leerTabla_(SHEET_NAMES.FUDO_PROPINAS);
  if (filtros.fecha_desde) {
    rows = rows.filter(function (p) { return formatearFecha_(p.creacion) >= filtros.fecha_desde; });
  }
  if (filtros.fecha_hasta) {
    rows = rows.filter(function (p) { return formatearFecha_(p.creacion) <= filtros.fecha_hasta; });
  }
  if (filtros.sede && filtros.sede !== 'Ambas') {
    rows = rows.filter(function (p) { return p.sede === filtros.sede; });
  }
  if (filtros.id_venta) {
    rows = rows.filter(function (p) { return String(p.id_venta) === String(filtros.id_venta); });
  }
  return rows.sort(function (a, b) { return new Date(b.creacion) - new Date(a.creacion); });
}
