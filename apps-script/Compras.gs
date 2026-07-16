/**
 * COMPRAS / FACTURAS
 * Registra la factura completa que trae materia prima, bebidas u otros productos al inventario.
 * Cada línea entra a una sede/punto (por defecto Centro de Producción / General) con cantidad y
 * costo, para que Diana pueda auditar tanto el inventario como el gasto por proveedor/producto.
 */

function compraGuardar_(factura, lineas, usuario) {
  factura = factura || {};
  lineas = lineas || [];
  if (!factura.fecha || !factura.proveedor || !factura.sede_ingreso) {
    return { ok: false, error: 'Faltan datos de factura (fecha, proveedor y sede de ingreso)' };
  }
  if (!lineas.length) return { ok: false, error: 'Agrega al menos una línea de compra' };

  let totalLineas = 0;
  const lineasNormalizadas = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (!l.producto || !l.unidad) return { ok: false, error: 'Cada línea debe tener producto y unidad' };
    const cantidad = Number(l.cantidad);
    const costoUnitario = Number(l.costo_unitario || 0);
    if (isNaN(cantidad) || cantidad <= 0) return { ok: false, error: 'La cantidad de cada línea debe ser mayor que cero' };
    if (isNaN(costoUnitario) || costoUnitario < 0) return { ok: false, error: 'El costo unitario no puede ser negativo' };
    const costoTotal = l.costo_total !== undefined && l.costo_total !== '' ? Number(l.costo_total) : cantidad * costoUnitario;
    if (isNaN(costoTotal) || costoTotal < 0) return { ok: false, error: 'El costo total de cada línea no puede ser negativo' };
    totalLineas += costoTotal;
    lineasNormalizadas.push({
      producto: l.producto,
      categoria: l.categoria || '',
      unidad: l.unidad,
      cantidad: cantidad,
      costo_unitario: costoUnitario,
      costo_total: costoTotal
    });
  }

  const facturaId = Utilities.getUuid();
  const subtotal = factura.subtotal !== undefined && factura.subtotal !== '' ? Number(factura.subtotal) : totalLineas;
  const impuestos = factura.impuestos !== undefined && factura.impuestos !== '' ? Number(factura.impuestos) : 0;
  const total = factura.total !== undefined && factura.total !== '' ? Number(factura.total) : subtotal + impuestos;
  const timestamp = new Date();
  appendRowFromObj_(SHEET_NAMES.COMPRAS_FACTURAS, {
    id: facturaId,
    fecha: factura.fecha,
    proveedor: factura.proveedor,
    numero_factura: factura.numero_factura || '',
    sede_ingreso: factura.sede_ingreso,
    punto_ingreso: factura.punto_ingreso || 'General',
    subtotal: subtotal,
    impuestos: impuestos,
    total: total,
    metodo_pago: factura.metodo_pago || '',
    notas: factura.notas || '',
    usuario: usuario.nombre,
    timestamp: timestamp
  });

  lineasNormalizadas.forEach(function (l) {
    appendRowFromObj_(SHEET_NAMES.COMPRAS_LINEAS, {
      id: Utilities.getUuid(),
      factura_id: facturaId,
      fecha: factura.fecha,
      proveedor: factura.proveedor,
      numero_factura: factura.numero_factura || '',
      sede_ingreso: factura.sede_ingreso,
      punto_ingreso: factura.punto_ingreso || 'General',
      producto: l.producto,
      categoria: l.categoria,
      unidad: l.unidad,
      cantidad: l.cantidad,
      costo_unitario: l.costo_unitario,
      costo_total: l.costo_total,
      usuario: usuario.nombre,
      timestamp: timestamp
    });
  });

  return { ok: true, factura_id: facturaId, lineas: lineasNormalizadas.length, total: total };
}

function comprasListar_(fecha, sede) {
  let facturas = leerTabla_(SHEET_NAMES.COMPRAS_FACTURAS);
  if (fecha) facturas = facturas.filter(function (f) { return formatearFecha_(f.fecha) === fecha; });
  if (sede) facturas = facturas.filter(function (f) { return f.sede_ingreso === sede; });

  let lineas = leerTabla_(SHEET_NAMES.COMPRAS_LINEAS);
  const ids = {};
  facturas.forEach(function (f) { ids[f.id] = true; });
  lineas = lineas.filter(function (l) { return ids[l.factura_id]; });
  return {
    facturas: facturas.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); }),
    lineas: lineas
  };
}

function comprasNetasPorItem_(fecha, sede, indice) {
  const totales = {};
  leerTabla_(SHEET_NAMES.COMPRAS_LINEAS).filter(function (l) {
    return formatearFecha_(l.fecha) === fecha && (!sede || l.sede_ingreso === sede);
  }).forEach(function (l) {
    const base = aUnidadBase_(l.cantidad, l.unidad);
    const clave = claveProducto_(l.producto, indice);
    if (!totales[clave]) totales[clave] = { cantidad: 0, costo: 0, unidad: base.unidad };
    if (totales[clave].unidad !== base.unidad) return;
    totales[clave].cantidad += base.cantidad;
    totales[clave].costo += Number(l.costo_total) || 0;
  });
  return totales;
}
