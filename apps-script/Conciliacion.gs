/**
 * CONCILIACIÓN
 * Reproduce, para cualquier fecha, el mismo análisis que hicimos manualmente día por día:
 *  - Bebidas: se comparan contra Movimientos_FUDO (ahí sí cuadra, es 1 unidad = 1 unidad).
 *  - Comida: NO se compara contra el stock de FUDO (sabemos que no cuadra). Se compara
 *    "cambio de peso físico (ayer -> hoy)" contra "ventas del día x tu receta (Recetas)",
 *    separado por sede, porque ya vimos que los problemas suelen ser específicos de una sede.
 *
 * Todas las comparaciones de nombre pasan por claveProducto_/nombreCanonico_ (Catalogo.gs),
 * igual que en DisponibleHoy.gs — así un mismo ingrediente escrito distinto en Conteos, Recetas,
 * Producciones o Ventas_FUDO se trata como un solo producto en toda la conciliación.
 */

function calcularConciliacion_(fecha) {
  return {
    fecha: fecha,
    ventas: resumirVentasFudo_(fecha),
    bebidas: conciliarBebidas_(fecha),
    comida: conciliarComidaPorSede_(fecha)
  };
}

function resumirVentasFudo_(fecha) {
  const grupos = {};
  leerTabla_(SHEET_NAMES.VENTAS_FUDO).filter(function (v) {
    return formatearFecha_(v.creacion) === fecha && v.cancelada !== 'Sí' && v.cancelada !== true;
  }).forEach(function (v) {
    const clave = [v.sede || 'Sin identificar', v.categoria || 'Sin categoría', v.producto].join('|');
    if (!grupos[clave]) grupos[clave] = { sede: v.sede || 'Sin identificar', categoria: v.categoria || 'Sin categoría', producto: v.producto, cantidad: 0 };
    grupos[clave].cantidad += Number(v.cantidad) || 0;
  });
  return Object.keys(grupos).map(function (k) { return grupos[k]; }).sort(function (a, b) {
    return String(a.sede).localeCompare(String(b.sede)) || String(a.categoria).localeCompare(String(b.categoria)) || String(a.producto).localeCompare(String(b.producto));
  });
}

// --- BEBIDAS: contra FUDO ----------------------------------------------------
function conciliarBebidas_(fecha) {
  const indice = indiceCatalogo_();
  const movimientos = leerTabla_(SHEET_NAMES.MOVIMIENTOS_FUDO)
    .filter(function (m) { return formatearFecha_(m.fecha) === fecha; });

  const catalogo = leerTabla_(SHEET_NAMES.CATALOGO).filter(function (c) { return c.categoria && c.categoria.indexOf('Bebidas') === 0; });
  const conteos = conteoListar_(fecha, null);

  return catalogo.map(function (item) {
    const movsItem = movimientos.filter(function (m) { return m.nombre === item.nombre_fudo; });
    movsItem.sort(function (a, b) { return new Date(a.fecha) - new Date(b.fecha); });
    const cierre = movsItem.length ? movsItem[movsItem.length - 1].stock_actual : null;

    const eventosVenta = ['Adición Creada', 'Adición Cancelada'];
    const consumoVenta = movsItem
      .filter(function (m) { return eventosVenta.indexOf(m.evento) !== -1; })
      .reduce(function (acc, m) { return acc - Number(m.diferencia || 0); }, 0);
    function consumoSede_(sede) {
      return movsItem.filter(function (m) { return m.sede === sede && eventosVenta.indexOf(m.evento) !== -1; })
        .reduce(function (acc, m) { return acc - Number(m.diferencia || 0); }, 0);
    }

    const claveItem = claveProducto_(item.nombre_estandar, indice);
    const sa = conteos.find(function (c) { return claveProducto_(c.producto, indice) === claveItem && c.sede === 'San Antonio'; });
    const capri = conteos.find(function (c) { return claveProducto_(c.producto, indice) === claveItem && c.sede === 'Capri'; });
    const suma = (sa ? Number(sa.cantidad) : 0) + (capri ? Number(capri.cantidad) : 0);

    return {
      producto: item.nombre_estandar,
      sa: sa ? Number(sa.cantidad) : null,
      capri: capri ? Number(capri.cantidad) : null,
      suma_manual: suma,
      fudo_cierre: cierre,
      diferencia_vs_suma: (cierre !== null) ? (cierre - suma) : null,
      consumo_fudo_total: consumoVenta,
      consumo_fudo_sa: consumoSede_('San Antonio'),
      consumo_fudo_capri: consumoSede_('Capri'),
      n_movimientos_fudo: movsItem.length
    };
  });
}

// --- COMIDA: por sede, ventas x receta vs. cambio físico --------------------
function conciliarComidaPorSede_(fecha) {
  const indice = indiceCatalogo_();
  const ventas = leerTabla_(SHEET_NAMES.VENTAS_FUDO)
    .filter(function (v) { return formatearFecha_(v.creacion) === fecha && v.cancelada !== 'Sí' && v.cancelada !== true; });

  const sedes = ['Centro de Producción', 'San Antonio', 'Capri'];
  const resultado = {};

  sedes.forEach(function (sede) {
    const recetaMap = construirRecetaMap_(recetasVigentes_(fecha, sede), indice);
    const ventasSede = ventas.filter(function (v) { return v.sede === sede; });
    const consumoEsperado = {};
    ventasSede.forEach(function (v) {
      const claveProd = claveRecetaVenta_(v.producto, recetaMap, indice);
      explotarReceta_(claveProd, Number(v.cantidad) || 0, recetaMap, consumoEsperado, indice);
    });

    const cambioFisico = calcularCambioFisico_(fecha, sede, indice);
    const producido = produccionTotalPorItem_(fecha, sede, indice);
    const consumoProduccion = consumoEsperadoPorProduccion_(fecha, sede, indice);
    const traslados = trasladosNetosPorItem_(fecha, sede, indice);
    const ajustes = ajustesNetosPorItem_(fecha, sede, indice);
    const compras = comprasNetasPorItem_(fecha, sede, indice);

    const ingredientes = new Set(Object.keys(consumoEsperado).concat(Object.keys(cambioFisico)).concat(Object.keys(producido)).concat(Object.keys(consumoProduccion)).concat(Object.keys(traslados)).concat(Object.keys(ajustes)).concat(Object.keys(compras)));
    resultado[sede] = Array.from(ingredientes).map(function (claveIng) {
      const nombreIng = (consumoEsperado[claveIng] && consumoEsperado[claveIng].nombre) ||
        (cambioFisico[claveIng] && cambioFisico[claveIng].nombre) || claveIng;
      const esperado = consumoEsperado[claveIng] ? consumoEsperado[claveIng].cantidad : 0;
      const cambio = cambioFisico[claveIng] !== undefined ? cambioFisico[claveIng].cantidad : null;
      const producidoIng = producido[claveIng] ? producido[claveIng].cantidad : 0;
      const consumoProd = consumoProduccion[claveIng] ? consumoProduccion[claveIng].cantidad : 0;
      const trasladoNeto = traslados[claveIng] ? traslados[claveIng].cantidad : 0;
      const compraFactura = compras[claveIng] ? compras[claveIng].cantidad : 0;
      const ajusteNeto = (ajustes[claveIng] ? ajustes[claveIng].cantidad : 0) + compraFactura;
      const unidad = (consumoEsperado[claveIng] && consumoEsperado[claveIng].unidad) ||
        (cambioFisico[claveIng] && cambioFisico[claveIng].unidad) ||
        (producido[claveIng] && producido[claveIng].unidad) ||
        (consumoProduccion[claveIng] && consumoProduccion[claveIng].unidad) ||
        (traslados[claveIng] && traslados[claveIng].unidad) ||
        (ajustes[claveIng] && ajustes[claveIng].unidad) ||
        (compras[claveIng] && compras[claveIng].unidad) || '';
      // Fórmula de flujo:
      // cambio físico = compras/ajustes netos + traslados netos + producción salida
      //                 - ventas esperadas - consumo de producción - mermas/desperdicio.
      // implicito es la diferencia que todavía no explica ningún registro operativo.
      const implicito = cambio !== null ? (cambio - ajusteNeto - trasladoNeto - producidoIng + esperado + consumoProd) : null;
      return {
        ingrediente: nombreIng,
        unidad: unidad,
        consumo_esperado: Number(esperado.toFixed(3)),
        cambio_fisico: cambio !== null ? Number(cambio.toFixed(3)) : null,
        producido_registrado: producido[claveIng] !== undefined ? Number(producidoIng.toFixed(3)) : null,
        consumo_produccion: consumoProduccion[claveIng] !== undefined ? Number(consumoProd.toFixed(3)) : null,
        ajuste_neto: (ajustes[claveIng] !== undefined || compras[claveIng] !== undefined) ? Number(ajusteNeto.toFixed(3)) : null,
        compras: (ajustes[claveIng] !== undefined || compras[claveIng] !== undefined) ? Number(((ajustes[claveIng] ? ajustes[claveIng].compras : 0) + compraFactura).toFixed(3)) : null,
        costo_compras: compras[claveIng] !== undefined ? Number(compras[claveIng].costo.toFixed(2)) : null,
        mermas: ajustes[claveIng] !== undefined ? Number(ajustes[claveIng].mermas.toFixed(3)) : null,
        traslado_neto: traslados[claveIng] !== undefined ? Number(trasladoNeto.toFixed(3)) : null,
        implicito: implicito !== null ? Number(implicito.toFixed(3)) : null
      };
    });
  });

  return resultado;
}

/**
 * cambio físico = conteo de HOY - conteo del día anterior disponible, en unidad base (g/ml/u).
 * Requiere que Conteos_Manuales tenga al menos dos fechas consecutivas cargadas.
 */
function calcularCambioFisico_(fecha, sede, indice) {
  indice = indice || indiceCatalogo_();
  const conteos = leerTabla_(SHEET_NAMES.CONTEOS).filter(function (c) { return c.sede === sede; });
  const fechasDisponibles = Array.from(new Set(conteos.map(function (c) { return formatearFecha_(c.fecha); }))).sort();
  const idx = fechasDisponibles.indexOf(fecha);
  if (idx <= 0) return {}; // no hay fecha anterior con la que comparar

  const fechaAnterior = fechasDisponibles[idx - 1];
  const hoy = {};
  const ayer = {};
  conteos.forEach(function (c) {
    const f = formatearFecha_(c.fecha);
    const base = aUnidadBase_(c.cantidad, c.unidad);
    const clave = claveProducto_(c.producto, indice);
    if (f === fecha) {
      hoy[clave] = { nombre: nombreCanonico_(c.producto, indice), unidad: base.unidad,
        cantidad: (hoy[clave] ? hoy[clave].cantidad : 0) + base.cantidad };
    }
    if (f === fechaAnterior) {
      if (!ayer[clave]) ayer[clave] = { cantidad: 0, unidad: base.unidad };
      ayer[clave].cantidad += base.cantidad;
    }
  });

  const cambio = {};
  const claves = new Set(Object.keys(hoy).concat(Object.keys(ayer)));
  Array.from(claves).forEach(function (clave) {
    const h = hoy[clave] || { nombre: clave, cantidad: 0, unidad: ayer[clave].unidad };
    cambio[clave] = { nombre: h.nombre, unidad: h.unidad, cantidad: h.cantidad - (ayer[clave] ? ayer[clave].cantidad : 0) };
  });
  return cambio;
}

function trasladosNetosPorItem_(fecha, sede, indice) {
  const totales = {};
  leerTabla_(SHEET_NAMES.TRASLADOS).filter(function (t) {
    return formatearFecha_(t.fecha) === fecha && ['Confirmado', 'Resuelto'].indexOf(t.estado) !== -1;
  }).forEach(function (t) {
    // Un traslado resuelto con faltante conserva la cantidad realmente recibida. No usar
    // `||` aquí: cero es un valor válido cuando no llegó nada.
    const cantidad = t.cantidad_recibida !== '' && t.cantidad_recibida !== null && t.cantidad_recibida !== undefined
      ? t.cantidad_recibida : t.cantidad_enviada;
    const base = aUnidadBase_(cantidad, t.unidad);
    const clave = claveProducto_(t.producto, indice);
    const signo = t.sede_destino === sede ? 1 : (t.sede_origen === sede ? -1 : 0);
    if (!signo) return;
    if (!totales[clave]) totales[clave] = { cantidad: 0, unidad: base.unidad };
    totales[clave].cantidad += signo * base.cantidad;
  });
  return totales;
}

function consumoEsperadoPorProduccion_(fecha, sede, indice) {
  indice = indice || indiceCatalogo_();
  const recetaMap = construirRecetaMap_(recetasVigentes_(fecha, sede), indice);
  const consumo = {};
  produccionListar_(fecha, sede).forEach(function (p) {
    const claveProd = claveProducto_(p.item, indice);
    const base = aUnidadBase_(p.cantidad, p.unidad);
    explotarReceta_(claveProd, base.cantidad, recetaMap, consumo, indice);
  });
  return consumo;
}
