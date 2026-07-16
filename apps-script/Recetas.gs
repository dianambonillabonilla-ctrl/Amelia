/**
 * RECETAS Y UNIDADES
 *
 * Una fila representa una relación producto <- ingrediente. Para un plato, `cantidad` es lo
 * consumido por una venta. Para una preparación, `cantidad` es lo que entra al lote y
 * `rendimiento_producto` lo que sale del lote. Las versiones en borrador se guardan, pero nunca
 * afectan Disponible Hoy ni Conciliación.
 */

function normalizarUnidad_(unidad) {
  const u = normalizar_(unidad).replace(/\./g, '');
  if (['g', 'gr', 'gramo', 'gramos'].indexOf(u) !== -1) return 'g';
  if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].indexOf(u) !== -1) return 'kg';
  if (['ml', 'mililitro', 'mililitros'].indexOf(u) !== -1) return 'ml';
  if (['l', 'lt', 'litro', 'litros'].indexOf(u) !== -1) return 'l';
  if (['u', 'und', 'unidad', 'unidades', 'bolita', 'bolitas', 'porcion', 'porciones'].indexOf(u) !== -1) return 'u';
  return u || '';
}

/** Convierte masa a g, volumen a ml y conteos a u. No convierte entre dimensiones distintas. */
function aUnidadBase_(cantidad, unidad) {
  const u = normalizarUnidad_(unidad);
  const n = Number(cantidad) || 0;
  if (u === 'kg') return { cantidad: n * 1000, unidad: 'g' };
  if (u === 'l') return { cantidad: n * 1000, unidad: 'ml' };
  return { cantidad: n, unidad: u };
}

function recetasListar_(filtros) {
  filtros = filtros || {};
  let filas = leerTabla_(SHEET_NAMES.RECETAS);
  if (filtros.solo_vigentes) filas = recetasVigentes_(filtros.fecha, filtros.sede, filas);
  if (filtros.producto) {
    const p = normalizar_(filtros.producto);
    filas = filas.filter(function (r) { return normalizar_(r.producto) === p; });
  }
  return filas;
}

function recetasVigentes_(fecha, sede, filas) {
  fecha = fecha || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return (filas || leerTabla_(SHEET_NAMES.RECETAS)).filter(function (r) {
    const estado = normalizar_(r.estado || 'activo');
    // 'pendiente' = dato sin confirmar (no automatizar). 'referencia' = dato confirmado pero el
    // motor no puede automatizarlo hoy (ej. requiere saber qué opción eligió el cliente y FUDO no
    // registra ese detalle) — se guarda para consulta/costeo pero tampoco participa en el cálculo.
    // 'revisar' SÍ participa (a diferencia de estas), solo lleva advertencia visible en la interfaz.
    if (estado === 'borrador' || estado === 'inactivo' || estado === 'archivado' ||
      estado === 'pendiente' || estado === 'referencia') return false;
    const sedeReceta = normalizar_(r.sede || 'Ambas');
    if (sede && sede !== 'Ambas' && sedeReceta && sedeReceta !== 'ambas' && sedeReceta !== normalizar_(sede)) return false;
    const desde = r.vigente_desde ? formatearFecha_(r.vigente_desde) : '';
    const hasta = r.vigente_hasta ? formatearFecha_(r.vigente_hasta) : '';
    return (!desde || desde <= fecha) && (!hasta || hasta >= fecha);
  });
}

function recetaGuardar_(item) {
  if (!item || !item.producto || !item.ingrediente) return { ok: false, error: 'Producto e ingrediente son obligatorios' };
  if (!(Number(item.cantidad) > 0)) return { ok: false, error: 'La cantidad debe ser mayor que cero' };
  if (!normalizarUnidad_(item.unidad)) return { ok: false, error: 'La unidad es obligatoria' };

  const sh = sheet_(SHEET_NAMES.RECETAS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const id = item.id || Utilities.getUuid();
  const valores = Object.assign({
    id: id,
    rendimiento_producto: '',
    unidad_rendimiento: '',
    tipo: 'plato',
    fuente: 'Captura en DILANA OS',
    version: 'manual',
    sede: 'Ambas',
    estado: 'activo',
    controla_disponibilidad: true
  }, item, { id: id });

  if (item.id && idCol !== -1) {
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][idCol]) === String(item.id)) {
        headers.forEach(function (h, c) {
          if (valores[h] !== undefined) sh.getRange(r + 1, c + 1).setValue(valores[h]);
        });
        return { ok: true, actualizado: true, id: id };
      }
    }
  }
  appendRowFromObj_(SHEET_NAMES.RECETAS, valores);
  return { ok: true, creado: true, id: id };
}

/**
 * Algunos nombres de venta de FUDO chocan con el nombre del preparado contado. La traducción se
 * aplica solo al buscar una receta de venta; el catálogo de inventario conserva su nombre real.
 */
function claveRecetaVenta_(producto, recetaMap, indice) {
  const directa = claveProducto_(producto, indice);
  if (recetaMap[directa]) return directa;
  const alias = {
    'falafel': 'Falafel (plato)',
    'wafflebonitos': 'Wafflebonitos'
  };
  const destino = alias[normalizar_(producto)];
  return destino ? claveProducto_(destino, indice) : directa;
}
