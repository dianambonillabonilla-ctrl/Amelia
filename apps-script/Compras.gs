/**
 * COMPRAS (FACTURAS)
 * Registra una factura de compra completa (fecha, sede, proveedor, número de factura) con varias
 * líneas de producto — ej. la compra de Diana en Mercamío: parte de materia prima cruda, parte
 * bebidas, parte insumos. Cada línea se guarda como un movimiento "Compra cruda" en
 * Ajustes_Inventario (mismo mecanismo que ya usa Conciliacion.gs para el cuadre de cantidades),
 * pero además queda el proveedor/factura/costo para que el administrador sepa cuánto costó,
 * a quién y desglosado por producto — cosa que Ajustes_Inventario por sí solo no capturaba.
 *
 * No está limitado a materia prima cruda ni al Centro de Producción: cualquier sede puede
 * registrar una factura (ej. San Antonio comprando bebidas directamente), porque el inventario
 * de Dilana OS no es solo comida — también bebidas, aseo, papelería, menaje (ver Catalogo.gs).
 */

function compraRegistrarFactura_(factura, usuario) {
  if (!factura || !factura.fecha || !factura.sede || !factura.proveedor) {
    return { ok: false, error: 'Faltan datos de la factura (fecha, sede y proveedor son obligatorios)' };
  }
  if (usuario.sede !== 'Ambas' && factura.sede !== usuario.sede) {
    return { ok: false, error: 'No puedes registrar compras para una sede distinta a la tuya (' + usuario.sede + ')' };
  }
  const lineas = factura.lineas || [];
  if (!lineas.length) return { ok: false, error: 'Agrega al menos una línea de producto' };
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (!l.producto || !l.unidad) return { ok: false, error: 'Línea ' + (i + 1) + ': producto y unidad son obligatorios' };
    if (isNaN(Number(l.cantidad)) || Number(l.cantidad) <= 0) return { ok: false, error: 'Línea ' + (i + 1) + ' (' + l.producto + '): la cantidad debe ser mayor que cero' };
    if (l.costo !== undefined && l.costo !== '' && (isNaN(Number(l.costo)) || Number(l.costo) < 0)) {
      return { ok: false, error: 'Línea ' + (i + 1) + ' (' + l.producto + '): el costo no puede ser negativo' };
    }
  }

  const facturaId = Utilities.getUuid();
  let total = 0;
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    catalogoAsegurar_(l.producto, l.unidad);
    const costo = l.costo !== undefined && l.costo !== '' ? Number(l.costo) : 0;
    const resultadoAjuste = ajusteInventarioRegistrar_({
      fecha: factura.fecha,
      sede: factura.sede,
      punto: factura.punto || '',
      tipo: 'Compra cruda',
      producto: l.producto,
      unidad: l.unidad,
      cantidad: l.cantidad,
      motivo: factura.numero_factura ? ('Factura ' + factura.numero_factura + ' — ' + factura.proveedor) : ('Compra — ' + factura.proveedor),
      proveedor: factura.proveedor,
      numero_factura: factura.numero_factura || '',
      costo: costo,
      factura_id: facturaId
    }, usuario);
    // Antes se ignoraba este resultado: si ajusteInventarioRegistrar_ rechazaba una línea (ej. una
    // validación interna), la factura igual se reportaba como guardada con éxito sin que quedara
    // ningún movimiento de inventario registrado para esa línea. Ahora se corta y se avisa.
    if (!resultadoAjuste.ok) {
      return { ok: false, error: 'Línea ' + (i + 1) + ' (' + l.producto + '): ' + resultadoAjuste.error };
    }
    total += costo;
  }

  return { ok: true, factura_id: facturaId, lineas: lineas.length, total: Number(total.toFixed(2)) };
}

/** Lista facturas agrupadas por factura_id (cada una con sus líneas), más recientes primero. */
function comprasListar_(fechaDesde, fechaHasta, sede) {
  let rows = leerTabla_(SHEET_NAMES.AJUSTES_INVENTARIO).filter(function (r) { return r.tipo === 'Compra cruda' && r.factura_id; });
  if (fechaDesde) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) >= fechaDesde; });
  if (fechaHasta) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) <= fechaHasta; });
  if (sede) rows = rows.filter(function (r) { return r.sede === sede; });

  const facturas = {};
  rows.forEach(function (r) {
    if (!facturas[r.factura_id]) {
      facturas[r.factura_id] = {
        factura_id: r.factura_id,
        fecha: formatearFecha_(r.fecha),
        sede: r.sede,
        proveedor: r.proveedor || '',
        numero_factura: r.numero_factura || '',
        usuario: r.usuario,
        timestamp: r.timestamp,
        total: 0,
        lineas: []
      };
    }
    const costo = Number(r.costo) || 0;
    facturas[r.factura_id].total += costo;
    facturas[r.factura_id].lineas.push({ producto: r.producto, unidad: r.unidad, cantidad: Number(r.cantidad) || 0, costo: costo });
  });

  return Object.keys(facturas).map(function (id) { return facturas[id]; })
    .sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
}

/** Cuánto se ha gastado, discriminado por proveedor y por producto, en un rango de fechas/sede. */
function comprasResumenGasto_(fechaDesde, fechaHasta, sede) {
  const facturas = comprasListar_(fechaDesde, fechaHasta, sede);
  const porProveedor = {};
  const porProducto = {};
  let total = 0;

  facturas.forEach(function (f) {
    total += f.total;
    if (!porProveedor[f.proveedor]) porProveedor[f.proveedor] = 0;
    porProveedor[f.proveedor] += f.total;
    f.lineas.forEach(function (l) {
      if (!porProducto[l.producto]) porProducto[l.producto] = { cantidad: 0, costo: 0, unidad: l.unidad };
      porProducto[l.producto].cantidad += l.cantidad;
      porProducto[l.producto].costo += l.costo;
    });
  });

  return {
    total: Number(total.toFixed(2)),
    facturas: facturas.length,
    por_proveedor: Object.keys(porProveedor).map(function (p) { return { proveedor: p, total: Number(porProveedor[p].toFixed(2)) }; })
      .sort(function (a, b) { return b.total - a.total; }),
    por_producto: Object.keys(porProducto).map(function (p) { return { producto: p, cantidad: Number(porProducto[p].cantidad.toFixed(3)), unidad: porProducto[p].unidad, costo: Number(porProducto[p].costo.toFixed(2)) }; })
      .sort(function (a, b) { return b.costo - a.costo; })
  };
}
