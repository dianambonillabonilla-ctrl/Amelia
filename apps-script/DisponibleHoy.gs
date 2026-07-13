/**
 * DISPONIBLE HOY
 * Responde la pregunta central: "con lo que tengo contado ahora mismo, ¿para cuántos platos me alcanza?"
 *
 * Usa:
 *  - Conteos_Manuales (el último conteo físico registrado de cada ingrediente, sumando todas las sedes)
 *  - Recetas (la matriz Producto -> Ingrediente -> Cantidad, cargada desde tu hoja "Estandarización
 *    Productos" — NO desde la receta de FUDO, porque ya confirmamos que la tuya es la fuente correcta)
 *
 * La explosión de receta es recursiva porque hay productos que se arman de sub-productos
 * (ej. Combo Libra -> Cebollita de Amelia -> Cebollita de Amelia Preparada).
 */

function calcularDisponibleHoy_(fecha) {
  const recetas = leerTabla_(SHEET_NAMES.RECETAS);
  const stockActual = obtenerUltimoStockPorIngrediente_(fecha);

  // Mapa producto -> [{ingrediente, cantidad, unidad}], para explosión recursiva
  const recetaMap = {};
  recetas.forEach(function (r) {
    if (!recetaMap[r.producto]) recetaMap[r.producto] = [];
    recetaMap[r.producto].push({ ingrediente: r.ingrediente, cantidad: Number(r.cantidad), unidad: r.unidad });
  });

  const productosVendibles = Object.keys(recetaMap);
  const resultado = productosVendibles.map(function (producto) {
    const consumoPorUnidad = explotarReceta_(producto, 1, recetaMap, {});
    // Para cada ingrediente que requiere, cuántas unidades de "producto" alcanzan con el stock actual
    let maxPreparaciones = Infinity;
    let ingredienteLimitante = null;
    Object.keys(consumoPorUnidad).forEach(function (ingrediente) {
      const necesarioPorUnidad = consumoPorUnidad[ingrediente];
      const disponible = (stockActual[ingrediente] && stockActual[ingrediente].cantidad) || 0;
      const posibles = necesarioPorUnidad > 0 ? Math.floor(disponible / necesarioPorUnidad) : Infinity;
      if (posibles < maxPreparaciones) {
        maxPreparaciones = posibles;
        ingredienteLimitante = ingrediente;
      }
    });
    return {
      producto: producto,
      preparaciones_posibles: isFinite(maxPreparaciones) ? maxPreparaciones : null,
      ingrediente_limitante: ingredienteLimitante,
      stock_limitante: ingredienteLimitante ? stockActual[ingredienteLimitante] : null,
      detalle_receta: consumoPorUnidad
    };
  });

  resultado.sort(function (a, b) {
    if (a.preparaciones_posibles === null) return 1;
    if (b.preparaciones_posibles === null) return -1;
    return a.preparaciones_posibles - b.preparaciones_posibles;
  });

  return {
    fecha: fecha || 'último conteo disponible',
    stock_ingredientes: stockActual,
    platos: resultado
  };
}

/**
 * Explota recursivamente un producto en gramos/unidades de ingredientes base.
 * cantidadBase = cuántas unidades del producto se están pidiendo (usar 1 para "por unidad vendida").
 * acumulado = objeto que se va llenando { ingrediente: cantidad_total }
 */
function explotarReceta_(producto, cantidadBase, recetaMap, acumulado, profundidad) {
  profundidad = profundidad || 0;
  if (profundidad > 6) return acumulado; // corta ciclos accidentales en la matriz de recetas
  const lineas = recetaMap[producto];
  if (!lineas) return acumulado;

  lineas.forEach(function (linea) {
    const cantidadTotal = cantidadBase * linea.cantidad;
    if (recetaMap[linea.ingrediente]) {
      // El "ingrediente" es en realidad un sub-producto con su propia receta (ej. Papas Listas)
      explotarReceta_(linea.ingrediente, cantidadTotal, recetaMap, acumulado, profundidad + 1);
    } else {
      acumulado[linea.ingrediente] = (acumulado[linea.ingrediente] || 0) + cantidadTotal;
    }
  });
  return acumulado;
}

/**
 * Devuelve, para cada producto contado manualmente, la cantidad más reciente registrada
 * hasta la fecha indicada (o la más reciente en general si no se indica fecha), sumando las sedes.
 */
function obtenerUltimoStockPorIngrediente_(fecha) {
  const conteos = leerTabla_(SHEET_NAMES.CONTEOS);
  const porProducto = {};

  conteos.forEach(function (c) {
    const f = formatearFecha_(c.fecha);
    if (fecha && f > fecha) return; // no mirar conteos posteriores a la fecha de corte
    if (!porProducto[c.producto]) porProducto[c.producto] = {};
    if (!porProducto[c.producto][f]) porProducto[c.producto][f] = { cantidad: 0, unidad: c.unidad };
    porProducto[c.producto][f].cantidad += Number(c.cantidad) || 0;
  });

  const resultado = {};
  Object.keys(porProducto).forEach(function (producto) {
    const fechas = Object.keys(porProducto[producto]).sort();
    const ultimaFecha = fechas[fechas.length - 1];
    resultado[producto] = {
      cantidad: porProducto[producto][ultimaFecha].cantidad,
      unidad: porProducto[producto][ultimaFecha].unidad,
      fecha_conteo: ultimaFecha
    };
  });
  return resultado;
}
