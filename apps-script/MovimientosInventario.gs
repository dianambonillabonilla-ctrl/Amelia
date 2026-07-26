/**
 * LIBRO DE MOVIMIENTOS DE INVENTARIO (vista unificada, de solo lectura)
 * Primera pieza de la "Fase 1" del modelo de arquitectura acordado (docs/modelo-inventario.md,
 * sección 5): hoy Producciones, Traslados y Ajustes_Inventario son hojas separadas que cada
 * pantalla combina a su manera (ver DisponibleHoy.gs, Conciliacion.gs). Este archivo NO migra esas
 * hojas ni cambia cómo escriben — solo agrega una función que las LEE a todas y las normaliza a un
 * único formato de movimiento con signo, para poder mostrar/auditar "el libro" completo en un solo
 * lugar y tener UNA fórmula reusable de inventario teórico.
 *
 * "Consumo por venta" SÍ está (jul 2026), pero como función APARTE — movimientosDesdeVentas_(fecha,
 * sede, indice) — no integrada a movimientosInventarioListar_/calcularInventarioTeorico_ de arriba.
 * Motivo: toda la explosión de receta en este repo (Conciliacion.gs, DisponibleHoy.gs) opera por UN
 * día y UNA sede a la vez (recetasVigentes_ necesita una fecha para elegir la versión vigente); las
 * demás fuentes de este archivo se combinan libremente en cualquier rango de fechas. Mezclar ambos
 * patrones en una sola función habría significado reconstruir el mapa de recetas una vez por cada
 * combinación fecha×sede de un rango, quedando lento y confuso sin necesidad real. Reutiliza
 * construirRecetaMap_/explotarReceta_/claveRecetaVenta_ (DisponibleHoy.gs/Recetas.gs) — no se
 * duplica esa lógica aquí.
 *
 * "Consumo de producción" y "Merma de producción" SÍ están (jul 2026): Producciones ahora admite
 * insumo_producto/insumo_cantidad/insumo_unidad/merma_cantidad opcionales (ver produccionRegistrar_
 * en Produccion.gs). La merma NO resta de un producto real — ya queda reflejada en la diferencia
 * entre el insumo consumido y lo efectivamente producido; se registra bajo un nombre de producto
 * sintético solo para verse en el libro/reportes, sin arriesgar un doble descuento (ver el
 * comentario en movimientosDesdeProduccion_).
 *
 * Tampoco reemplaza el cálculo más fino que ya usa DisponibleHoy.gs (que compara HORA exacta contra
 * el conteo cuando ambos lados la tienen, ver eventoCubiertoPorConteo_) — calcularInventarioTeorico_
 * de este archivo compara por FECHA solamente (más simple, para una vista de auditoría general, no
 * para la pantalla operativa "Disponible Hoy", que sigue con su propia lógica ya probada).
 */

const MOVIMIENTO_TIPOS_SIGNO_ = {
  'Compra recibida': 1,
  'Entrada por producción': 1,
  'Consumo de producción': -1,
  'Merma de producción': -1,
  'Traslado enviado': -1,
  'Traslado recibido': 1,
  'Consumo por venta': -1,
  'Cancelación de venta': 1,
  'Merma en sede': -1,
  'Consumo interno': -1,
  'Cortesía': -1,
  'Devolución': 1,
  'Ajuste autorizado': 1,
  'Diferencia de conteo': 1
};

function movimientoUbicacion_(sede, punto) {
  return punto ? sede + ' / ' + punto : sede;
}

/** Ajustes_Inventario -> movimientos (Compra recibida / Merma en sede / Ajuste autorizado). */
function movimientosDesdeAjustes_() {
  const TIPO_A_MOVIMIENTO = {
    'Compra cruda': 'Compra recibida',
    'Merma / desperdicio': 'Merma en sede',
    'Ajuste operativo': 'Ajuste autorizado',
    'Consumo interno': 'Consumo interno'
  };
  return leerTabla_(SHEET_NAMES.AJUSTES_INVENTARIO).map(function (a) {
    const tipoMovimiento = TIPO_A_MOVIMIENTO[a.tipo] || 'Ajuste autorizado';
    const esSalida = tipoMovimiento === 'Merma en sede' || tipoMovimiento === 'Consumo interno';
    return {
      fecha: formatearFecha_(a.fecha),
      producto: a.producto,
      cantidad: MOVIMIENTO_TIPOS_SIGNO_[tipoMovimiento] * Math.abs(Number(a.cantidad) || 0),
      unidad: a.unidad,
      sede: a.sede,
      ubicacion_origen: esSalida ? movimientoUbicacion_(a.sede, a.punto) : '',
      ubicacion_destino: esSalida ? '' : movimientoUbicacion_(a.sede, a.punto),
      tipo_movimiento: tipoMovimiento,
      usuario: a.usuario,
      documento_relacionado: a.id,
      estado: a.avalado ? 'Avalado' : 'Registrado'
    };
  });
}

/**
 * Producciones -> "Entrada por producción" (siempre, el producto terminado) + "Consumo de
 * producción" y "Merma de producción" (solo si esa fila trae insumo/merma registrados — son
 * opcionales, ver produccionRegistrar_ en Produccion.gs). Antes de jul 2026, Producciones solo
 * guardaba el terminado, así que una fila vieja sin insumo/merma sigue generando UN solo movimiento,
 * igual que antes.
 */
function movimientosDesdeProduccion_() {
  const movimientos = [];
  leerTabla_(SHEET_NAMES.PRODUCCIONES).forEach(function (p) {
    movimientos.push({
      fecha: formatearFecha_(p.fecha),
      producto: p.item,
      cantidad: Math.abs(Number(p.cantidad) || 0),
      unidad: p.unidad,
      sede: p.sede,
      ubicacion_origen: '',
      ubicacion_destino: movimientoUbicacion_(p.sede, 'Productos terminados'),
      tipo_movimiento: 'Entrada por producción',
      usuario: p.usuario,
      documento_relacionado: p.id,
      estado: 'Registrado'
    });
    if (p.insumo_producto && p.insumo_cantidad !== '' && p.insumo_cantidad !== undefined && p.insumo_cantidad !== null) {
      movimientos.push({
        fecha: formatearFecha_(p.fecha),
        producto: p.insumo_producto,
        cantidad: -Math.abs(Number(p.insumo_cantidad) || 0),
        unidad: p.insumo_unidad,
        sede: p.sede,
        ubicacion_origen: movimientoUbicacion_(p.sede, 'Materia prima cruda'),
        ubicacion_destino: '',
        tipo_movimiento: 'Consumo de producción',
        usuario: p.usuario,
        documento_relacionado: p.id,
        estado: 'Registrado'
      });
    }
    if (p.merma_cantidad !== '' && p.merma_cantidad !== undefined && p.merma_cantidad !== null && Number(p.merma_cantidad) > 0) {
      // OJO: la merma NO se resta de un producto real (ni el insumo crudo ni el terminado) — ya
      // quedó reflejada en la diferencia entre "Consumo de producción" (-insumo_cantidad, TODO lo
      // que entró al lote) y "Entrada por producción" (+cantidad, solo lo que sí se aprovechó).
      // Restarla de nuevo aquí sobre un producto real sería contarla dos veces. Se registra bajo un
      // nombre de producto sintético (que nunca calza con ningún producto real del catálogo) solo
      // para que aparezca en el libro/reportes de merma — calcularInventarioTeorico_ de un producto
      // real jamás la suma, porque claveProducto_ nunca la va a emparejar con ese producto.
      movimientos.push({
        fecha: formatearFecha_(p.fecha),
        producto: (p.insumo_producto || p.item) + ' — merma de producción',
        cantidad: -Math.abs(Number(p.merma_cantidad) || 0),
        unidad: p.merma_unidad || p.unidad,
        sede: p.sede,
        ubicacion_origen: movimientoUbicacion_(p.sede, 'Mermas de producción'),
        ubicacion_destino: '',
        tipo_movimiento: 'Merma de producción',
        usuario: p.usuario,
        documento_relacionado: p.id,
        estado: 'Registrado'
      });
    }
  });
  return movimientos;
}

/** Traslados -> "Traslado enviado" (siempre) + "Traslado recibido" (solo si ya llegó de verdad). */
function movimientosDesdeTraslados_() {
  const movimientos = [];
  leerTabla_(SHEET_NAMES.TRASLADOS).forEach(function (t) {
    movimientos.push({
      fecha: formatearFecha_(t.fecha),
      producto: t.producto,
      cantidad: -Math.abs(Number(t.cantidad_enviada) || 0),
      unidad: t.unidad,
      sede: t.sede_origen,
      ubicacion_origen: movimientoUbicacion_(t.sede_origen, t.punto_origen),
      ubicacion_destino: movimientoUbicacion_(t.sede_destino, t.punto_destino),
      tipo_movimiento: 'Traslado enviado',
      usuario: t.usuario_envia,
      documento_relacionado: t.id,
      estado: t.estado
    });
    if (['Confirmado', 'Resuelto'].indexOf(t.estado) !== -1) {
      const cantidadRecibida = t.cantidad_recibida !== '' && t.cantidad_recibida !== null && t.cantidad_recibida !== undefined
        ? Number(t.cantidad_recibida) : Number(t.cantidad_enviada);
      movimientos.push({
        fecha: formatearFecha_(t.timestamp_recibe || t.fecha),
        producto: t.producto,
        cantidad: Math.abs(cantidadRecibida || 0),
        unidad: t.unidad,
        sede: t.sede_destino,
        ubicacion_origen: movimientoUbicacion_(t.sede_origen, t.punto_origen),
        ubicacion_destino: movimientoUbicacion_(t.sede_destino, t.punto_destino),
        tipo_movimiento: 'Traslado recibido',
        usuario: t.usuario_recibe,
        documento_relacionado: t.id,
        estado: t.estado
      });
    }
  });
  return movimientos;
}

function fechasEnRangoMovimientos_(fechaDesde, fechaHasta) {
  if (!fechaDesde || !fechaHasta) return [];
  const fechas = [];
  const d = new Date(fechaDesde + 'T12:00:00');
  const fin = new Date(fechaHasta + 'T12:00:00');
  while (d <= fin) {
    fechas.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return fechas;
}

/** Clave de memoización para consumo/cancelación por venta — una sola explosión de receta por (tipo, sede, día). */
function movimientosVentasCacheClave_(tipo, sede, fecha) {
  return String(tipo || 'ventas') + '|' + sede + '|' + fecha;
}

/**
 * Guarda `resultado` en el caché de consumo por venta (si hay caché) y lo devuelve, para poder
 * memoizar también las respuestas vacías en una sola expresión de `return`.
 */
function movimientosVentasMemoizar_(cacheVentas, cacheClave, resultado) {
  if (cacheVentas && cacheClave) cacheVentas[cacheClave] = resultado;
  return resultado;
}

/**
 * Días con ventas dentro de [fechaDesde, fechaHasta] (ambos inclusive) en una sede — reemplaza el
 * recorrido día por día del calendario, que pedía las tablas de Fudo completas una vez por día
 * aunque ese día no hubiera vendido nada. Sin FudoLectores.gs cargado (pruebas que usan este
 * archivo suelto) cae al rango de calendario de siempre.
 */
function fechasConVentasParaRango_(sede, fechaDesde, fechaHasta, cache) {
  const desde = fechaDesde || fechaHasta;
  const hasta = fechaHasta || fechaDesde;
  if (!desde || !hasta) return [];
  if (typeof fudoFechasConVentas_ !== 'function') return fechasEnRangoMovimientos_(desde, hasta);
  return fudoFechasConVentas_(sede, cache).filter(function (f) {
    return f >= desde && f <= hasta;
  });
}

/**
 * Libro completo, normalizado y filtrable — filtros = { fecha_desde, fecha_hasta, sede, producto,
 * punto, incluir_consumo_ventas, incluir_cancelaciones_ventas, indice (índice de Catalogo_Alias, opcional) }.
 */
function movimientosInventarioListar_(filtros) {
  if (typeof conCacheDeTablas_ === 'function') {
    return conCacheDeTablas_(function () { return movimientosInventarioListarSinCache_(filtros); });
  }
  return movimientosInventarioListarSinCache_(filtros);
}

function movimientosInventarioListarSinCache_(filtros) {
  filtros = filtros || {};
  const indice = filtros.indice || indiceCatalogo_();
  const cacheVentas = filtros.cache_ventas || {};
  let movimientos = [].concat(
    movimientosDesdeAjustes_(),
    movimientosDesdeProduccion_(),
    movimientosDesdeTraslados_()
  );
  if (filtros.incluir_consumo_ventas && filtros.sede && filtros.sede !== 'Ambas') {
    fechasConVentasParaRango_(filtros.sede, filtros.fecha_desde, filtros.fecha_hasta, cacheVentas).forEach(function (fecha) {
      movimientos.push.apply(movimientos, movimientosDesdeVentas_(fecha, filtros.sede, indice, cacheVentas));
    });
  }
  if (filtros.incluir_cancelaciones_ventas && filtros.sede && filtros.sede !== 'Ambas') {
    fechasConVentasParaRango_(filtros.sede, filtros.fecha_desde, filtros.fecha_hasta, cacheVentas).forEach(function (fecha) {
      movimientos.push.apply(movimientos, movimientosDesdeCancelaciones_(fecha, filtros.sede, indice, cacheVentas));
    });
  }
  if (filtros.fecha_desde) movimientos = movimientos.filter(function (m) { return m.fecha >= filtros.fecha_desde; });
  if (filtros.fecha_hasta) movimientos = movimientos.filter(function (m) { return m.fecha <= filtros.fecha_hasta; });
  if (filtros.sede && filtros.sede !== 'Ambas') movimientos = movimientos.filter(function (m) { return m.sede === filtros.sede; });
  if (filtros.punto) {
    const puntoNorm = normalizar_(filtros.punto);
    movimientos = movimientos.filter(function (m) {
      const orig = normalizar_(m.ubicacion_origen || '');
      const dest = normalizar_(m.ubicacion_destino || '');
      return orig.indexOf(puntoNorm) !== -1 || dest.indexOf(puntoNorm) !== -1;
    });
  }
  if (filtros.producto) {
    const clave = claveProducto_(filtros.producto, indice);
    movimientos = movimientos.filter(function (m) { return claveProducto_(m.producto, indice) === clave; });
  }
  return movimientos.sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; });
}

/**
 * Inventario teórico de UN producto en UNA sede, a la fecha de corte (inclusive):
 *   último conteo físico (en/antes de fechaCorte) + movimientos posteriores a esa fecha, con signo.
 * Sin conteo previo, arranca en 0 y suma todos los movimientos hasta fechaCorte (mismo criterio ya
 * usado en DisponibleHoy.gs para un producto nunca contado).
 */
function calcularInventarioTeorico_(producto, sede, fechaCorte, indiceOpcional, opciones) {
  opciones = opciones || {};
  const indice = indiceOpcional || indiceCatalogo_();
  const clave = claveProducto_(producto, indice);
  const conteos = leerTabla_(SHEET_NAMES.CONTEOS)
    .filter(function (c) { return c.sede === sede && claveProducto_(c.producto, indice) === clave && formatearFecha_(c.fecha) <= fechaCorte; })
    .sort(function (a, b) { return formatearFecha_(b.fecha) < formatearFecha_(a.fecha) ? -1 : 1; });
  const ultimoConteo = conteos[0] || null;

  let cantidad = 0;
  let unidad = ultimoConteo ? ultimoConteo.unidad : '';
  if (ultimoConteo) {
    const base = aUnidadBase_(ultimoConteo.cantidad, ultimoConteo.unidad);
    cantidad = base.cantidad;
    unidad = base.unidad;
  }

  const movimientos = movimientosInventarioListar_({
    fecha_desde: ultimoConteo ? formatearFecha_(ultimoConteo.fecha) : null,
    fecha_hasta: fechaCorte,
    sede: sede,
    producto: producto,
    indice: indice,
    incluir_consumo_ventas: !!opciones.incluir_consumo_ventas,
    incluir_cancelaciones_ventas: !!opciones.incluir_cancelaciones_ventas,
    cache_ventas: opciones.cache_ventas
  }).filter(function (m) {
    // El día EXACTO del último conteo ya quedó representado por el conteo mismo — solo se suman
    // movimientos de días posteriores (ver limitación de "por fecha, no por hora" en el encabezado).
    return !ultimoConteo || m.fecha > formatearFecha_(ultimoConteo.fecha);
  });
  movimientos.forEach(function (m) {
    const base = aUnidadBase_(Math.abs(m.cantidad), m.unidad);
    if (!unidad) unidad = base.unidad;
    if (base.unidad !== unidad) return; // unidad incompatible con el conteo: se ignora, no se mezcla
    cantidad += m.cantidad < 0 ? -base.cantidad : base.cantidad;
  });

  return { cantidad: cantidad, unidad: unidad, ultimo_conteo: ultimoConteo };
}

/**
 * Inventario teórico de VARIOS productos en UNA sede a la fecha de corte — envoltorio batch de
 * calcularInventarioTeorico_ para Conciliación y otras vistas que ya tienen la lista de nombres.
 */
function inventarioTeoricoResumen_(fecha, sede, productos, indiceOpcional, opciones) {
  if (typeof conCacheDeTablas_ === 'function') {
    return conCacheDeTablas_(function () {
      return inventarioTeoricoResumenSinCache_(fecha, sede, productos, indiceOpcional, opciones);
    });
  }
  return inventarioTeoricoResumenSinCache_(fecha, sede, productos, indiceOpcional, opciones);
}

function inventarioTeoricoResumenSinCache_(fecha, sede, productos, indiceOpcional, opciones) {
  if (!fecha || !sede) return { ok: false, error: 'Falta la fecha o la sede' };
  const indice = indiceOpcional || indiceCatalogo_();
  const lista = (productos || []).filter(function (p) { return p; });
  const cacheVentas = {};
  const opcionesConCache = Object.assign({}, opciones || {}, { cache_ventas: cacheVentas });
  const filas = lista.map(function (producto) {
    const teorico = calcularInventarioTeorico_(producto, sede, fecha, indice, opcionesConCache);
    return {
      producto: producto,
      cantidad: Number((Number(teorico.cantidad) || 0).toFixed(3)),
      unidad: teorico.unidad || '',
      ultimo_conteo_fecha: teorico.ultimo_conteo ? formatearFecha_(teorico.ultimo_conteo.fecha) : null
    };
  });
  filas.sort(function (a, b) { return String(a.producto).localeCompare(String(b.producto)); });
  return { ok: true, filas: filas };
}

/**
 * "Consumo por venta" de UN día en UNA sede: para cada venta de Fudo no cancelada, explota su
 * receta vigente (o se autoconsume 1:1 si no tiene receta, ej. una bebida) y devuelve un movimiento
 * negativo por cada ingrediente/preparado consumido — mismo criterio EXACTO que usa
 * conciliarComidaPorSede_ (Conciliacion.gs), reutilizando sus mismas piezas
 * (construirRecetaMap_/explotarReceta_/claveRecetaVenta_) para no arriesgar que los dos cálculos se
 * desincronicen con el tiempo (ver comentario de claveRecetaVenta_ en Recetas.gs sobre el bug real
 * que causó justo eso una vez).
 *
 * Simplificación consciente frente a Conciliacion.gs: un producto sin receta se autoconsume en
 * unidad 'u' siempre (Conciliacion.gs intenta adivinar la unidad real del conteo físico vía
 * calcularCambioFisico_, que es más específico de esa pantalla) — suficiente para un movimiento de
 * auditoría, no para la comparación fina de Conciliación.
 */
function movimientosDesdeVentas_(fecha, sede, indiceOpcional, cacheVentas) {
  if (!fecha || !sede) return [];
  const cacheClave = cacheVentas ? movimientosVentasCacheClave_('ventas', sede, fecha) : '';
  if (cacheVentas && cacheVentas[cacheClave]) return cacheVentas[cacheClave];

  const indice = indiceOpcional || indiceCatalogo_();
  const ventasDelDia = (typeof ventasFudoLineasParaConsumo_ === 'function'
    ? ventasFudoLineasParaConsumo_(fecha, { sin_canceladas: true, sede: sede })
    : typeof ventasFudoLineasParaFecha_ === 'function'
      ? ventasFudoLineasParaFecha_(fecha, { sin_canceladas: true, sede: sede })
      : { lineas: leerTabla_(SHEET_NAMES.VENTAS_FUDO).filter(function (v) {
        return formatearFecha_(v.creacion) === fecha && v.sede === sede && !ventaCancelada_(v);
      }) }).lineas;
  // Un día sin ventas también se memoiza: si no, el caché no servía de nada justo en los días
  // vacíos, que son la mayoría cuando se recorre un rango largo, y cada uno volvía a pedir las
  // tablas de Fudo completas.
  if (!ventasDelDia.length) return movimientosVentasMemoizar_(cacheVentas, cacheClave, []);

  const recetaMap = construirRecetaMap_(recetasVigentes_(fecha, sede), indice);
  const consumoEsperado = {};
  ventasDelDia.forEach(function (v) {
    const claveProd = claveRecetaVenta_(v.producto, recetaMap, indice);
    if (recetaMap[claveProd]) {
      explotarReceta_(claveProd, Number(v.cantidad) || 0, recetaMap, consumoEsperado, indice);
    } else {
      if (!consumoEsperado[claveProd]) {
        consumoEsperado[claveProd] = { nombre: nombreCanonico_(v.producto, indice), cantidad: 0, unidad: 'u' };
      }
      consumoEsperado[claveProd].cantidad += Number(v.cantidad) || 0;
    }
  });

  const resultado = Object.keys(consumoEsperado).map(function (clave) {
    const c = consumoEsperado[clave];
    return {
      fecha: fecha,
      producto: c.nombre,
      cantidad: -Math.abs(c.cantidad),
      unidad: c.unidad,
      sede: sede,
      ubicacion_origen: movimientoUbicacion_(sede, ''),
      ubicacion_destino: '',
      tipo_movimiento: 'Consumo por venta',
      usuario: '',
      documento_relacionado: '',
      estado: 'Registrado'
    };
  });
  if (cacheVentas) cacheVentas[cacheClave] = resultado;
  return resultado;
}

/**
 * Reversa de consumo por venta cancelada — misma explosión de receta que movimientosDesdeVentas_,
 * pero solo líneas canceladas y con signo positivo (devuelve al inventario teórico).
 */
function movimientosDesdeCancelaciones_(fecha, sede, indiceOpcional, cacheVentas) {
  if (!fecha || !sede) return [];
  const cacheClave = cacheVentas ? movimientosVentasCacheClave_('cancelaciones', sede, fecha) : '';
  if (cacheVentas && cacheVentas[cacheClave]) return cacheVentas[cacheClave];

  const indice = indiceOpcional || indiceCatalogo_();
  const canceladas = (typeof ventasFudoLineasCanceladasParaFecha_ === 'function'
    ? ventasFudoLineasCanceladasParaFecha_(fecha, { sede: sede })
    : typeof ventasFudoLineasParaFecha_ === 'function'
      ? ventasFudoLineasParaFecha_(fecha, { sede: sede, solo_canceladas: true, sin_canceladas: false })
      : { lineas: leerTabla_(SHEET_NAMES.VENTAS_FUDO).filter(function (v) {
        return formatearFecha_(v.creacion) === fecha && v.sede === sede && ventaCancelada_(v);
      }) }).lineas;
  if (!canceladas.length) return movimientosVentasMemoizar_(cacheVentas, cacheClave, []);

  const recetaMap = construirRecetaMap_(recetasVigentes_(fecha, sede), indice);
  const consumoEsperado = {};
  canceladas.forEach(function (v) {
    const claveProd = claveRecetaVenta_(v.producto, recetaMap, indice);
    if (recetaMap[claveProd]) {
      explotarReceta_(claveProd, Number(v.cantidad) || 0, recetaMap, consumoEsperado, indice);
    } else {
      if (!consumoEsperado[claveProd]) {
        consumoEsperado[claveProd] = { nombre: nombreCanonico_(v.producto, indice), cantidad: 0, unidad: 'u' };
      }
      consumoEsperado[claveProd].cantidad += Number(v.cantidad) || 0;
    }
  });

  const resultado = Object.keys(consumoEsperado).map(function (clave) {
    const c = consumoEsperado[clave];
    return {
      fecha: fecha,
      producto: c.nombre,
      cantidad: Math.abs(c.cantidad),
      unidad: c.unidad,
      sede: sede,
      ubicacion_origen: '',
      ubicacion_destino: movimientoUbicacion_(sede, ''),
      tipo_movimiento: 'Cancelación de venta',
      usuario: '',
      documento_relacionado: '',
      estado: 'Registrado'
    };
  });
  if (cacheVentas) cacheVentas[cacheClave] = resultado;
  return resultado;
}

/**
 * Resumen de movimientos por producto en un punto/ubicación — entradas, salidas y neto.
 */
function inventarioUbicacionResumen_(fechaDesde, fechaHasta, sede, punto, opciones) {
  opciones = opciones || {};
  if (!fechaDesde || !fechaHasta || !sede || !punto) {
    return { ok: false, error: 'Faltan fecha_desde, fecha_hasta, sede o punto' };
  }
  const filtros = {
    fecha_desde: fechaDesde,
    fecha_hasta: fechaHasta,
    sede: sede,
    punto: punto,
    incluir_consumo_ventas: !!opciones.incluir_consumo_ventas,
    incluir_cancelaciones_ventas: !!opciones.incluir_cancelaciones_ventas
  };
  const movimientos = movimientosInventarioListar_(filtros);
  const porProducto = {};
  movimientos.forEach(function (m) {
    const clave = m.producto;
    if (!porProducto[clave]) {
      porProducto[clave] = { producto: m.producto, unidad: m.unidad, entradas: 0, salidas: 0, neto: 0 };
    }
    const cant = Number(m.cantidad) || 0;
    if (cant > 0) porProducto[clave].entradas += cant;
    else porProducto[clave].salidas += Math.abs(cant);
    porProducto[clave].neto += cant;
  });
  const filas = Object.keys(porProducto).map(function (k) {
    const f = porProducto[k];
    return {
      producto: f.producto,
      unidad: f.unidad,
      entradas: Number(f.entradas.toFixed(3)),
      salidas: Number(f.salidas.toFixed(3)),
      neto: Number(f.neto.toFixed(3))
    };
  }).sort(function (a, b) { return String(a.producto).localeCompare(String(b.producto)); });
  return { ok: true, sede: sede, punto: punto, movimientos: movimientos.length, filas: filas };
}

/**
 * Compara inventario teórico vs. físico contado en UN día y UNA sede — para el resumen de cierre
 * de turno (Turnos.gs) y la vista del libro. Solo considera productos que tuvieron al menos un
 * conteo ese día en esa sede (suma todos los puntos de conteo del mismo producto).
 */
function resumenDiferenciasInventarioFechaSede_(fecha, sede, indiceOpcional) {
  if (typeof conCacheDeTablas_ === 'function') {
    return conCacheDeTablas_(function () {
      return resumenDiferenciasInventarioFechaSedeSinCache_(fecha, sede, indiceOpcional);
    });
  }
  return resumenDiferenciasInventarioFechaSedeSinCache_(fecha, sede, indiceOpcional);
}

function resumenDiferenciasInventarioFechaSedeSinCache_(fecha, sede, indiceOpcional) {
  if (!fecha || !sede) return { ok: false, error: 'Falta la fecha o la sede' };
  const indice = indiceOpcional || indiceCatalogo_();
  const conteosDelDia = conteoListar_(fecha, sede);
  const porProducto = {};

  conteosDelDia.forEach(function (c) {
    const clave = claveProducto_(c.producto, indice);
    if (!porProducto[clave]) {
      porProducto[clave] = {
        producto: nombreCanonico_(c.producto, indice),
        contado: 0,
        unidad: ''
      };
    }
    const base = aUnidadBase_(c.cantidad, c.unidad);
    if (!porProducto[clave].unidad) porProducto[clave].unidad = base.unidad;
    if (base.unidad === porProducto[clave].unidad) {
      porProducto[clave].contado += base.cantidad;
    } else {
      porProducto[clave].contado += Number(c.cantidad) || 0;
      if (!porProducto[clave].unidad) porProducto[clave].unidad = c.unidad;
    }
  });

  const diferencias = [];
  let productosConDiferencia = 0;
  const cacheVentas = {};
  Object.keys(porProducto).forEach(function (clave) {
    const item = porProducto[clave];
    const teorico = calcularInventarioTeorico_(item.producto, sede, fecha, indice, { cache_ventas: cacheVentas });
    const contado = item.contado;
    const teoricoCant = Number(teorico.cantidad) || 0;
    const diff = contado - teoricoCant;
    if (Math.abs(diff) > 0.001) productosConDiferencia++;
    diferencias.push({
      producto: item.producto,
      contado: contado,
      teorico: teoricoCant,
      diferencia: diff,
      unidad: teorico.unidad || item.unidad || ''
    });
  });

  diferencias.sort(function (a, b) { return Math.abs(b.diferencia) - Math.abs(a.diferencia); });

  return {
    ok: true,
    productos_contados: Object.keys(porProducto).length,
    productos_con_diferencia: productosConDiferencia,
    diferencias: diferencias
  };
}
