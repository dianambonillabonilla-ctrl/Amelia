/**
 * CONCILIACIÓN
 * Reproduce, para cualquier fecha, el mismo análisis que hicimos manualmente día por día:
 *  - Bebidas: se comparan contra el consumo de FUDO — Movimientos_FUDO si ese día se subió el
 *    archivo manual (más preciso: trae el cierre de stock), o si no, Ventas_FUDO (API o manual,
 *    lo que ya tengamos sincronizado). Comparado contra ambos archivos reales (14-22 jul 2026):
 *    el 96%+ de los movimientos de una bebida son 1:1 con sus ventas (Adición Creada/Cancelada
 *    = vender/cancelar esa bebida), así que Ventas_FUDO solo no reproduce el cierre de stock que
 *    FUDO reporta (eso sí requeriría el archivo manual o /productos por API), pero SÍ reproduce
 *    el consumo esperado igual de bien.
 *  - Comida: NO se compara contra el stock de FUDO (sabemos que no cuadra). Se compara
 *    "cambio de peso físico (ayer -> hoy)" contra "ventas del día x tu receta (Recetas)",
 *    separado por sede, porque ya vimos que los problemas suelen ser específicos de una sede.
 *
 * Todas las comparaciones de nombre pasan por claveProducto_/nombreCanonico_ (Catalogo.gs),
 * igual que en DisponibleHoy.gs — así un mismo ingrediente escrito distinto en Conteos, Recetas,
 * Producciones o Ventas_FUDO se trata como un solo producto en toda la conciliación.
 */

/**
 * Recorre un rango de fechas y para cada una calcula la misma conciliación que calcularConciliacion_,
 * pero solo devuelve lo que NO CUADRA — bebidas con diferencia contra FUDO y comida con "implícito"
 * (lo que ningún registro operativo explica) distinto de cero — para no tener que revisar día por
 * día a mano buscando desfases. Pedido real: "que tuviera historico de conciliacion... que me
 * muestre lo que no cuadra o lo que esta desfasado aparte".
 */
function conciliacionHistorialDesfases_(fechaDesde, fechaHasta, usuario) {
  if (!fechaDesde || !fechaHasta) return { ok: false, error: 'Faltan fecha_desde/fecha_hasta' };
  if (fechaDesde > fechaHasta) return { ok: false, error: 'La fecha "desde" no puede ser posterior a la fecha "hasta"' };

  const fechas = rangoDeFechas_(fechaDesde, fechaHasta);
  if (fechas.length > 62) {
    return { ok: false, error: 'El rango es muy largo (máximo ~2 meses de una vez) — prueba con un rango más corto.' };
  }

  const sedeRestringida = sedeRestringidaConciliacion_(usuario);
  const bebidas = [];
  const comida = [];

  fechas.forEach(function (fecha) {
    conciliarBebidas_(fecha, sedeRestringida).forEach(function (b) {
      if (b.diferencia_vs_suma !== null && b.diferencia_vs_suma !== 0) {
        bebidas.push({
          fecha: fecha, producto: b.producto, suma_manual: b.suma_manual,
          fudo_cierre: b.fudo_cierre, diferencia: b.diferencia_vs_suma
        });
      }
    });

    const comidaPorSede = conciliarComidaPorSede_(fecha, sedeRestringida);
    Object.keys(comidaPorSede).forEach(function (sede) {
      comidaPorSede[sede].forEach(function (item) {
        // Tolerancia de 1 (g/ml/u según el ingrediente): evita llenar el histórico de "desfases" de
        // redondeo de un par de gramos que no significan nada operativamente.
        if (item.implicito !== null && Math.abs(item.implicito) >= 1) {
          comida.push({
            fecha: fecha, sede: sede, ingrediente: item.ingrediente, unidad: item.unidad,
            implicito: item.implicito, sin_receta: item.sin_receta
          });
        }
      });
    });
  });

  bebidas.sort(function (a, b) { return Math.abs(b.diferencia) - Math.abs(a.diferencia); });
  comida.sort(function (a, b) { return Math.abs(b.implicito) - Math.abs(a.implicito); });

  return { ok: true, dias_revisados: fechas.length, bebidas: bebidas, comida: comida };
}

/** 'yyyy-MM-dd' inclusive en ambos extremos — se arma con componentes locales (no parseando un
 * string ISO directo) para que la zona horaria no corra el día, mismo criterio que
 * frecuenciasDelDia_ en assets/config.js. */
function rangoDeFechas_(desde, hasta) {
  const fechas = [];
  let actual = desde;
  let guard = 0;
  while (actual <= hasta) {
    fechas.push(actual);
    const [y, m, d] = actual.split('-').map(Number);
    const siguiente = new Date(y, m - 1, d + 1);
    actual = siguiente.getFullYear() + '-' + String(siguiente.getMonth() + 1).padStart(2, '0') + '-' + String(siguiente.getDate()).padStart(2, '0');
    guard++;
    if (guard > 400) break; // salvavidas — nunca debería hacer falta con el tope de 62 días de arriba
  }
  return fechas;
}

function calcularConciliacion_(fecha, usuario) {
  const sedeRestringida = sedeRestringidaConciliacion_(usuario);
  return {
    fecha: fecha,
    // El frontend usa esto para saber si debe mostrar los controles/columnas de "toda la
    // empresa" (Administrador o sede "Ambas") o solo lo de su propia sede.
    sede_restringida: sedeRestringida,
    ventas: resumirVentasFudo_(fecha).filter(function (v) { return !sedeRestringida || v.sede === sedeRestringida; }),
    bebidas: conciliarBebidas_(fecha, sedeRestringida),
    comida: conciliarComidaPorSede_(fecha, sedeRestringida)
  };
}

/**
 * Un usuario de una sola sede (no Administrador, no sede "Ambas") solo debe ver que cuadre SU
 * parte de la conciliación — nunca la de otra sede. Administrador y "Ambas" siguen viendo todo,
 * igual que antes (null = sin restricción).
 */
function sedeRestringidaConciliacion_(usuario) {
  if (!usuario || usuario.rol === 'Administrador' || usuario.sede === 'Ambas') return null;
  return usuario.sede;
}

/**
 * FUDO no siempre escribe "Cancelada" con tilde — el export real trae "Si" sin tilde (además de
 * "No", y el formato resumido guarda el booleano `false`). Comparar con === 'Sí' a secas dejaba
 * pasar ventas canceladas como si fueran válidas, inflando "ventas esperadas" en Conciliación.
 * normalizar_ ya quita tildes/mayúsculas, así que cubre "Sí"/"Si"/"SI" por igual.
 */
function ventaCancelada_(v) {
  return v.cancelada === true || normalizar_(v.cancelada) === 'si';
}

function resumirVentasFudo_(fecha) {
  const grupos = {};
  leerTabla_(SHEET_NAMES.VENTAS_FUDO).filter(function (v) {
    return formatearFecha_(v.creacion) === fecha && !ventaCancelada_(v);
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
function conciliarBebidas_(fecha, sedeRestringida) {
  const indice = indiceCatalogo_();
  const movimientos = leerTabla_(SHEET_NAMES.MOVIMIENTOS_FUDO)
    .filter(function (m) { return formatearFecha_(m.fecha) === fecha; });
  // Fuente de respaldo cuando ese día no se subió el archivo manual de movimientos (o ya se dejó
  // de subir porque la sincronización de ventas es por API): cada línea vendida de una bebida
  // consume exactamente 1 unidad de esa bebida (no tiene receta, "sellAlone" en FUDO) — mismo
  // supuesto que ya usa conciliarComidaPorSede_ para productos sin receta encontrada.
  const ventasDelDia = leerTabla_(SHEET_NAMES.VENTAS_FUDO)
    .filter(function (v) { return formatearFecha_(v.creacion) === fecha && !ventaCancelada_(v); });

  // Una bebida de una sola sede (ej. algo que solo se vende en Capri, marcado con "Sede donde se
  // vende/usa" en Registrar producto) no debe aparecer en la conciliación de la otra — mismo
  // criterio que ya se aplica en Registrar conteo, cierre de turno y Registrar producción.
  const catalogo = leerTabla_(SHEET_NAMES.CATALOGO).filter(function (c) {
    if (!c.categoria || c.categoria.indexOf('Bebidas') !== 0) return false;
    return !c.sede || c.sede === 'Ambas' || !sedeRestringida || c.sede === sedeRestringida;
  });
  const conteos = conteoListar_(fecha, null);
  const stockBase = stockFudoBaseIndice_();
  // Todas las ventas desde la fecha más vieja de la base hasta `fecha` (no solo las del día) —
  // hace falta el rango completo para restar "lo vendido desde la base" en stockEsperadoFudo_.
  const ventasDesdeBase = leerTabla_(SHEET_NAMES.VENTAS_FUDO).filter(function (v) { return !ventaCancelada_(v); });

  return catalogo.map(function (item) {
    // Comparación normalizada (sin tildes/mayúsculas/espacios de sobra), igual que el resto del
    // sistema (Catalogo.gs, DisponibleHoy.gs). Antes comparaba con === y una tilde, mayúscula o
    // espacio distinto entre "nombre_fudo" del catálogo y el nombre real del export de FUDO hacía
    // que nunca hubiera match: la importación sí guardaba los movimientos, pero esta pantalla
    // seguía mostrando "Sin datos FUDO" para esa bebida en todas las fechas.
    const nombreFudoItem = normalizar_(item.nombre_fudo);
    const movsItem = nombreFudoItem
      ? movimientos.filter(function (m) { return normalizar_(m.nombre) === nombreFudoItem; })
      : [];
    movsItem.sort(function (a, b) { return new Date(a.fecha) - new Date(b.fecha); });
    const cierre = movsItem.length ? movsItem[movsItem.length - 1].stock_actual : null;

    const eventosVenta = ['Adición Creada', 'Adición Cancelada'];
    function consumoMovimientos_(sede) {
      return movsItem.filter(function (m) { return (!sede || m.sede === sede) && eventosVenta.indexOf(m.evento) !== -1; })
        .reduce(function (acc, m) { return acc - Number(m.diferencia || 0); }, 0);
    }
    // Sin movimientos ese día (no se subió el archivo manual, o ya se dejó de subir): cada línea
    // vendida de la bebida cuenta como 1 unidad consumida — ver comentario arriba de ventasDelDia.
    const ventasItem = nombreFudoItem
      ? ventasDelDia.filter(function (v) { return normalizar_(v.producto) === nombreFudoItem; })
      : [];
    function consumoVentasApi_(sede) {
      return ventasItem.filter(function (v) { return !sede || v.sede === sede; })
        .reduce(function (acc, v) { return acc + (Number(v.cantidad) || 0); }, 0);
    }
    const usarVentasApi = movsItem.length === 0;
    const consumoSede_ = usarVentasApi ? consumoVentasApi_ : consumoMovimientos_;
    const consumoVenta = consumoSede_(null);

    const claveItem = claveProducto_(item.nombre_estandar, indice);
    const sa = conteos.find(function (c) { return claveProducto_(c.producto, indice) === claveItem && c.sede === 'San Antonio'; });
    const capri = conteos.find(function (c) { return claveProducto_(c.producto, indice) === claveItem && c.sede === 'Capri'; });
    const suma = (sa ? Number(sa.cantidad) : 0) + (capri ? Number(capri.cantidad) : 0);

    // Si ese día no hubo movimientos (cierre === null), FUDO igual sabe el stock — solo que no lo
    // sabemos NOSOTROS a menos que hayamos cargado un punto de partida (Stock_FUDO_Base, ver
    // stockFudoBaseImportar_ en StockFudoBase.gs). Sin eso, antes esta bebida se mostraba "Sin
    // datos FUDO" aunque tuviera consumo real calculado — el problema nunca era el consumo, era
    // no tener ningún número de stock contra el cual comparar el conteo físico.
    const estimadoBase = cierre === null
      ? stockEsperadoFudo_(nombreFudoItem, fecha, stockBase, ventasDesdeBase)
      : null;
    const referencia = cierre !== null ? cierre : estimadoBase;

    const fila = {
      producto: item.nombre_estandar,
      sa: sa ? Number(sa.cantidad) : null,
      capri: capri ? Number(capri.cantidad) : null,
      suma_manual: suma,
      fudo_cierre: cierre,
      stock_esperado_fudo: estimadoBase,
      diferencia_vs_suma: (referencia !== null) ? (referencia - suma) : null,
      consumo_fudo_total: consumoVenta,
      consumo_fudo_sa: consumoSede_('San Antonio'),
      consumo_fudo_capri: consumoSede_('Capri'),
      // Transparencia sobre de dónde salió el consumo — 'movimientos_manual' es más preciso
      // (trae también fudo_cierre), 'ventas_api' es el respaldo cuando ese día no hay archivo de
      // movimientos subido (comparado contra datos reales, jul 2026: coinciden en el 96%+ de los
      // casos — la diferencia son entradas de mercancía, que no son "consumo" sino compras).
      consumo_fudo_fuente: usarVentasApi ? 'ventas_api' : 'movimientos_manual',
      // De dónde salió el número contra el que se compara suma_manual (fila.diferencia_vs_suma):
      // el cierre real reportado por FUDO ese día, el estimado desde Stock_FUDO_Base, o ninguno.
      referencia_fuente: cierre !== null ? 'movimientos_manual' : (estimadoBase !== null ? 'stock_base_estimado' : null),
      n_movimientos_fudo: movsItem.length
    };
    return sedeRestringida ? filaBebidaRestringida_(fila, sedeRestringida) : fila;
  });
}

/**
 * Stock esperado de una bebida en `fecha`, partiendo de Stock_FUDO_Base y restando lo vendido
 * desde la fecha de esa base (sin contar lo cancelado). Si `fecha` es el mismo día de la base, se
 * devuelve el número de la base tal cual — no se sabe a qué hora del día se tomó ese snapshot,
 * así que restar las ventas de ese mismo día podría estar restando algo que la base YA reflejaba.
 * Si `fecha` es anterior a la base, no hay nada que estimar (la base no existía todavía ese día).
 */
function stockEsperadoFudo_(nombreFudoItem, fecha, stockBase, ventasDesdeBase) {
  if (!nombreFudoItem) return null;
  const base = stockBase[nombreFudoItem];
  if (!base) return null;
  const fechaBase = formatearFecha_(base.fecha_base);
  if (fecha < fechaBase) return null;
  if (fecha === fechaBase) return Number(base.stock);
  const consumidoDesdeBase = ventasDesdeBase.filter(function (v) {
    const f = formatearFecha_(v.creacion);
    return f > fechaBase && f <= fecha && normalizar_(v.producto) === nombreFudoItem;
  }).reduce(function (acc, v) { return acc + (Number(v.cantidad) || 0); }, 0);
  return Number(base.stock) - consumidoDesdeBase;
}

/**
 * FUDO guarda un solo stock de bebidas compartido entre San Antonio y Capri (fudo_cierre no viene
 * separado por sede) — así que un usuario de una sola sede no puede quedarse ni con eso ni con el
 * conteo/consumo de la otra sede: mostrarle su propio conteo junto al cierre combinado dejaría
 * deducir el número de la otra sede por resta. Se conserva solo lo que es enteramente de su sede.
 */
function filaBebidaRestringida_(fila, sede) {
  const propio = sede === 'San Antonio' ? { sa: fila.sa, consumo_fudo_sa: fila.consumo_fudo_sa }
    : sede === 'Capri' ? { capri: fila.capri, consumo_fudo_capri: fila.consumo_fudo_capri }
    : {};
  return Object.assign({
    producto: fila.producto, sa: null, capri: null, suma_manual: null, fudo_cierre: null,
    stock_esperado_fudo: null, diferencia_vs_suma: null, consumo_fudo_total: null,
    consumo_fudo_sa: null, consumo_fudo_capri: null,
    consumo_fudo_fuente: fila.consumo_fudo_fuente, referencia_fuente: fila.referencia_fuente, n_movimientos_fudo: null
  }, propio);
}

// --- COMIDA: por sede, ventas x receta vs. cambio físico --------------------
function conciliarComidaPorSede_(fecha, sedeRestringida) {
  const indice = indiceCatalogo_();
  const ventas = leerTabla_(SHEET_NAMES.VENTAS_FUDO)
    .filter(function (v) { return formatearFecha_(v.creacion) === fecha && !ventaCancelada_(v); });

  // Con sede restringida, solo se calcula (y se devuelve) el bloque de esa sede — las otras dos
  // ni siquiera se procesan, así nunca hay nada de otra sede en la respuesta.
  const sedes = sedeRestringida ? [sedeRestringida] : ['Centro de Producción', 'San Antonio', 'Capri'];
  const resultado = {};

  sedes.forEach(function (sede) {
    const recetaMap = construirRecetaMap_(recetasVigentes_(fecha, sede), indice);
    const cambioFisico = calcularCambioFisico_(fecha, sede, indice);
    const ventasSede = ventas.filter(function (v) { return v.sede === sede; });
    const consumoEsperado = {};
    ventasSede.forEach(function (v) {
      const claveProd = claveRecetaVenta_(v.producto, recetaMap, indice);
      if (recetaMap[claveProd]) {
        explotarReceta_(claveProd, Number(v.cantidad) || 0, recetaMap, consumoEsperado, indice);
      } else {
        // Sin receta (ej. una bebida: se vende 1 unidad, se consume 1 unidad) — se autoconsume
        // 1:1 en vez de no contar nada, para que también cuadre en esta misma fórmula. La unidad
        // debe coincidir con la del conteo físico (no siempre es "u": puede venir en g/ml si así
        // se cuenta esa sede), si no, cambio/esperado quedarían en unidades distintas y la resta
        // de más abajo mezclaría cosas que no son comparables.
        // sin_receta: true queda marcado en el resultado — así se distingue un producto que
        // GENUINAMENTE no tiene receta (una bebida) de uno que sí debería tener receta pero el
        // nombre de venta de FUDO no coincidió con ningún producto de Recetas (el mismo problema
        // que tuvo "Falafel" con "Falafel (plato)", ver claveRecetaVenta_ en Recetas.gs). Antes
        // ambos casos se mezclaban sin ningún aviso, comparado 1:1 como si fuera correcto.
        const unidadConteo = (cambioFisico[claveProd] && cambioFisico[claveProd].unidad) || 'u';
        if (!consumoEsperado[claveProd]) consumoEsperado[claveProd] = { nombre: nombreCanonico_(v.producto, indice), cantidad: 0, unidad: unidadConteo, sin_receta: true };
        consumoEsperado[claveProd].cantidad += Number(v.cantidad) || 0;
      }
    });

    const producido = produccionTotalPorItem_(fecha, sede, indice);
    const consumoProduccion = consumoEsperadoPorProduccion_(fecha, sede, indice);
    const traslados = trasladosNetosPorItem_(fecha, sede, indice);
    const ajustes = ajustesNetosPorItem_(fecha, sede, indice);

    const ingredientes = new Set(Object.keys(consumoEsperado).concat(Object.keys(cambioFisico)).concat(Object.keys(producido)).concat(Object.keys(consumoProduccion)).concat(Object.keys(traslados)).concat(Object.keys(ajustes)));
    resultado[sede] = Array.from(ingredientes).map(function (claveIng) {
      const nombreIng = (consumoEsperado[claveIng] && consumoEsperado[claveIng].nombre) ||
        (cambioFisico[claveIng] && cambioFisico[claveIng].nombre) || claveIng;
      const esperado = consumoEsperado[claveIng] ? consumoEsperado[claveIng].cantidad : 0;
      const cambio = cambioFisico[claveIng] !== undefined ? cambioFisico[claveIng].cantidad : null;
      const producidoIng = producido[claveIng] ? producido[claveIng].cantidad : 0;
      const consumoProd = consumoProduccion[claveIng] ? consumoProduccion[claveIng].cantidad : 0;
      const trasladoNeto = traslados[claveIng] ? traslados[claveIng].cantidad : 0;
      const ajusteNeto = ajustes[claveIng] ? ajustes[claveIng].cantidad : 0;
      const unidad = (consumoEsperado[claveIng] && consumoEsperado[claveIng].unidad) ||
        (cambioFisico[claveIng] && cambioFisico[claveIng].unidad) ||
        (producido[claveIng] && producido[claveIng].unidad) ||
        (consumoProduccion[claveIng] && consumoProduccion[claveIng].unidad) ||
        (traslados[claveIng] && traslados[claveIng].unidad) ||
        (ajustes[claveIng] && ajustes[claveIng].unidad) || '';
      // Fórmula de flujo:
      // cambio físico = compras/ajustes netos + traslados netos + producción salida
      //                 - ventas esperadas - consumo de producción - mermas/desperdicio.
      // implicito es la diferencia que todavía no explica ningún registro operativo.
      const implicito = cambio !== null ? (cambio - ajusteNeto - trasladoNeto - producidoIng + esperado + consumoProd) : null;
      return {
        ingrediente: nombreIng,
        unidad: unidad,
        sin_receta: !!(consumoEsperado[claveIng] && consumoEsperado[claveIng].sin_receta),
        consumo_esperado: Number(esperado.toFixed(3)),
        cambio_fisico: cambio !== null ? Number(cambio.toFixed(3)) : null,
        producido_registrado: producido[claveIng] !== undefined ? Number(producidoIng.toFixed(3)) : null,
        consumo_produccion: consumoProduccion[claveIng] !== undefined ? Number(consumoProd.toFixed(3)) : null,
        ajuste_neto: ajustes[claveIng] !== undefined ? Number(ajusteNeto.toFixed(3)) : null,
        compras: ajustes[claveIng] !== undefined ? Number(ajustes[claveIng].compras.toFixed(3)) : null,
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
    const fechaRecepcion = t.timestamp_recibe ? formatearFecha_(t.timestamp_recibe) : formatearFecha_(t.fecha);
    return fechaRecepcion === fecha && ['Confirmado', 'Resuelto'].indexOf(t.estado) !== -1;
  }).forEach(function (t) {
    // Un traslado resuelto con faltante conserva la cantidad realmente recibida. No usar
    // `||` aquí: cero es un valor válido cuando no llegó nada.
    const clave = claveProducto_(t.producto, indice);
    const recibida = t.cantidad_recibida !== '' && t.cantidad_recibida !== null && t.cantidad_recibida !== undefined
      ? t.cantidad_recibida : t.cantidad_enviada;
    const cantidad = t.sede_origen === sede ? t.cantidad_enviada : (t.sede_destino === sede ? recibida : null);
    if (cantidad === null) return;
    const base = aUnidadBase_(cantidad, t.unidad);
    if (!totales[clave]) totales[clave] = { cantidad: 0, unidad: base.unidad };
    totales[clave].cantidad += t.sede_destino === sede ? base.cantidad : -base.cantidad;
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
