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
  // Solo lectura: se memoizan las hojas durante todo el cálculo (ver conCacheDeTablas_ en Code.gs).
  // Sin esto, cada día con ventas volvía a pedir Fudo_Items/Ventas_FUDO/Fudo_Subitems completas.
  if (typeof conCacheDeTablas_ === 'function') {
    return conCacheDeTablas_(function () { return calcularDisponibleHoySinCache_(fecha, sede); });
  }
  return calcularDisponibleHoySinCache_(fecha, sede);
}

function calcularDisponibleHoySinCache_(fecha, sede) {
  const indice = indiceCatalogo_();
  const recetas = recetasVigentes_(fecha, sede);
  const stockContado = obtenerUltimoStockPorIngrediente_(fecha, indice, sede);
  const recetaMap = construirRecetaMap_(recetas, indice);
  const memo = {};

  function detalleClave_(clave) {
    const det = cantidadDisponibleDetallada_(clave, recetaMap, stockContado, indice, memo, {});
    const limitante = det.limitante;
    const raiz = limitante ? limitanteRaiz_(limitante) : null;
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
      // El insumo base que de verdad está topando (fin de la cadena → → →) y si alguna vez se ha
      // contado. Si nunca se ha contado, "0 g" es un dato faltante, no un agotamiento confirmado —
      // recetas.html/dashboard.html lo muestran distinto (⚠ falta contar X) en vez de dar a
      // entender que está confirmado en cero.
      limitante_raiz: raiz ? raiz.nombre : null,
      limitante_sin_dato: raiz ? !!raiz.sin_dato : false,
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
    ventas_descontadas: true,
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
function claveRecetaEnMapa_(texto, recetaMap, indice) {
  const exacta = normalizar_(texto);
  if (recetaMap && recetaMap[exacta]) return exacta;
  return claveProducto_(texto, indice);
}

function construirRecetaMap_(recetas, indice) {
  const recetaMap = {};
  const grupos = {};

  (recetas || []).forEach(function (r) {
    const canonica = claveProducto_(r.producto, indice);
    const exacta = normalizar_(r.producto);
    if (!grupos[canonica]) grupos[canonica] = [];
    if (grupos[canonica].indexOf(exacta) === -1) {
      grupos[canonica].push(exacta);
    }
  });

  const preferida = {};
  Object.keys(grupos).forEach(function (canonica) {
    preferida[canonica] = grupos[canonica].indexOf(canonica) !== -1
      ? canonica
      : grupos[canonica][0];
  });

  (recetas || []).forEach(function (r) {
    const canonica = claveProducto_(r.producto, indice);
    const exacta = normalizar_(r.producto);
    const clave = exacta === preferida[canonica] ? canonica : exacta;
    const tipo = (r.tipo || 'plato').toString().trim() || 'plato';

    if (!recetaMap[clave]) {
      recetaMap[clave] = {
        nombre: nombreCanonico_(r.producto, indice),
        nombre_origen: String(r.producto || '').trim(),
        tipo: tipo,
        lineas: []
      };
    }

    if (recetaMap[clave].tipo !== tipo) {
      recetaMap[clave].conflicto_tipos = true;
    }

    const entradaBase = aUnidadBase_(r.cantidad, r.unidad);
    const salidaBase =
      r.rendimiento_producto !== '' &&
      r.rendimiento_producto !== null &&
      r.rendimiento_producto !== undefined
        ? aUnidadBase_(
            r.rendimiento_producto,
            r.unidad_rendimiento || r.unidad
          )
        : { cantidad: 1, unidad: 'u' };

    recetaMap[clave].lineas.push({
      ingrediente: r.ingrediente,
      cantidad: entradaBase.cantidad,
      unidad: entradaBase.unidad,
      rendimiento: salidaBase.cantidad || 1,
      unidad_rendimiento: salidaBase.unidad,
      controla_disponibilidad: !(
        r.controla_disponibilidad === false ||
        normalizar_(r.controla_disponibilidad) === 'no' ||
        normalizar_(r.controla_disponibilidad) === 'false'
      ),
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
      const claveIng = claveRecetaEnMapa_(linea.ingrediente, recetaMap, indice);
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
          // Distingue "nunca se ha contado este insumo" (sin_dato: no hay ninguna fila en
          // Conteos_Manuales/compras/traslados con ese nombre) de "sí se contó y dio cero" — antes
          // ambos casos se veían igual ("0 g"), como si estuviera confirmado agotado, cuando podía
          // ser simplemente que a nadie se le ocurrió contarlo o que el nombre no coincide con el
          // de la receta (ver sinDatoRaiz_ más abajo).
          sin_dato: det.sin_dato,
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
    unidad: contadoEntry ? contadoEntry.unidad : '',
    sin_dato: !contadoEntry
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
 * El último eslabón de la cadena de `sub_limitante` — el insumo base que de verdad está topando
 * la producción (ej. "Costilla San Luis Entera", no el intermedio "Costilla Preparada"). Sobre
 * ese insumo tiene sentido preguntar "¿nunca se ha contado, o sí se contó y dio cero?".
 */
function limitanteRaiz_(limitante) {
  let actual = limitante;
  let vueltas = 0;
  while (actual && actual.sub_limitante && vueltas < 10) {
    actual = actual.sub_limitante;
    vueltas++;
  }
  return actual;
}

/**
 * Explota recursivamente un producto en gramos/unidades de ingredientes base, SIN mirar stock —
 * solo "cuánto necesito de cada cosa para 1 unidad". Se usa para mostrar el detalle de receta en
 * la UI. A diferencia de cantidadDisponibleDetallada_, sí atraviesa capas "produccion" para
 * mostrar el desglose completo hasta materia prima.
 */
function aplanarConsumo_(claveProducto, recetaMap, indice, cantidadBase, acumulado, profundidad, enCurso) {
  cantidadBase = cantidadBase || 1;
  acumulado = acumulado || {};
  profundidad = profundidad || 0;
  enCurso = enCurso || {};

  if (profundidad > 10) return acumulado;
  if (enCurso[claveProducto]) return acumulado;

  const entrada = recetaMap[claveProducto];
  if (!entrada) return acumulado;

  enCurso[claveProducto] = true;

  entrada.lineas.forEach(function (linea) {
    const ratio = linea.cantidad / linea.rendimiento;
    const cantidadTotal = cantidadBase * ratio;
    const claveIngrediente = claveRecetaEnMapa_(
      linea.ingrediente,
      recetaMap,
      indice
    );

    if (recetaMap[claveIngrediente]) {
      aplanarConsumo_(
        claveIngrediente,
        recetaMap,
        indice,
        cantidadTotal,
        acumulado,
        profundidad + 1,
        enCurso
      );
    } else {
      if (!acumulado[claveIngrediente]) {
        acumulado[claveIngrediente] = {
          nombre: nombreCanonico_(linea.ingrediente, indice),
          cantidad: 0,
          unidad: linea.unidad
        };
      }
      acumulado[claveIngrediente].cantidad += cantidadTotal;
    }
  });

  delete enCurso[claveProducto];
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
function explotarReceta_(claveProducto, cantidadBase, recetaMap, acumulado, indice, profundidad, enCurso) {
  profundidad = profundidad || 0;
  enCurso = enCurso || {};

  if (profundidad > 6) return acumulado;
  if (enCurso[claveProducto]) return acumulado;

  const entrada = recetaMap[claveProducto];
  if (!entrada) return acumulado;

  enCurso[claveProducto] = true;

  entrada.lineas.forEach(function (linea) {
    const cantidadTotal =
      cantidadBase * (linea.cantidad / linea.rendimiento);

    const claveIngrediente = claveRecetaEnMapa_(
      linea.ingrediente,
      recetaMap,
      indice
    );

    const subEntrada = recetaMap[claveIngrediente];

    if (subEntrada && subEntrada.tipo !== 'produccion') {
      explotarReceta_(
        claveIngrediente,
        cantidadTotal,
        recetaMap,
        acumulado,
        indice,
        profundidad + 1,
        enCurso
      );
    } else {
      if (!acumulado[claveIngrediente]) {
        acumulado[claveIngrediente] = {
          nombre: nombreCanonico_(linea.ingrediente, indice),
          cantidad: 0,
          unidad: linea.unidad
        };
      }
      acumulado[claveIngrediente].cantidad += cantidadTotal;
    }
  });

  delete enCurso[claveProducto];
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
 * sede, se suma lo producido (Producciones, ver Produccion.gs / netoProduccionDesdeConteo_), y se
 * restan las mermas/desperdicio (Ajustes_Inventario, ver AjustesInventario.gs; Traslados, ver
 * Traslados.gs), todo registrado en esa misma sede después de ese conteo y hasta la fecha de corte
 * — así una compra, una producción o un traslado recibido en Capri aumenta de inmediato el
 * disponible de Capri sin esperar al próximo conteo físico, y no afecta el número de San Antonio.
 * El conteo físico sigue siendo la referencia real; esto solo cubre el tiempo entre conteos.
 *
 * Los traslados restan de la sede de origen (sede_origen) desde el momento en que se crean —
 * apenas se envía el producto ya salió físicamente de esa sede, sin importar si luego queda
 * Enviado, Con observación, Confirmado o Resuelto (ver trasladosEnviadosDesdeConteo_). El destino
 * solo suma cuando el traslado queda Confirmado o Resuelto (trasladosRecibidosDesdeConteo_), y
 * suma lo realmente recibido (cantidad_recibida), no lo enviado.
 *
 * Aunque producir SÍ suma el producto terminado (ej. Costilla Preparada), todavía NO resta la
 * materia prima que se usó para prepararlo (ej. Costilla San Luis Entera) — eso sigue sin
 * modelarse como salida, igual que las ventas: solo el próximo conteo físico de esa materia prima
 * lo reflejará. Mismo límite ya aceptado para compras/mermas, no es nuevo de este cambio.
 *
 * IMPORTANTE: un producto que TODAVÍA no se ha contado nunca en una sede, pero ya se compró, se
 * produjo o se recibió por traslado allí, igual debe aparecer (con "conteo" = 0 de base) — si no,
 * una compra de algo nuevo (ej. la primera vez que se compra banano) quedaría invisible en
 * Disponible Hoy hasta el primer conteo físico de ese producto, que es justo lo contrario de lo
 * que se pidió.
 */
function obtenerUltimoStockPorIngrediente_(fecha, indice, sede, soloClave) {
  indice = indice || indiceCatalogo_();
  const cacheVentas = {};
  const conteos = leerTabla_(SHEET_NAMES.CONTEOS);
  const ajustes = leerTabla_(SHEET_NAMES.AJUSTES_INVENTARIO);
  const traslados = leerTabla_(SHEET_NAMES.TRASLADOS);
  // Producción registrada (Producir.gs/producir.html) suma al stock contado igual que una compra
  // — pedido real: "registrar producción o compras debe de mover el disponible hoy". Antes solo
  // quedaba como historial (Conciliacion.gs/Tendencia.gs la usaban, pero Disponible Hoy nunca la
  // leía): producir 5000g de Costilla Preparada no se reflejaba hasta el próximo conteo físico,
  // aunque esa costilla ya estuviera lista y disponible de verdad.
  const producciones = leerTabla_(SHEET_NAMES.PRODUCCIONES);
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
    if (!fechas[f]) fechas[f] = { cantidad: 0, unidad: base.unidad, timestamp: '' };
    if (fechas[f].unidad !== base.unidad) return;
    fechas[f].cantidad += base.cantidad;
    // El más tardío entre los conteos de ese mismo día (puede haber varios puntos de conteo
    // contando ese día) — es la hora real a partir de la cual una compra/merma/traslado del MISMO
    // día ya debe sumar (ver eventoCubiertoPorConteo_ más abajo).
    const tsConteo = timestampOrdenable_(c.timestamp);
    if (tsConteo > fechas[f].timestamp) fechas[f].timestamp = tsConteo;
  });

  function asegurarSinConteo_(producto, sedeItem) {
    if (sede && sede !== 'Ambas' && sedeItem !== sede) return;
    entradaSede_(entradaProducto_(claveProducto_(producto, indice), nombreCanonico_(producto, indice)), sedeItem);
  }
  ajustes.forEach(function (a) { asegurarSinConteo_(a.producto, a.sede || 'Sin sede'); });
  traslados.forEach(function (t) {
    asegurarSinConteo_(t.producto, t.sede_origen);
    if (['Confirmado', 'Resuelto'].indexOf(t.estado) !== -1) asegurarSinConteo_(t.producto, t.sede_destino);
  });
  producciones.forEach(function (p) { asegurarSinConteo_(p.item, p.sede || 'Sin sede'); });

  // Ajustes, traslados y producciones se agrupan UNA vez por (producto, sede). Antes cada una de las
  // tres funciones de abajo recibía la tabla completa y la recorría entera para cada producto y cada
  // sede: con 300 productos y un año de movimientos eso son cientos de miles de comparaciones de
  // nombre repetidas. Las funciones siguen comprobando producto y sede por su cuenta, así que
  // pasarles solo su grupo no cambia el resultado.
  const idxAjustes = agruparMovimientosPorClaveYSede_(ajustes, 'producto', function (a) { return a.sede || 'Sin sede'; }, indice);
  const idxTraslados = agruparMovimientosPorClaveYSede_(traslados, 'producto', function (t) { return t.sede_destino; }, indice);
  const idxTrasladosEnviados = agruparMovimientosPorClaveYSede_(traslados, 'producto', function (t) { return t.sede_origen; }, indice);
  const idxProducciones = agruparMovimientosPorClaveYSede_(producciones, 'item', function (p) { return p.sede || 'Sin sede'; }, indice);

  const resultado = {};
  Object.keys(porProducto).forEach(function (clave) {
    // `soloClave` (opcional) limita el cálculo a UN producto: Tendencia.gs recalcula el stock una
    // vez por cada día del rango, y sin esto cada uno de esos días recorría los ajustes, traslados,
    // producciones y ventas de todos los productos del catálogo para quedarse con uno solo.
    if (soloClave && clave !== soloClave) return;
    const entrada = porProducto[clave];
    let total = 0;
    let unidadFinal = '';
    let fechaMasReciente = '';
    Object.keys(entrada.porSede).forEach(function (sedeItem) {
      const fechasSede = Object.keys(entrada.porSede[sedeItem].fechas).sort();
      const hayConteo = fechasSede.length > 0;
      const ultimaFecha = hayConteo ? fechasSede[fechasSede.length - 1] : '';
      const base = hayConteo ? entrada.porSede[sedeItem].fechas[ultimaFecha] : { cantidad: 0, unidad: '', timestamp: '' };
      const grupo = clave + '|' + sedeItem;
      const resAjustes = netoAjustesDesdeConteo_(idxAjustes[grupo] || [], clave, sedeItem, ultimaFecha, base.timestamp, fecha, indice, base.unidad);
      const resTraslados = trasladosRecibidosDesdeConteo_(idxTraslados[grupo] || [], clave, sedeItem, ultimaFecha, base.timestamp, fecha, indice, base.unidad || resAjustes.unidad);
      const resTrasladosEnviados = trasladosEnviadosDesdeConteo_(idxTrasladosEnviados[grupo] || [], clave, sedeItem, ultimaFecha, base.timestamp, fecha, indice, base.unidad || resAjustes.unidad || resTraslados.unidad);
      const resProduccion = netoProduccionDesdeConteo_(idxProducciones[grupo] || [], clave, sedeItem, ultimaFecha, base.timestamp, fecha, indice, base.unidad || resAjustes.unidad || resTraslados.unidad || resTrasladosEnviados.unidad);
      const resVentas = netoVentasDesdeConteo_(clave, sedeItem, ultimaFecha, fecha, indice, base.unidad || resAjustes.unidad || resTraslados.unidad || resTrasladosEnviados.unidad || resProduccion.unidad, cacheVentas);
      const unidadSede = base.unidad || resAjustes.unidad || resTraslados.unidad || resTrasladosEnviados.unidad || resProduccion.unidad || resVentas.unidad;
      if (!unidadSede) return; // nada con unidad reconocible todavía para esta sede
      unidadFinal = unidadFinal || unidadSede;
      total += base.cantidad + resAjustes.neto + resTraslados.total - resTrasladosEnviados.total + resProduccion.neto + resVentas.neto;
      if (ultimaFecha > fechaMasReciente) fechaMasReciente = ultimaFecha;
    });
    if (!unidadFinal) return; // sin conteo, compra, traslado ni producción con unidad reconocible en ninguna sede
    resultado[clave] = { producto: entrada.nombre, cantidad: total, unidad: unidadFinal, fecha_conteo: fechaMasReciente || 'sin conteo aún' };
  });
  return resultado;
}

/**
 * Agrupa filas de movimiento por "clave de producto|sede", calculando la clave UNA vez por fila.
 * `campoProducto` es el nombre de la columna con el producto (en Producciones se llama `item`), y
 * `sedeDe` extrae la sede que corresponde a ese tipo de movimiento. Los traslados se indexan DOS
 * veces con esta función: una por sede_destino (lo que llega) y otra por sede_origen (lo que sale).
 */
function agruparMovimientosPorClaveYSede_(filas, campoProducto, sedeDe, indice) {
  const idx = {};
  (filas || []).forEach(function (fila) {
    const grupo = claveProducto_(fila[campoProducto], indice) + '|' + sedeDe(fila);
    if (!idx[grupo]) idx[grupo] = [];
    idx[grupo].push(fila);
  });
  return idx;
}

/** Convierte un timestamp (objeto Date o string) en un string comparable lexicográficamente
 * (ISO 8601), o '' si no hay dato válido — para poder comparar "quién fue primero" entre un
 * conteo y una compra/merma/traslado del MISMO día calendario (ver eventoCubiertoPorConteo_). */
function timestampOrdenable_(valor) {
  if (!valor) return '';
  const d = (valor instanceof Date) ? valor : new Date(valor);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Si un evento (compra, merma, traslado recibido) en `fechaEvento`/`timestampEvento` ya queda
 * cubierto por el conteo físico hecho en `fechaConteo`/`timestampConteo` — o sea, si NO debe
 * sumar aparte porque se asume que ese conteo ya lo incluía.
 *
 * Antes esto se decidía solo por fecha (día calendario), sin hora: cualquier evento del MISMO día
 * que el último conteo se descartaba SIEMPRE, sin importar si había pasado antes o después del
 * cierre — pedido real: "lo que tengo disponible para hoy no me cuadra". Ejemplo real: si el
 * conteo físico de la mañana marca 2000 g de Costilla San Luis y esa misma tarde llega una compra
 * de 5000 g, "Disponible Hoy" seguía mostrando 2000 g hasta el conteo del día siguiente. Ahora, si
 * los dos lados tienen hora real (timestamp), el mismo día se decide por hora: el evento SÍ suma
 * si ocurrió después del conteo. Sin hora en alguno de los dos lados (dato viejo o incompleto), se
 * mantiene el comportamiento anterior (conservador: se asume cubierto) para no inventar un orden
 * que el dato no tiene.
 */
function eventoCubiertoPorConteo_(fechaEvento, timestampEvento, fechaConteo, timestampConteo) {
  if (!fechaConteo) return false; // sin conteo previo, nada puede estar "ya cubierto"
  if (fechaEvento < fechaConteo) return true;
  if (fechaEvento > fechaConteo) return false;
  if (!timestampConteo || !timestampEvento) return true; // mismo día, sin hora de alguno: conservador
  return timestampEvento <= timestampConteo;
}

/** Suma compras/ajustes operativos y resta mermas de `sede` para `clave`, después del conteo
 * físico marcado por `fechaConteoExclusive`/`timestampConteoExclusive` (vacío = sin tope inferior,
 * para productos sin conteo previo — ver eventoCubiertoPorConteo_) y hasta `fechaCorteInclusive`
 * (o sin tope si no se pasa fecha de corte). Si `unidadEsperada` viene vacío (no hay conteo previo
 * con qué comparar), toma la unidad de la primera compra/ajuste que encuentre y exige que el
 * resto coincida con esa. */
function netoAjustesDesdeConteo_(ajustes, clave, sede, fechaConteoExclusive, timestampConteoExclusive, fechaCorteInclusive, indice, unidadEsperada) {
  let neto = 0;
  let unidad = unidadEsperada || '';
  ajustes.forEach(function (a) {
    if ((a.sede || 'Sin sede') !== sede) return;
    if (claveProducto_(a.producto, indice) !== clave) return;
    const f = formatearFecha_(a.fecha);
    if (eventoCubiertoPorConteo_(f, timestampOrdenable_(a.timestamp), fechaConteoExclusive, timestampConteoExclusive)) return;
    if (fechaCorteInclusive && f > fechaCorteInclusive) return;
    const base = aUnidadBase_(a.cantidad, a.unidad);
    if (!unidad) unidad = base.unidad;
    if (base.unidad !== unidad) return;
    neto += a.tipo === 'Merma / desperdicio' || a.tipo === 'Consumo interno' ? -base.cantidad : base.cantidad;
  });
  return { neto: neto, unidad: unidad };
}

/** Suma lo recibido por `sede` para `clave` vía traslados Confirmados o Resueltos (ver
 * Traslados.gs), usando la fecha/hora real de recepción (timestamp_recibe, o `fecha` si por algún
 * motivo no quedó registrada) — después del conteo marcado por
 * `fechaConteoExclusive`/`timestampConteoExclusive` y hasta `fechaCorteInclusive`. Un traslado
 * resuelto con faltante suma solo lo realmente recibido (cantidad_recibida), no lo enviado. Mismo
 * auto-detección de unidad que netoAjustesDesdeConteo_ cuando no hay conteo previo. */
function trasladosRecibidosDesdeConteo_(traslados, clave, sede, fechaConteoExclusive, timestampConteoExclusive, fechaCorteInclusive, indice, unidadEsperada) {
  let total = 0;
  let unidad = unidadEsperada || '';
  traslados.forEach(function (t) {
    if (t.sede_destino !== sede) return;
    if (['Confirmado', 'Resuelto'].indexOf(t.estado) === -1) return;
    if (claveProducto_(t.producto, indice) !== clave) return;
    const fuenteFecha = t.timestamp_recibe || t.fecha;
    const f = formatearFecha_(fuenteFecha);
    if (eventoCubiertoPorConteo_(f, timestampOrdenable_(fuenteFecha), fechaConteoExclusive, timestampConteoExclusive)) return;
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

/** Resta lo enviado por `sede` para `clave` vía traslados (ver Traslados.gs), usando la fecha/hora
 * real de envío (timestamp_envio, o `fecha` si por algún motivo no quedó registrada) — después del
 * conteo marcado por `fechaConteoExclusive`/`timestampConteoExclusive` y hasta
 * `fechaCorteInclusive`. A diferencia de trasladosRecibidosDesdeConteo_, esto cuenta CUALQUIER
 * estado (Enviado, Con observación, Confirmado, Resuelto): el producto salió físicamente de la
 * sede en el momento del envío, sin importar qué pase después con la confirmación/observación en
 * el destino. Diana (ago 2026): "apenas se realiza el traslado resta de la sede que envía". Usa
 * siempre cantidad_enviada (lo que de verdad salió de la sede), nunca cantidad_recibida (eso es un
 * asunto del destino, ver trasladosRecibidosDesdeConteo_). */
function trasladosEnviadosDesdeConteo_(traslados, clave, sede, fechaConteoExclusive, timestampConteoExclusive, fechaCorteInclusive, indice, unidadEsperada) {
  let total = 0;
  let unidad = unidadEsperada || '';
  traslados.forEach(function (t) {
    if (t.sede_origen !== sede) return;
    if (claveProducto_(t.producto, indice) !== clave) return;
    const fuenteFecha = t.timestamp_envio || t.fecha;
    const f = formatearFecha_(fuenteFecha);
    if (eventoCubiertoPorConteo_(f, timestampOrdenable_(fuenteFecha), fechaConteoExclusive, timestampConteoExclusive)) return;
    if (fechaCorteInclusive && f > fechaCorteInclusive) return;
    const base = aUnidadBase_(t.cantidad_enviada, t.unidad);
    if (!unidad) unidad = base.unidad;
    if (base.unidad !== unidad) return;
    total += base.cantidad;
  });
  return { total: total, unidad: unidad };
}

/** Suma lo producido (Producciones, ver Produccion.gs) de `sede` para `clave`, después del conteo
 * marcado por `fechaConteoExclusive`/`timestampConteoExclusive` y hasta `fechaCorteInclusive` —
 * mismo criterio exacto que netoAjustesDesdeConteo_ para una compra, siempre suma (nunca resta:
 * producir no tiene equivalente a una merma). Pedido real: "registrar producción... debe de mover
 * el disponible hoy" — un lote recién preparado (ej. Costilla Preparada) queda disponible de
 * inmediato, sin esperar al próximo conteo físico de ese producto. */
function netoProduccionDesdeConteo_(producciones, clave, sede, fechaConteoExclusive, timestampConteoExclusive, fechaCorteInclusive, indice, unidadEsperada) {
  let neto = 0;
  let unidad = unidadEsperada || '';
  producciones.forEach(function (p) {
    if ((p.sede || 'Sin sede') !== sede) return;
    if (claveProducto_(p.item, indice) !== clave) return;
    const f = formatearFecha_(p.fecha);
    if (eventoCubiertoPorConteo_(f, timestampOrdenable_(p.timestamp), fechaConteoExclusive, timestampConteoExclusive)) return;
    if (fechaCorteInclusive && f > fechaCorteInclusive) return;
    const base = aUnidadBase_(p.cantidad, p.unidad);
    if (!unidad) unidad = base.unidad;
    if (base.unidad !== unidad) return;
    neto += base.cantidad;
  });
  return { neto: neto, unidad: unidad };
}

/**
 * Resta el consumo por ventas (ítems + subítems, recetas vigentes) desde el último conteo físico
 * hasta la fecha de corte — Fase 6 del roadmap. Solo días posteriores al día del conteo (misma
 * limitación por fecha que calcularInventarioTeorico_).
 */
function netoVentasDesdeConteo_(clave, sede, fechaConteoExclusive, fechaCorteInclusive, indice, unidadEsperada, cacheVentas) {
  if (!sede || sede === 'Ambas') return { neto: 0, unidad: unidadEsperada || '' };
  if (typeof movimientosDesdeVentas_ !== 'function') return { neto: 0, unidad: unidadEsperada || '' };
  let neto = 0;
  let unidad = unidadEsperada || '';
  if (!fechaCorteInclusive) return { neto: 0, unidad: unidad };

  // El consumo de TODO el rango se explota una sola vez y queda indexado por producto (ver
  // consumoVentasPorProducto_): cada producto solo suma sus propias líneas. Antes cada producto
  // recorría, por cada día con ventas, la lista completa de movimientos de ese día — con 300
  // productos y un año de historia eso eran ~2,5 millones de comparaciones de nombre, el 91% del
  // tiempo de "Disponible Hoy".
  const lineas = consumoVentasPorProducto_(sede, fechaCorteInclusive, indice, cacheVentas)[clave] || [];
  lineas.forEach(function (l) {
    if (fechaConteoExclusive && l.fecha <= fechaConteoExclusive) return;
    const base = aUnidadBase_(Math.abs(l.cantidad), l.unidad);
    if (!unidad) unidad = base.unidad;
    if (base.unidad !== unidad) return;
    neto += l.cantidad;
  });
  return { neto: neto, unidad: unidad };
}

/**
 * Consumo por ventas de todos los días con ventas hasta `hasta`, agrupado por clave de producto:
 * { clave: [{ fecha, cantidad, unidad }, ...] }. Se calcula una vez por (sede, hasta) y se guarda en
 * el mismo objeto de caché que comparten los cálculos de consumo por venta.
 *
 * Cada producto tiene su propia fecha de último conteo, así que el recorte por fecha se hace al
 * sumar (en netoVentasDesdeConteo_) y no al construir el índice — construirlo completo cuesta lo
 * mismo que lo que antes pagaba el primer producto sin conteo previo.
 */
function consumoVentasPorProducto_(sede, hasta, indice, cacheVentas) {
  const claveCache = '__consumo_por_producto__|' + sede + '|' + hasta;
  if (cacheVentas && cacheVentas[claveCache]) return cacheVentas[claveCache];

  const fechas = typeof fudoFechasConVentasEnRango_ === 'function'
    ? fudoFechasConVentasEnRango_(sede, '', hasta, cacheVentas)
    : fechasEnRangoMovimientos_(hasta, hasta);
  const porClave = {};
  fechas.forEach(function (f) {
    movimientosDesdeVentas_(f, sede, indice, cacheVentas).forEach(function (m) {
      const clave = claveProducto_(m.producto, indice);
      if (!porClave[clave]) porClave[clave] = [];
      porClave[clave].push({ fecha: f, cantidad: m.cantidad, unidad: m.unidad });
    });
  });
  if (cacheVentas) cacheVentas[claveCache] = porClave;
  return porClave;
}
