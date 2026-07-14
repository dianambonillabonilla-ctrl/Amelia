/**
 * REGISTRO DE PRODUCCIÓN
 * Registra directamente cuánto se preparó de un ítem (ej. "8kg de Costilla Preparada"),
 * en vez de inferirlo restando el conteo de un día contra el anterior. Conciliacion.gs usa
 * este dato cuando existe y cae al cálculo inferido (cambio físico) cuando no hay producción
 * registrada para esa fecha/sede/ítem.
 */

function produccionRegistrar_(items, usuario) {
  if (!items || !items.length) return { ok: false, error: 'No se recibieron items para registrar' };
  if (usuario.sede !== 'Ambas' && items.some(function (it) { return it.sede !== usuario.sede; })) {
    return { ok: false, error: 'No puedes registrar producción para una sede distinta a la tuya (' + usuario.sede + ')' };
  }

  const ahora = new Date();
  items.forEach(function (it) {
    appendRowFromObj_(SHEET_NAMES.PRODUCCIONES, {
      id: Utilities.getUuid(),
      fecha: it.fecha,
      sede: it.sede,
      item: it.item,
      cantidad: it.cantidad,
      unidad: it.unidad,
      usuario: usuario.nombre,
      timestamp: ahora
    });
  });
  return { ok: true, registrados: items.length };
}

function produccionListar_(fecha, sede) {
  let rows = leerTabla_(SHEET_NAMES.PRODUCCIONES);
  if (fecha) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) === fecha; });
  if (sede) rows = rows.filter(function (r) { return r.sede === sede; });
  return rows;
}

/**
 * Total producido de un ítem en una fecha, sumando todas las sedes (o solo una si se indica).
 * Agrupa por claveProducto_ (Catalogo.gs) para que coincida con cómo se agrupan los conteos y
 * las recetas, sin importar con qué mayúsculas/tildes se haya escrito el ítem cada vez.
 */
function produccionTotalPorItem_(fecha, sede, indice) {
  indice = indice || indiceCatalogo_();
  const rows = produccionListar_(fecha, sede);
  const totales = {};
  rows.forEach(function (r) {
    const unidadEsGramos = String(r.unidad).toLowerCase() === 'g';
    const cantidadKg = unidadEsGramos ? Number(r.cantidad) / 1000 : Number(r.cantidad);
    const clave = claveProducto_(r.item, indice);
    totales[clave] = (totales[clave] || 0) + cantidadKg;
  });
  return totales;
}

/** Cuánto se produjo de un ítem específico en una fecha, en las unidades originales del conteo (no kg). */
function producidoTotalIngrediente_(fecha, ingrediente, indice) {
  indice = indice || indiceCatalogo_();
  const clave = claveProducto_(ingrediente, indice);
  return leerTabla_(SHEET_NAMES.PRODUCCIONES)
    .filter(function (r) { return formatearFecha_(r.fecha) === fecha && claveProducto_(r.item, indice) === clave; })
    .reduce(function (acc, r) { return acc + (Number(r.cantidad) || 0); }, 0);
}
