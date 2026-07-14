/**
 * DISPONIBLE HOY
 * Responde la pregunta central: "con lo que tengo contado ahora mismo, ¿para cuántos platos me alcanza?"
 *
 * Usa:
 *  - Conteos_Manuales (el último conteo físico registrado de cada ingrediente, sumando todas las sedes)
 *  - Recetas (la matriz Producto -> Ingrediente -> Cantidad), que ahora tiene DOS capas encadenadas:
 *      1) "plato"     — Chanchostilla <- Costilla Preparada: 115.3846154 g por plato vendido
 *      2) "produccion" — Costilla Preparada <- Costilla Limpia Marinada: 7250 g para producir
 *         rendimiento_producto=5305.288301 g (o sea 1.366... g de materia prima por cada 1g de
 *         producto preparado que rinde el lote)
 *
 * La disponibilidad de CUALQUIER producto/ingrediente ya no es solo "lo que hay contado en
 * Conteos_Manuales": es contado + lo que se puede seguir produciendo con la materia prima
 * disponible, calculado recursivamente hasta llegar a insumos comprados sin receta propia.
 * Ejemplo real: si hay Costilla Preparada contada para 5 platos y además materia prima
 * (Costilla San Luis Entera, sal, especias...) para preparar 10 platos más, la disponibilidad
 * de Costilla Preparada es 15 platos — y esa cifra es la que compite con Panceta Pre-ahumada y
 * Papas Listas para determinar cuántas Chanchostillas salen hoy.
 *
 * Todas las comparaciones de nombre (Recetas.producto/ingrediente vs Conteos.producto) pasan por
 * claveProducto_/nombreCanonico_ (Catalogo.gs), que resuelve contra el catálogo maestro y
 * normaliza tildes/mayúsculas — así "Costilla Preparada" y "costilla preparada" son el mismo
 * ingrediente para el sistema aunque se hayan escrito distinto en cada hoja.
 */

function calcularDisponibleHoy_(fecha) {
  const indice = indiceCatalogo_();
  const recetas = leerTabla_(SHEET_NAMES.RECETAS);
  const stockContado = obtenerUltimoStockPorIngrediente_(fecha, indice);
  const recetaMap = construirRecetaMap_(recetas, indice);
  const memo = {};

  // Solo los productos "plato" (vendibles) se muestran como fila en Disponible Hoy — los de tipo
  // "produccion" (Costilla Preparada, Aioli, Papas pre-fritas...) son pasos internos de la cadena,
  // no algo que se venda directamente. Su disponibilidad igual se calcula y queda disponible en
  // detalle_receta si hace falta revisarla.
  const productosVendibles = Object.keys(recetaMap).filter(function (clave) {
    return recetaMap[clave].tipo !== 'produccion';
  });

  const resultado = productosVendibles.map(function (claveProducto) {
    const det = cantidadDisponibleDetallada_(claveProducto, recetaMap, stockContado, indice, memo, {});
    const limitante = det.limitante;
    return {
      producto: recetaMap[claveProducto].nombre,
      preparaciones_posibles: isFinite(det.disponible) ? Math.floor(det.disponible) : null,
      ingrediente_limitante: limitante ? limitante.nombre : null,
      cadena_limitante: limitante ? cadenaLimitante_(limitante) : null,
      stock_limitante: limitante ? {
        cantidad: Number(limitante.disponible.toFixed(3)),
        unidad: limitante.unidad || '',
        contado: Number(limitante.contado.toFixed(3)),
        producible: Number(limitante.producible.toFixed(3))
      } : null,
      detalle_receta: aplanarConsumo_(claveProducto, recetaMap, indice)
    };
  });

  resultado.sort(function (a, b) {
    if (a.preparaciones_posibles === null) return 1;
    if (b.preparaciones_posibles === null) return -1;
    return a.preparaciones_posibles - b.preparaciones_posibles;
  });

  return {
    fecha: fecha || 'último conteo disponible',
    stock_ingredientes: stockContado,
    platos: resultado
  };
}

/**
 * Arma el mapa "clave de producto" -> {nombre, tipo, lineas:[{ingrediente,cantidad,unidad,
 * rendimiento}]} a partir de la hoja Recetas. Se usa tanto aquí como en Conciliacion.gs, para no
 * duplicar esta lógica en dos archivos con reglas de comparación distintas (que fue justo la
 * causa de este bug la primera vez).
 *
 * rendimiento_producto default 1 (así las filas viejas tipo "plato", que no tienen esa columna
 * llena, se comportan exactamente igual que antes). tipo default 'plato'.
 */
function construirRecetaMap_(recetas, indice) {
  const recetaMap = {};
  recetas.forEach(function (r) {
    const clave = claveProducto_(r.producto, indice);
    if (!recetaMap[clave]) {
      recetaMap[clave] = { nombre: nombreCanonico_(r.producto, indice), tipo: (r.tipo || 'plato').toString().trim() || 'plato', lineas: [] };
    }
    recetaMap[clave].lineas.push({
      ingrediente: r.ingrediente,
      cantidad: Number(r.cantidad),
      unidad: r.unidad,
      rendimiento: Number(r.rendimiento_producto) || 1
    });
  });
  return recetaMap;
}

/**
 * Cuánta cantidad de `clave` hay disponible en total = lo contado en el último conteo físico +
 * lo que todavía se puede producir encadenando su propia receta (si tiene) hasta materias primas
 * sin receta. Memoizado por `clave` para todo el cálculo de calcularDisponibleHoy_ (no depende de
 * qué plato lo esté preguntando) y con guarda de ciclos (`enCurso`) por si algún día una receta
 * queda mal cargada y se referencia a sí misma — en vez de colgar el cálculo, esa rama simplemente
 * no aporta disponibilidad extra.
 */
function cantidadDisponibleDetallada_(clave, recetaMap, stockContado, indice, memo, enCurso) {
  if (memo[clave]) return memo[clave];
  if (enCurso[clave]) return { disponible: 0, contado: 0, producible: 0, limitante: null, nombre: clave, unidad: '' };

  enCurso[clave] = true;
  const contadoEntry = stockContado[clave];
  const contado = contadoEntry ? Number(contadoEntry.cantidad) || 0 : 0;
  const entrada = recetaMap[clave];

  let producible = 0;
  let limitante = null;
  if (entrada && entrada.lineas.length) {
    let minPosible = Infinity;
    entrada.lineas.forEach(function (linea) {
      const ratio = linea.cantidad / linea.rendimiento;
      if (!(ratio > 0)) return;
      const claveIng = claveProducto_(linea.ingrediente, indice);
      const det = cantidadDisponibleDetallada_(claveIng, recetaMap, stockContado, indice, memo, enCurso);
      const posible = det.disponible / ratio;
      if (posible < minPosible) {
        minPosible = posible;
        limitante = {
          nombre: nombreCanonico_(linea.ingrediente, indice),
          unidad: linea.unidad || det.unidad || '',
          disponible: det.disponible,
          contado: det.contado,
          producible: det.producible,
          sub_limitante: det.limitante
        };
      }
    });
    producible = isFinite(minPosible) ? minPosible : 0;
  }

  delete enCurso[clave];
  const resultado = {
    disponible: contado + producible,
    contado: contado,
    producible: producible,
    limitante: limitante,
    nombre: nombreCanonico_(clave, indice),
    unidad: contadoEntry ? contadoEntry.unidad : ''
  };
  memo[clave] = resultado;
  return resultado;
}

/** Convierte la cadena de `sub_limitante` en un texto tipo "Costilla Preparada → Costilla Limpia Marinada → Costilla San Luis Entera". */
function cadenaLimitante_(limitante) {
  const nombres = [];
  let actual = limitante;
  let vueltas = 0;
  while (actual && vueltas < 10) {
    nombres.push(actual.nombre);
    actual = actual.sub_limitante;
    vueltas++;
  }
  return nombres.join(' → ');
}

/**
 * Explota recursivamente un producto en gramos/unidades de ingredientes base, SIN mirar stock —
 * solo "cuánto necesito de cada cosa para 1 unidad". Se usa para mostrar el detalle de receta en
 * la UI. A diferencia de cantidadDisponibleDetallada_, sí atraviesa capas "produccion" para
 * mostrar el desglose completo hasta materia prima.
 */
function aplanarConsumo_(claveProducto, recetaMap, indice, cantidadBase, acumulado, profundidad) {
  cantidadBase = cantidadBase || 1;
  acumulado = acumulado || {};
  profundidad = profundidad || 0;
  if (profundidad > 10) return acumulado;
  const entrada = recetaMap[claveProducto];
  if (!entrada) return acumulado;

  entrada.lineas.forEach(function (linea) {
    const ratio = linea.cantidad / linea.rendimiento;
    const cantidadTotal = cantidadBase * ratio;
    const claveIngrediente = claveProducto_(linea.ingrediente, indice);
    if (recetaMap[claveIngrediente]) {
      aplanarConsumo_(claveIngrediente, recetaMap, indice, cantidadTotal, acumulado, profundidad + 1);
    } else {
      if (!acumulado[claveIngrediente]) acumulado[claveIngrediente] = { nombre: nombreCanonico_(linea.ingrediente, indice), cantidad: 0 };
      acumulado[claveIngrediente].cantidad += cantidadTotal;
    }
  });
  return acumulado;
}

/**
 * Explota recursivamente un producto en gramos/unidades de ingredientes base — usado por
 * Conciliacion.gs. A propósito NO atraviesa la capa "produccion" (Costilla Preparada, Aioli,
 * Papas pre-fritas...): se detiene ahí igual que antes de agregar esa capa, porque Conciliación
 * compara contra lo que se cuenta físicamente a ese nivel (Conteos_Manuales), no contra materia
 * prima. Si mañana Conciliación necesita bajar hasta materia prima, hay que decidirlo aparte —
 * no es lo mismo que "Disponible Hoy".
 */
function explotarReceta_(claveProducto, cantidadBase, recetaMap, acumulado, indice, profundidad) {
  profundidad = profundidad || 0;
  if (profundidad > 6) return acumulado;
  const entrada = recetaMap[claveProducto];
  if (!entrada) return acumulado;

  entrada.lineas.forEach(function (linea) {
    const cantidadTotal = cantidadBase * linea.cantidad;
    const claveIngrediente = claveProducto_(linea.ingrediente, indice);
    const subEntrada = recetaMap[claveIngrediente];
    if (subEntrada && subEntrada.tipo !== 'produccion') {
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
