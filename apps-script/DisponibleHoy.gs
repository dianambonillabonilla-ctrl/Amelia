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

function calcularDisponibleHoy_(fecha, sede) {
  const indice = indiceCatalogo_();
  const recetas = recetasVigentes_(fecha, sede);
  const stockContado = obtenerUltimoStockPorIngrediente_(fecha, indice, sede);
  const recetaMap = construirRecetaMap_(recetas, indice);
  const memo = {};

  function detalleClave_(clave) {
    const det = cantidadDisponibleDetallada_(clave, recetaMap, stockContado, indice, memo, {});
    const limitante = det.limitante;
    return {
      producto: recetaMap[clave].nombre,
      tipo: recetaMap[clave].tipo,
      // Para un "plato" (se arma sobre la marcha, nunca se cuenta a sí mismo — ver
      // cantidadDisponibleDetallada_) esto es igual a lo producible. Para una subreceta
      // (tipo "produccion") sí puede incluir lo ya preparado y contado (ej. Aioli listo en la
      // nevera) además de lo que todavía se puede preparar con materia prima disponible.
      preparaciones_posibles: isFinite(det.disponible) ? Math.floor(det.disponible) : null,
      contado: Number(det.contado.toFixed(3)),
      // "Ya tengo esto listo" vs. "toca prepararlo": producible es cuánto MÁS se puede preparar
      // desde materia prima, sin contar lo que ya está armado (det.contado). Si producible es 0,
      // no hay con qué preparar más aunque el conteo físico esté momentáneamente en cero.
      producible: isFinite(det.producible) ? Math.floor(det.producible) : null,
      ingrediente_limitante: limitante ? limitante.nombre : null,
      cadena_limitante: limitante ? cadenaLimitante_(limitante) : null,
      stock_limitante: limitante ? {
        cantidad: Number(limitante.disponible.toFixed(3)),
        unidad: limitante.unidad || '',
        contado: Number(limitante.contado.toFixed(3)),
        producible: Number(limitante.producible.toFixed(3))
      } : null,
      detalle_receta: aplanarConsumo_(clave, recetaMap, indice)
    };
  }

  // Solo los productos "plato" (vendibles) se muestran como tarjeta grande en "¿Para cuántos
  // platos alcanza?" — los de tipo "produccion" (Costilla Preparada, Aioli, Papas pre-fritas...)
  // son pasos internos de la cadena, no algo que se venda directamente.
  const productosVendibles = Object.keys(recetaMap).filter(function (clave) {
    return recetaMap[clave].tipo !== 'produccion';
  });
  const resultado = productosVendibles.map(detalleClave_);
  resultado.sort(function (a, b) {
    if (a.preparaciones_posibles === null) return 1;
    if (b.preparaciones_posibles === null) return -1;
    return a.preparaciones_posibles - b.preparaciones_posibles;
  });

  // Disponibilidad de TODO lo que tiene receta propia (platos y subrecetas), indexada por la
  // misma llave normalizada que trae stock_ingredientes — para que "Todo lo que tengo hoy" pueda,
  // al expandir un producto preparado (ej. Alioli), mostrar si falta materia prima para
  // prepararlo o si solo falta prepararlo (materia prima disponible, ver "producible" arriba).
  const disponibilidadPorReceta = {};
  Object.keys(recetaMap).forEach(function (clave) { disponibilidadPorReceta[clave] = detalleClave_(clave); });

  return {
    fecha: fecha || 'último conteo disponible',
    sede: sede || 'Ambas',
    stock_ingredientes: stockContado,
    platos: resultado,
    disponibilidad_receta: disponibilidadPorReceta
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
    const entradaBase = aUnidadBase_(r.cantidad, r.unidad);
    const salidaBase = r.rendimiento_producto !== '' && r.rendimiento_producto !== null && r.rendimiento_producto !== undefined
      ? aUnidadBase_(r.rendimiento_producto, r.unidad_rendimiento || r.unidad)
      : { cantidad: 1, unidad: 'u' };
    recetaMap[clave].lineas.push({
      ingrediente: r.ingrediente,
      cantidad: entradaBase.cantidad,
      unidad: entradaBase.unidad,
      rendimiento: salidaBase.cantidad || 1,
      unidad_rendimiento: salidaBase.unidad,
      controla_disponibilidad: !(r.controla_disponibilidad === false || normalizar_(r.controla_disponibilidad) === 'no' || normalizar_(r.controla_disponibilidad) === 'false'),
      version: r.version || '',
      fuente: r.fuente || ''
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
  const entrada = recetaMap[clave];
  // Un "plato" (Falafel, Cebollita de Amelia...) es un producto vendido, nunca algo que se cuente
  // físicamente por sí mismo — se arma sobre la marcha desde su receta. Si por error existe una
  // fila en Conteos_Manuales con el mismo nombre exacto del plato (ej. alguien contó "Falafel" en
  // vez de "Falafel crudo" o "Falafel Preparado"), esa cantidad se sumaba directo a "disponible"
  // sin pasar por la receta: el número de "preparaciones posibles" quedaba igual al conteo mal
  // etiquetado, sin importar que el insumo real que limita la producción estuviera en 0.
  const contado = (entrada && entrada.tipo === 'plato') ? 0 : (contadoEntry ? Number(contadoEntry.cantidad) || 0 : 0);

  let producible = 0;
  let limitante = null;
  if (entrada && entrada.lineas.length) {
    let minPosible = Infinity;
    entrada.lineas.forEach(function (linea) {
      const ratio = linea.cantidad / linea.rendimiento;
      if (!(ratio > 0)) return;
      if (!linea.controla_disponibilidad) return;
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
      if (!acumulado[claveIngrediente]) acumulado[claveIngrediente] = { nombre: nombreCanonico_(linea.ingrediente, indice), cantidad: 0, unidad: linea.unidad };
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
    const cantidadTotal = cantidadBase * (linea.cantidad / linea.rendimiento);
    const claveIngrediente = claveProducto_(linea.ingrediente, indice);
    const subEntrada = recetaMap[claveIngrediente];
    if (subEntrada && subEntrada.tipo !== 'produccion') {
      explotarReceta_(claveIngrediente, cantidadTotal, recetaMap, acumulado, indice, profundidad + 1);
    } else {
      if (!acumulado[claveIngrediente]) acumulado[claveIngrediente] = {
        nombre: nombreCanonico_(linea.ingrediente, indice), cantidad: 0, unidad: linea.unidad
      };
      acumulado[claveIngrediente].cantidad += cantidadTotal;
    }
  });
  return acumulado;
}

/**
 * Devuelve, para cada producto contado manualmente, la cantidad más reciente registrada
 * hasta la fecha indicada (o la más reciente en general si no se indica fecha), sumando las sedes
 * (o filtrando a una sola si se pasa `sede`).
 * Agrupa por claveProducto_, así que dos conteos del mismo producto escritos con distinta
 * ortografía se suman como uno solo en vez de aparecer como dos ingredientes distintos.
 *
 * A partir del último conteo físico de CADA sede, se suman las compras ('Compra cruda') y
 * ajustes operativos, se suman los traslados recibidos y confirmados (o resueltos) desde otra
 * sede, y se restan las mermas/desperdicio (Ajustes_Inventario, ver AjustesInventario.gs;
 * Traslados, ver Traslados.gs), todo registrado en esa misma sede después de ese conteo y hasta
 * la fecha de corte — así una compra o un traslado recibido en Capri aumenta de inmediato el
 * disponible de Capri sin esperar al próximo conteo físico, y no afecta el número de San Antonio.
 * El conteo físico sigue siendo la referencia real; esto solo cubre el tiempo entre conteos.
 *
 * Los traslados solo suman al llegar (sede_destino) — a propósito NO se restan de la sede de
 * origen al enviarlos: ver la nota de la auditoría sobre por qué "Disponible Hoy" no intenta
 * modelar salidas (producción, ventas) más allá de lo que ya cubre el conteo físico siguiente.
 *
 * IMPORTANTE: un producto que TODAVÍA no se ha contado nunca en una sede, pero ya se compró o se
 * recibió por traslado allí, igual debe aparecer (con "conteo" = 0 de base) — si no, una compra
 * de algo nuevo (ej. la primera vez que se compra banano) quedaría invisible en Disponible Hoy
 * hasta el primer conteo físico de ese producto, que es justo lo contrario de lo que se pidió.
 */
function obtenerUltimoStockPorIngrediente_(fecha, indice, sede) {
  indice = indice || indiceCatalogo_();
  const conteos = leerTabla_(SHEET_NAMES.CONTEOS);
  const ajustes = leerTabla_(SHEET_NAMES.AJUSTES_INVENTARIO);
  const traslados = leerTabla_(SHEET_NAMES.TRASLADOS);
  const porProducto = {};

  function entradaProducto_(clave, nombre) {
    if (!porProducto[clave]) porProducto[clave] = { nombre: nombre, porSede: {} };
    return porProducto[clave];
  }
  function entradaSede_(entrada, sedeItem) {
    if (!entrada.porSede[sedeItem]) entrada.porSede[sedeItem] = { fechas: {} };
    return entrada.porSede[sedeItem];
  }

  conteos.forEach(function (c) {
    const f = formatearFecha_(c.fecha);
    if (fecha && f > fecha) return;
    if (sede && sede !== 'Ambas' && c.sede !== sede) return;
    const clave = claveProducto_(c.producto, indice);
    const sedeConteo = c.sede || 'Sin sede';
    const fechas = entradaSede_(entradaProducto_(clave, nombreCanonico_(c.producto, indice)), sedeConteo).fechas;
    const base = aUnidadBase_(c.cantidad, c.unidad);
    if (!fechas[f]) fechas[f] = { cantidad: 0, unidad: base.unidad };
    if (fechas[f].unidad !== base.unidad) return;
    fechas[f].cantidad += base.cantidad;
  });

  function asegurarSinConteo_(producto, sedeItem) {
    if (sede && sede !== 'Ambas' && sedeItem !== sede) return;
    entradaSede_(entradaProducto_(claveProducto_(producto, indice), nombreCanonico_(producto, indice)), sedeItem);
  }
  ajustes.forEach(function (a) { asegurarSinConteo_(a.producto, a.sede || 'Sin sede'); });
  traslados.forEach(function (t) {
    if (['Confirmado', 'Resuelto'].indexOf(t.estado) !== -1) asegurarSinConteo_(t.producto, t.sede_destino);
  });

  const resultado = {};
  Object.keys(porProducto).forEach(function (clave) {
    const entrada = porProducto[clave];
    let total = 0;
    let unidadFinal = '';
    let fechaMasReciente = '';
    Object.keys(entrada.porSede).forEach(function (sedeItem) {
      const fechasSede = Object.keys(entrada.porSede[sedeItem].fechas).sort();
      const hayConteo = fechasSede.length > 0;
      const ultimaFecha = hayConteo ? fechasSede[fechasSede.length - 1] : '';
      const base = hayConteo ? entrada.porSede[sedeItem].fechas[ultimaFecha] : { cantidad: 0, unidad: '' };
      const resAjustes = netoAjustesDesdeConteo_(ajustes, clave, sedeItem, ultimaFecha, fecha, indice, base.unidad);
      const resTraslados = trasladosRecibidosDesdeConteo_(traslados, clave, sedeItem, ultimaFecha, fecha, indice, base.unidad || resAjustes.unidad);
      const unidadSede = base.unidad || resAjustes.unidad || resTraslados.unidad;
      if (!unidadSede) return; // nada con unidad reconocible todavía para esta sede
      unidadFinal = unidadFinal || unidadSede;
      total += base.cantidad + resAjustes.neto + resTraslados.total;
      if (ultimaFecha > fechaMasReciente) fechaMasReciente = ultimaFecha;
    });
    if (!unidadFinal) return; // sin conteo, compra ni traslado con unidad reconocible en ninguna sede
    resultado[clave] = { producto: entrada.nombre, cantidad: total, unidad: unidadFinal, fecha_conteo: fechaMasReciente || 'sin conteo aún' };
  });
  return resultado;
}

/** Suma compras/ajustes operativos y resta mermas de `sede` para `clave`, estrictamente después
 * de `fechaConteoExclusive` (vacío = sin tope inferior, para productos sin conteo previo) y hasta
 * `fechaCorteInclusive` (o sin tope si no se pasa fecha de corte). Si `unidadEsperada` viene
 * vacío (no hay conteo previo con qué comparar), toma la unidad de la primera compra/ajuste que
 * encuentre y exige que el resto coincida con esa. */
function netoAjustesDesdeConteo_(ajustes, clave, sede, fechaConteoExclusive, fechaCorteInclusive, indice, unidadEsperada) {
  let neto = 0;
  let unidad = unidadEsperada || '';
  ajustes.forEach(function (a) {
    if ((a.sede || 'Sin sede') !== sede) return;
    if (claveProducto_(a.producto, indice) !== clave) return;
    const f = formatearFecha_(a.fecha);
    if (f <= fechaConteoExclusive) return;
    if (fechaCorteInclusive && f > fechaCorteInclusive) return;
    const base = aUnidadBase_(a.cantidad, a.unidad);
    if (!unidad) unidad = base.unidad;
    if (base.unidad !== unidad) return;
    neto += a.tipo === 'Merma / desperdicio' ? -base.cantidad : base.cantidad;
  });
  return { neto: neto, unidad: unidad };
}

/** Suma lo recibido por `sede` para `clave` vía traslados Confirmados o Resueltos (ver
 * Traslados.gs), usando la fecha real de recepción (timestamp_recibe, o `fecha` si por algún
 * motivo no quedó registrada) — estrictamente después de `fechaConteoExclusive` y hasta
 * `fechaCorteInclusive`. Un traslado resuelto con faltante suma solo lo realmente recibido
 * (cantidad_recibida), no lo enviado. Mismo auto-detección de unidad que netoAjustesDesdeConteo_
 * cuando no hay conteo previo. */
function trasladosRecibidosDesdeConteo_(traslados, clave, sede, fechaConteoExclusive, fechaCorteInclusive, indice, unidadEsperada) {
  let total = 0;
  let unidad = unidadEsperada || '';
  traslados.forEach(function (t) {
    if (t.sede_destino !== sede) return;
    if (['Confirmado', 'Resuelto'].indexOf(t.estado) === -1) return;
    if (claveProducto_(t.producto, indice) !== clave) return;
    const f = formatearFecha_(t.timestamp_recibe || t.fecha);
    if (f <= fechaConteoExclusive) return;
    if (fechaCorteInclusive && f > fechaCorteInclusive) return;
    const recibida = t.cantidad_recibida !== '' && t.cantidad_recibida !== null && t.cantidad_recibida !== undefined
      ? t.cantidad_recibida : t.cantidad_enviada;
    const base = aUnidadBase_(recibida, t.unidad);
    if (!unidad) unidad = base.unidad;
    if (base.unidad !== unidad) return;
    total += base.cantidad;
  });
  return { total: total, unidad: unidad };
}
