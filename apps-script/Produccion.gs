/**
 * REGISTRO DE PRODUCCIÓN
 * Registra directamente cuánto se preparó de un ítem (ej. "8kg de Costilla Preparada"),
 * en vez de inferirlo restando el conteo de un día contra el anterior. Conciliacion.gs usa
 * este dato cuando existe y cae al cálculo inferido (cambio físico) cuando no hay producción
 * registrada para esa fecha/sede/ítem.
 */

function produccionRegistrar_(items, usuario) {
  if (!items || !items.length) return { ok: false, error: 'No se recibieron items para registrar' };
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    if (!it.fecha || !it.sede || !it.item || !it.unidad) {
      return { ok: false, error: 'Cada producción debe tener fecha, sede, producto y unidad' };
    }
    if (isNaN(Number(it.cantidad)) || Number(it.cantidad) <= 0) {
      return { ok: false, error: 'La cantidad producida debe ser un número mayor que cero' };
    }
  }
  // sedeEscrituraPermitida_ (Code.gs) también deja registrar en Centro de Producción sin importar
  // la sede propia — San Antonio/Capri/Ambas cubren ese sitio en la práctica.
  if (items.some(function (it) { return !sedeEscrituraPermitida_(usuario, it.sede); })) {
    return { ok: false, error: 'No puedes registrar producción para una sede distinta a la tuya (' + usuario.sede + ')' };
  }

  const ahora = new Date();
  items.forEach(function (it) {
    appendRowFromObj_(SHEET_NAMES.PRODUCCIONES, {
      id: Utilities.getUuid(),
      fecha: it.fecha,
      sede: it.sede,
      item: it.item,
      cantidad: Number(it.cantidad),
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
 * Total producido de un ítem en una fecha, en unidad base (g/ml/u).
 * Agrupa por claveProducto_ (Catalogo.gs) para que coincida con cómo se agrupan los conteos y
 * las recetas, sin importar con qué mayúsculas/tildes se haya escrito el ítem cada vez.
 */
function produccionTotalPorItem_(fecha, sede, indice) {
  indice = indice || indiceCatalogo_();
  const rows = produccionListar_(fecha, sede);
  const totales = {};
  rows.forEach(function (r) {
    const base = aUnidadBase_(r.cantidad, r.unidad);
    const clave = claveProducto_(r.item, indice);
    if (!totales[clave]) totales[clave] = { cantidad: 0, unidad: base.unidad };
    if (totales[clave].unidad === base.unidad) totales[clave].cantidad += base.cantidad;
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
