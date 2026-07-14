/**
 * CONCILIACIÓN
 * Reproduce, para cualquier fecha, el mismo análisis que hicimos manualmente día por día:
 *  - Bebidas: se comparan contra Movimientos_FUDO (ahí sí cuadra, es 1 unidad = 1 unidad).
 *  - Comida: NO se compara contra el stock de FUDO (sabemos que no cuadra). Se compara
 *    "cambio de peso físico (ayer -> hoy)" contra "ventas del día x tu receta (Recetas)",
 *    separado por sede, porque ya vimos que los problemas suelen ser específicos de una sede.
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

    const sa = conteos.find(function (c) { return c.producto === item.nombre_estandar && c.sede === 'San Antonio'; });
    const capri = conteos.find(function (c) { return c.producto === item.nombre_estandar && c.sede === 'Capri'; });
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
  const ventas = leerTabla_(SHEET_NAMES.VENTAS_FUDO)
    .filter(function (v) { return formatearFecha_(v.creacion) === fecha && v.cancelada !== 'Sí' && v.cancelada !== true; });

  const recetas = leerTabla_(SHEET_NAMES.RECETAS);
  const recetaMap = {};
  recetas.forEach(function (r) {
    if (!recetaMap[r.producto]) recetaMap[r.producto] = [];
    recetaMap[r.producto].push({ ingrediente: r.ingrediente, cantidad: Number(r.cantidad) });
  });

  const sedes = ['San Antonio', 'Capri'];
  const resultado = {};

  sedes.forEach(function (sede) {
    const ventasSede = ventas.filter(function (v) { return v.sede === sede; });
    const consumoEsperado = {};
    ventasSede.forEach(function (v) {
      explotarReceta_(v.producto, Number(v.cantidad) || 0, recetaMap, consumoEsperado);
    });

    const cambioFisico = calcularCambioFisico_(fecha, sede);
    const producido = produccionTotalPorItem_(fecha, sede);

    const ingredientes = new Set(Object.keys(consumoEsperado).concat(Object.keys(cambioFisico)).concat(Object.keys(producido)));
    resultado[sede] = Array.from(ingredientes).map(function (ing) {
      const esperado = (consumoEsperado[ing] || 0) / 1000; // gramos -> kg
      const cambio = cambioFisico[ing] !== undefined ? cambioFisico[ing] : null;
      const producidoIng = producido[ing] || 0;
      // implícito = lo que no explican ni las ventas (consumo esperado) ni la producción registrada.
      // Si nunca se registró producción para este ítem, producidoIng=0 y el cálculo queda igual que antes.
      const implicito = cambio !== null ? (cambio + esperado - producidoIng) : null;
      return {
        ingrediente: ing,
        consumo_esperado_kg: Number(esperado.toFixed(3)),
        cambio_fisico_kg: cambio !== null ? Number(cambio.toFixed(3)) : null,
        producido_registrado_kg: producido[ing] !== undefined ? Number(producidoIng.toFixed(3)) : null,
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
function calcularCambioFisico_(fecha, sede) {
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
    if (f === fecha) hoy[c.producto] = (hoy[c.producto] || 0) + cantidadKg;
    if (f === fechaAnterior) ayer[c.producto] = (ayer[c.producto] || 0) + cantidadKg;
  });

  const cambio = {};
  Object.keys(hoy).forEach(function (p) {
    cambio[p] = hoy[p] - (ayer[p] || 0);
  });
  return cambio;
}
