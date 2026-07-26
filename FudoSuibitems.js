/**
 * FUDO SUBITEMS (Fase 2 — paso incremental)
 * Extrae modificadores/extras (subitems) de cada venta sincronizada vía API hacia Fudo_Subitems.
 * No hay tabla plana previa — solo captura para análisis y conciliación futura.
 */

function fudoSubitemsFilasDesdeSale_(sale, incluidos, indiceMapeo, opciones) {
  opciones = opciones || {};
  const referencias = fudoApiReferenciasSedeDesdeSale_(sale, incluidos);
  const sedeResuelta = fudoResolverSedeVenta_(referencias, indiceMapeo);
  const filas = [];
  const itemsPtr = fudoApiRelacionPtrs_(sale.relationships && sale.relationships.items);

  itemsPtr.forEach(function (itemPtr) {
    const item = fudoApiIncluidoPorPtr_(itemPtr, incluidos);
    if (!item) return;
    fudoApiRelacionPtrs_(item.relationships && item.relationships.subitems).forEach(function (subPtr) {
      const sub = fudoApiIncluidoPorPtr_(subPtr, incluidos);
      if (!sub || !sub.attributes) return;
      const productoPtr = sub.relationships && sub.relationships.product && sub.relationships.product.data;
      const producto = fudoApiIncluidoPorPtr_(productoPtr, incluidos);
      const nombreProducto = fudoApiNombreIncluido_(producto);
      if (!nombreProducto) return;
      const creacion = sub.attributes.createdAt || item.attributes.createdAt || (sale.attributes && sale.attributes.createdAt);
      filas.push(neutralizarObjetoFormulas_({
        id_subitem: String(subPtr.id),
        clave_subitem: [String(sale.id), String(itemPtr.id), String(subPtr.id)].join('|'),
        id_item: String(itemPtr.id),
        id_venta: String(sale.id),
        creacion: creacion ? new Date(creacion) : '',
        producto: nombreProducto,
        cantidad: Number(sub.attributes.quantity) || 0,
        precio: Number(sub.attributes.price) || 0,
        cancelado: !!sub.attributes.canceled,
        sede: sedeResuelta.sede || '',
        archivo_origen: opciones.archivo_origen || '',
        importado_en: opciones.importado_en || new Date()
      }));
    });
  });
  return filas;
}

function fudoSubitemsUpsert_(filas) {
  if (!filas || !filas.length) return { creados: 0, actualizados: 0, omitidos: 0 };

  const sh = sheet_(SHEET_NAMES.FUDO_SUBITEMS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id_subitem');
  const filaPorId = {};
  for (let r = 1; r < data.length; r++) {
    filaPorId[String(data[r][idCol] || '')] = r + 1;
  }

  let creados = 0;
  let actualizados = 0;
  let omitidos = 0;
  const nuevasFilas = [];

  filas.forEach(function (f) {
    const id = String(f.id_subitem || '');
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

  if (nuevasFilas.length) appendRowsFromObjs_(SHEET_NAMES.FUDO_SUBITEMS, nuevasFilas);
  return { creados: creados, actualizados: actualizados, omitidos: omitidos };
}

function fudoSubitemsEscribirDesdeSales_(sales, incluidos, indiceMapeo, opciones) {
  if (!sales || !sales.length) return { ok: true, creados: 0, actualizados: 0, omitidos: 0 };

  opciones = opciones || {};
  const filas = [];
  sales.forEach(function (sale) {
    filas.push.apply(filas, fudoSubitemsFilasDesdeSale_(sale, incluidos, indiceMapeo, opciones));
  });
  const r = fudoSubitemsUpsert_(filas);
  return { ok: true, creados: r.creados, actualizados: r.actualizados, omitidos: r.omitidos };
}

function fudoSubitemsMigrarDesdeApi_(fechaDesde, fechaHasta) {
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

  return fudoSubitemsEscribirDesdeSales_(resultado.registros, resultado.incluidos, indiceMapeo, {
    archivo_origen: 'Migración API ' + fechaDesde + ' a ' + fechaHasta
  });
}

function fudoSubitemsEstado_() {
  return { subitems: leerTabla_(SHEET_NAMES.FUDO_SUBITEMS).length };
}

function fudoSubitemsListar_(filtros) {
  filtros = filtros || {};
  let rows = leerTabla_(SHEET_NAMES.FUDO_SUBITEMS);
  if (filtros.fecha_desde) {
    rows = rows.filter(function (s) { return formatearFecha_(s.creacion) >= filtros.fecha_desde; });
  }
  if (filtros.fecha_hasta) {
    rows = rows.filter(function (s) { return formatearFecha_(s.creacion) <= filtros.fecha_hasta; });
  }
  if (filtros.sede && filtros.sede !== 'Ambas') {
    rows = rows.filter(function (s) { return s.sede === filtros.sede; });
  }
  if (filtros.id_venta) {
    rows = rows.filter(function (s) { return String(s.id_venta) === String(filtros.id_venta); });
  }
  if (filtros.id_item) {
    rows = rows.filter(function (s) { return String(s.id_item) === String(filtros.id_item); });
  }
  return rows.sort(function (a, b) { return new Date(b.creacion) - new Date(a.creacion); });
}