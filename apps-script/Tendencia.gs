/**
 * TENDENCIA DE DÍAS RESTANTES
 * Para un ingrediente, calcula cuántos días de stock quedaban en cada fecha de los últimos
 * `dias` días. No guarda snapshots nuevos: reutiliza obtenerUltimoStockPorIngrediente_ (la
 * misma fuente que usa "Disponible Hoy") recalculando sobre la marcha para cada fecha del rango.
 */

function calcularTendenciaIngrediente_(ingrediente, dias) {
  if (!ingrediente) return { error: 'Falta el ingrediente' };
  dias = Number(dias) || 30;
  const indice = indiceCatalogo_();
  const clave = claveProducto_(ingrediente, indice);

  const fechas = [];
  const hoy = new Date();
  for (let i = dias - 1; i >= 0; i--) {
    fechas.push(formatearFecha_(new Date(hoy.getTime() - i * 24 * 60 * 60 * 1000)));
  }

  const stockPorFecha = fechas.map(function (fecha) {
    const s = obtenerUltimoStockPorIngrediente_(fecha, indice)[clave];
    return s ? s.cantidad : 0;
  });

  // Consumo del día = stock de ayer + producido hoy - stock de hoy (nunca negativo; el día 0
  // del rango no tiene "ayer" dentro del rango, así que queda sin dato de consumo).
  const consumoPorFecha = fechas.map(function (fecha, idx) {
    if (idx === 0) return null;
    const producidoHoy = producidoTotalIngrediente_(fecha, ingrediente, indice);
    return Math.max(0, stockPorFecha[idx - 1] + producidoHoy - stockPorFecha[idx]);
  });

  const serie = fechas.map(function (fecha, idx) {
    const ventana = consumoPorFecha.slice(Math.max(1, idx - 6), idx + 1).filter(function (v) { return v !== null; });
    const promedio = ventana.length ? ventana.reduce(function (a, b) { return a + b; }, 0) / ventana.length : 0;
    return {
      fecha: fecha,
      stock: Number(stockPorFecha[idx].toFixed(3)),
      dias_restantes: promedio > 0 ? Number((stockPorFecha[idx] / promedio).toFixed(1)) : null
    };
  });

  return { ingrediente: ingrediente, serie: serie };
}
