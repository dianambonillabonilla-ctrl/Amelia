/**
 * REABASTECIMIENTO POR SEDE
 * Responde: "a este ritmo de venta, ¿me alcanza el stock de San Antonio/Capri hasta que llegue
 * el próximo pedido/traslado, o debo pedir ya?"
 *
 * Consumo diario promedio = ventas de FUDO de los últimos `diasVentana` días en esa sede,
 * explotadas a través de la receta vigente (mismo mecanismo que usa Conciliacion.gs para
 * consumo_esperado, incluyendo el autoconsumo 1:1 para productos sin receta como una bebida).
 * Se divide entre TODOS los días de la ventana (no solo los que tuvieron venta), a propósito:
 * un promedio más conservador que no infla el ritmo si el negocio cerró algún día.
 *
 * Días restantes = último stock físico contado en esa sede / consumo diario promedio. Se marca
 * "alerta" cuando los días restantes son menos que DIAS_ESPERA_REABASTECIMIENTO_DEFAULT — el
 * tiempo prudencial que tarda en llegar un pedido nuevo o un traslado desde Centro de Producción.
 * Es un solo número para todo por ahora (más simple); si hace falta distinguir materia prima
 * (proveedor externo) de traslados internos, se puede partir por tipo de producto más adelante.
 *
 * Nota: esta función duplica a propósito la regla de "autoconsumo 1:1 sin receta" de
 * Conciliacion.gs (conciliarComidaPorSede_) en vez de importarla, para no arriesgar esa lógica ya
 * probada. Si esa regla cambia allá, hay que replicarla acá.
 */

const DIAS_ESPERA_REABASTECIMIENTO_DEFAULT = 2;
const DIAS_VENTANA_REABASTECIMIENTO_DEFAULT = 14;

function calcularReabastecimientoPorSede_(sede, fecha, diasVentana) {
  if (!sede || sede === 'Ambas') return { ok: false, error: 'Elige una sede específica (San Antonio o Capri), no "Ambas"' };
  fecha = fecha || formatearFecha_(new Date());
  diasVentana = Number(diasVentana) || DIAS_VENTANA_REABASTECIMIENTO_DEFAULT;

  const indice = indiceCatalogo_();
  const cambioFisico = calcularCambioFisico_(fecha, sede, indice);
  const promedioDiario = consumoPromedioDiarioPorSede_(sede, fecha, diasVentana, indice, cambioFisico);
  const stockActual = obtenerUltimoStockPorIngrediente_(fecha, indice, sede);

  const claves = new Set(Object.keys(promedioDiario).concat(Object.keys(stockActual)));
  const filas = Array.from(claves).map(function (clave) {
    const prom = promedioDiario[clave];
    const stock = stockActual[clave];
    const consumoDiario = prom ? prom.cantidad : 0;
    const cantidadStock = stock ? Number(stock.cantidad) : 0;
    const unidad = (prom && prom.unidad) || (stock && stock.unidad) || '';
    const diasRestantes = consumoDiario > 0 ? cantidadStock / consumoDiario : null;
    return {
      producto: (prom && prom.nombre) || (stock && stock.producto) || clave,
      unidad: unidad,
      stock_actual: Number(cantidadStock.toFixed(3)),
      consumo_diario_promedio: Number(consumoDiario.toFixed(3)),
      dias_restantes: diasRestantes !== null ? Number(diasRestantes.toFixed(1)) : null,
      alerta: diasRestantes !== null && diasRestantes < DIAS_ESPERA_REABASTECIMIENTO_DEFAULT
    };
  }).filter(function (f) { return f.consumo_diario_promedio > 0; }); // sin venta reciente no hay de qué alertar

  filas.sort(function (a, b) {
    if (a.dias_restantes === null) return 1;
    if (b.dias_restantes === null) return -1;
    return a.dias_restantes - b.dias_restantes;
  });

  return {
    ok: true, sede: sede, fecha: fecha, dias_ventana: diasVentana,
    dias_espera_reabastecimiento: DIAS_ESPERA_REABASTECIMIENTO_DEFAULT, filas: filas
  };
}

/** Ventas de FUDO de los últimos `diasVentana` días en `sede`, explotadas por receta y promediadas por día. */
function consumoPromedioDiarioPorSede_(sede, fecha, diasVentana, indice, cambioFisico) {
  indice = indice || indiceCatalogo_();
  cambioFisico = cambioFisico || {};
  const recetaMap = construirRecetaMap_(recetasVigentes_(fecha, sede), indice);

  const fechaFin = new Date(fecha);
  const fechasVentana = {};
  for (let i = 0; i < diasVentana; i++) {
    fechasVentana[formatearFecha_(new Date(fechaFin.getTime() - i * 24 * 60 * 60 * 1000))] = true;
  }

  const ventas = leerTabla_(SHEET_NAMES.VENTAS_FUDO).filter(function (v) {
    return v.sede === sede && v.cancelada !== 'Sí' && v.cancelada !== true && fechasVentana[formatearFecha_(v.creacion)];
  });

  const total = {};
  ventas.forEach(function (v) {
    const claveProd = claveRecetaVenta_(v.producto, recetaMap, indice);
    if (recetaMap[claveProd]) {
      explotarReceta_(claveProd, Number(v.cantidad) || 0, recetaMap, total, indice);
    } else {
      // Sin receta (ej. una bebida vendida 1 a 1) — ver misma regla en Conciliacion.gs.
      const unidadConteo = (cambioFisico[claveProd] && cambioFisico[claveProd].unidad) || 'u';
      if (!total[claveProd]) total[claveProd] = { nombre: nombreCanonico_(v.producto, indice), cantidad: 0, unidad: unidadConteo };
      total[claveProd].cantidad += Number(v.cantidad) || 0;
    }
  });

  const promedio = {};
  Object.keys(total).forEach(function (clave) {
    promedio[clave] = { nombre: total[clave].nombre, unidad: total[clave].unidad, cantidad: total[clave].cantidad / diasVentana };
  });
  return promedio;
}
