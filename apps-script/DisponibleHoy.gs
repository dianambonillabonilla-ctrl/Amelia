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
 *
 * Todas las comparaciones de nombre (Recetas.producto/ingrediente vs Conteos.producto) pasan por
 * claveProducto_/nombreCanonico_ (Catalogo.gs), que resuelve contra el catálogo maestro y
 * normaliza tildes/mayúsculas — así "Costilla Preparada" y "costilla preparada" son el mismo
 * ingrediente para el sistema aunque se hayan escrito distinto en cada hoja.
 */

function calcularDisponibleHoy_(fecha) {
  const indice = indiceCatalogo_();
  const recetas = leerTabla_(SHEET_NAMES.RECETAS);
  const stockActual = obtenerUltimoStockPorIngrediente_(fecha, indice);
  const recetaMap = construirRecetaMap_(recetas, indice);

  const productosVendibles = Object.keys(recetaMap);
  const resultado = productosVendibles.map(function (claveProducto) {
    const consumoPorUnidad = explotarReceta_(claveProducto, 1, recetaMap, {}, indice);
    let maxPreparaciones = Infinity;
    let claveLimitante = null;
    Object.keys(consumoPorUnidad).forEach(function (claveIngrediente) {
      const necesarioPorUnidad = consumoPorUnidad[claveIngrediente].cantidad;
      const disponible = (stockActual[claveIngrediente] && stockActual[claveIngrediente].cantidad) || 0;
      const posibles = necesarioPorUnidad > 0 ? Math.floor(disponible / necesarioPorUnidad) : Infinity;
      if (posibles < maxPreparaciones) {
        maxPreparaciones = posibles;
        claveLimitante = claveIngrediente;
      }
    });
    return {
      producto: recetaMap[claveProducto].nombre,
      preparaciones_posibles: isFinite(maxPreparaciones) ? maxPreparaciones : null,
      ingrediente_limitante: claveLimitante ? consumoPorUnidad[claveLimitante].nombre : null,
      stock_limitante: claveLimitante ? stockActual[claveLimitante] : null,
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
 * Arma el mapa "clave de producto" -> {nombre, lineas:[{ingrediente,cantidad,unidad}]} a partir
 * de la hoja Recetas. Se usa tanto aquí como en Conciliacion.gs, para no duplicar esta lógica en
 * dos archivos con reglas de comparación distintas (que fue justo la causa de este bug).
 */
function construirRecetaMap_(recetas, indice) {
  const recetaMap = {};
  recetas.forEach(function (r) {
    const clave = claveProducto_(r.producto, indice);
    if (!recetaMap[clave]) recetaMap[clave] = { nombre: nombreCanonico_(r.producto, indice), lineas: [] };
    recetaMap[clave].lineas.push({ ingrediente: r.ingrediente, cantidad: Number(r.cantidad), unidad: r.unidad });
  });
  return recetaMap;
}

/**
 * Explota recursivamente un producto en gramos/unidades de ingredientes base.
 * cantidadBase = cuántas unidades del producto se están pidiendo (usar 1 para "por unidad vendida").
 * acumulado = objeto que se va llenando { claveIngrediente: {nombre, cantidad_total} }
 */
function explotarReceta_(claveProducto, cantidadBase, recetaMap, acumulado, indice, profundidad) {
  profundidad = profundidad || 0;
  if (profundidad > 6) return acumulado;
  const entrada = recetaMap[claveProducto];
  if (!entrada) return acumulado;

  entrada.lineas.forEach(function (linea) {
    const cantidadTotal = cantidadBase * linea.cantidad;
    const claveIngrediente = claveProducto_(linea.ingrediente, indice);
    if (recetaMap[claveIngrediente]) {
      explotarReceta_(claveIngrediente, cantidadTotal, recetaMap, acumulado, indice, profundidad + 1);
    } else {
      if (!acumulado[claveIngrediente]) acumulado[claveIngrediente] = { nombre: nombreCanonico_(linea.ingrediente, indice), cantidad: 0 };
      acumulado[claveIngrediente].cantidad += cantidadTotal;
    }
  });
  return acumulado;
}

/**
 * Devuelve, para cada producto contado manualmente, la cantidad más reciente registrada
 * hasta la fecha indicada (o la más reciente en general si no se indica fecha), sumando las sedes.
 * Agrupa por claveProducto_, así que dos conteos del mismo producto escritos con distinta
 * ortografía se suman como uno solo en vez de aparecer como dos ingredientes distintos.
 */
function obtenerUltimoStockPorIngrediente_(fecha, indice) {
  indice = indice || indiceCatalogo_();
  const conteos = leerTabla_(SHEET_NAMES.CONTEOS);
  const porProducto = {};

  conteos.forEach(function (c) {
    const f = formatearFecha_(c.fecha);
    if (fecha && f > fecha) return;
    const clave = claveProducto_(c.producto, indice);
    if (!porProducto[clave]) porProducto[clave] = { nombre: nombreCanonico_(c.producto, indice), fechas: {} };
    if (!porProducto[clave].fechas[f]) porProducto[clave].fechas[f] = { cantidad: 0, unidad: c.unidad };
    porProducto[clave].fechas[f].cantidad += Number(c.cantidad) || 0;
  });

  const resultado = {};
  Object.keys(porProducto).forEach(function (clave) {
    const entrada = porProducto[clave];
    const fechas = Object.keys(entrada.fechas).sort();
    const ultimaFecha = fechas[fechas.length - 1];
    resultado[clave] = {
      producto: entrada.nombre,
      cantidad: entrada.fechas[ultimaFecha].cantidad,
      unidad: entrada.fechas[ultimaFecha].unidad,
      fecha_conteo: ultimaFecha
    };
  });
  return resultado;
}
