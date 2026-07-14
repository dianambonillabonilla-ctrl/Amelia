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
    bebidas: conciliarBebidas_(fecha),
    comida: conciliarComidaPorSede_(fecha)
  };
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
      n_movimientos_fudo: movsItem.length
    };
  });
}

// --- COMIDA: por sede, ventas x receta vs. cambio físico --------------------
function conciliarComidaPorSede_(fecha) {
  const indice = indiceCatalogo_();
  const ventas = leerTabla_(SHEET_NAMES.VENTAS_FUDO)
    .filter(function (v) { return formatearFecha_(v.creacion) === fecha && v.cancelada !== 'Sí' && v.cancelada !== true; });

  const recetaMap = construirRecetaMap_(leerTabla_(SHEET_NAMES.RECETAS), indice);

  const sedes = ['San Antonio', 'Capri'];
  const resultado = {};

  sedes.forEach(function (sede) {
    const ventasSede = ventas.filter(function (v) { return v.sede === sede; });
    const consumoEsperado = {};
    ventasSede.forEach(function (v) {
      const claveProd = claveProducto_(v.producto, indice);
      explotarReceta_(claveProd, Number(v.cantidad) || 0, recetaMap, consumoEsperado, indice);
    });

    const cambioFisico = calcularCambioFisico_(fecha, sede, indice);
    const producido = produccionTotalPorItem_(fecha, sede, indice);

    const ingredientes = new Set(Object.keys(consumoEsperado).concat(Object.keys(cambioFisico)).concat(Object.keys(producido)));
    resultado[sede] = Array.from(ingredientes).map(function (claveIng) {
      const nombreIng = (consumoEsperado[claveIng] && consumoEsperado[claveIng].nombre) ||
        (cambioFisico[claveIng] && cambioFisico[claveIng].nombre) || claveIng;
      const esperado = (consumoEsperado[claveIng] ? consumoEsperado[claveIng].cantidad : 0) / 1000; // gramos -> kg
      const cambio = cambioFisico[claveIng] !== undefined ? cambioFisico[claveIng].cantidad : null;
      const producidoIng = producido[claveIng] || 0;
      // implícito = lo que no explican ni las ventas (consumo esperado) ni la producción registrada.
      // Si nunca se registró producción para este ítem, producidoIng=0 y el cálculo queda igual que antes.
      const implicito = cambio !== null ? (cambio + esperado - producidoIng) : null;
      return {
        ingrediente: nombreIng,
        consumo_esperado_kg: Number(esperado.toFixed(3)),
        cambio_fisico_kg: cambio !== null ? Number(cambio.toFixed(3)) : null,
        producido_registrado_kg: producido[claveIng] !== undefined ? Number(producidoIng.toFixed(3)) : null,
        implicito_kg: implicito !== null ? Number(implicito.toFixed(3)) : null
      };
    });
  });

  return resultado;
}

/**
 * cambio físico = conteo de HOY - conteo del día hábil anterior, para una sede, en kg.
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
    const unidadEsGramos = String(c.unidad).toLowerCase() === 'g';
    const cantidadKg = unidadEsGramos ? Number(c.cantidad) / 1000 : Number(c.cantidad);
    const clave = claveProducto_(c.producto, indice);
    if (f === fecha) {
      hoy[clave] = { nombre: nombreCanonico_(c.producto, indice), cantidad: (hoy[clave] ? hoy[clave].cantidad : 0) + cantidadKg };
    }
    if (f === fechaAnterior) ayer[clave] = (ayer[clave] || 0) + cantidadKg;
  });

  const cambio = {};
  Object.keys(hoy).forEach(function (clave) {
    cambio[clave] = { nombre: hoy[clave].nombre, cantidad: hoy[clave].cantidad - (ayer[clave] || 0) };
  });
  return cambio;
}
