/**
 * LIBRO DE MOVIMIENTOS DE INVENTARIO (vista unificada, de solo lectura)
 * Primera pieza de la "Fase 1" del modelo de arquitectura acordado (docs/modelo-inventario.md,
 * sección 5): hoy Producciones, Traslados y Ajustes_Inventario son hojas separadas que cada
 * pantalla combina a su manera (ver DisponibleHoy.gs, Conciliacion.gs). Este archivo NO migra esas
 * hojas ni cambia cómo escriben — solo agrega una función que las LEE a todas y las normaliza a un
 * único formato de movimiento con signo, para poder mostrar/auditar "el libro" completo en un solo
 * lugar y tener UNA fórmula reusable de inventario teórico.
 *
 * Deliberadamente NO incluye "Consumo por venta" todavía: eso requiere explotar la receta vigente
 * de cada venta de Fudo (ver construirRecetaMap_/cantidadDisponibleDetallada_ en DisponibleHoy.gs),
 * que ya existe y está probado — duplicarlo aquí sin necesidad real sería el tipo de trabajo extra
 * que este proyecto pide evitar. Cuando se decida consolidar Conciliacion.gs/DisponibleHoy.gs sobre
 * este libro (pendiente, ver docs/modelo-inventario.md), esa lógica se conecta aquí, no se copia.
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
    'Ajuste operativo': 'Ajuste autorizado'
  };
  return leerTabla_(SHEET_NAMES.AJUSTES_INVENTARIO).map(function (a) {
    const tipoMovimiento = TIPO_A_MOVIMIENTO[a.tipo] || 'Ajuste autorizado';
    const esSalida = tipoMovimiento === 'Merma en sede';
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

/** Producciones -> "Entrada por producción" (solo el producto terminado; ver limitación arriba). */
function movimientosDesdeProduccion_() {
  return leerTabla_(SHEET_NAMES.PRODUCCIONES).map(function (p) {
    return {
      fecha: formatearFecha_(p.fecha),
      producto: p.item,
      cantidad: Math.abs(Number(p.cantidad) || 0),
      unidad: p.unidad,
      sede: p.sede,
      ubicacion_origen: '',
      ubicacion_destino: movimientoUbicacion_(p.sede, ''),
      tipo_movimiento: 'Entrada por producción',
      usuario: p.usuario,
      documento_relacionado: p.id,
      estado: 'Registrado'
    };
  });
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

/**
 * Libro completo, normalizado y filtrable — filtros = { fecha_desde, fecha_hasta, sede, producto,
 * indice (índice de Catalogo_Alias, opcional) }. `producto` filtra por claveProducto_ (mismo
 * agrupamiento que usan Conteos/Recetas/Producción, sin importar mayúsculas/tildes/alias).
 */
function movimientosInventarioListar_(filtros) {
  filtros = filtros || {};
  const indice = filtros.indice || indiceCatalogo_();
  let movimientos = [].concat(
    movimientosDesdeAjustes_(),
    movimientosDesdeProduccion_(),
    movimientosDesdeTraslados_()
  );
  if (filtros.fecha_desde) movimientos = movimientos.filter(function (m) { return m.fecha >= filtros.fecha_desde; });
  if (filtros.fecha_hasta) movimientos = movimientos.filter(function (m) { return m.fecha <= filtros.fecha_hasta; });
  if (filtros.sede && filtros.sede !== 'Ambas') movimientos = movimientos.filter(function (m) { return m.sede === filtros.sede; });
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
function calcularInventarioTeorico_(producto, sede, fechaCorte, indiceOpcional) {
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
    indice: indice
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
