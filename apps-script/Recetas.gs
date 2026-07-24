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

// Estados de receta que NO participan en Disponible Hoy ni Conciliación. 'pendiente' = dato sin
// confirmar (no automatizar). 'referencia' = dato confirmado pero el motor no puede automatizarlo
// hoy (ej. requiere saber qué opción eligió el cliente y FUDO no registra ese detalle) — se guarda
// para consulta/costeo pero tampoco participa en el cálculo. 'revisar' SÍ participa (a diferencia
// de estas), solo lleva advertencia visible en la interfaz. Factorizado aquí para que
// recetasVigentes_, platosFudoSinReceta_ y los diagnósticos de Recetas (Diagnostico.gs) usen
// exactamente la misma regla — antes cada uno repetía su propia lista de estados por separado, que
// fue justo la causa de un bug real cuando se desincronizaron.
const ESTADOS_RECETA_NO_VIGENTE_ = ['borrador', 'inactivo', 'archivado', 'pendiente', 'referencia'];
function recetaEstadoVigente_(estado) {
  return ESTADOS_RECETA_NO_VIGENTE_.indexOf(normalizar_(estado || 'activo')) === -1;
}

function recetasVigentes_(fecha, sede, filas) {
  fecha = fecha || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return (filas || leerTabla_(SHEET_NAMES.RECETAS)).filter(function (r) {
    if (!recetaEstadoVigente_(r.estado)) return false;
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

/**
 * Nombres de venta de FUDO (Ventas_FUDO) sin ninguna receta con ese nombre — no importa la fecha,
 * mira TODO el histórico, para que el Administrador los encuentre antes de que se acumulen días de
 * conciliación ciega. Sin receta, esa venta no descuenta NINGÚN ingrediente del inventario (ver
 * conciliarComidaPorSede_ en Conciliacion.gs, caso sin_receta) — un plato compuesto como
 * "Wafle de fresa con chocolate" que no tenga receta hace que ni el wafle, ni la fresa, ni el
 * chocolate se resten del conteo físico cuando se vende, así que la conciliación de esos tres
 * ingredientes queda descuadrada sin explicación.
 *
 * Las bebidas del catálogo (categoría que empieza en "Bebidas") se excluyen a propósito: para
 * esas, no tener receta es normal — se consumen 1:1 sin necesidad de una receta que las explote
 * (ver el mismo comentario en Conciliacion.gs).
 */
function platosFudoSinReceta_() {
  const indice = indiceCatalogo_();
  const productosConReceta = {};
  // Solo cuenta como "resuelto" una receta cuyo estado de verdad participa en la conciliación
  // (mismos estados que excluye recetasVigentes_) — una receta en borrador, pendiente, inactiva o
  // archivada NO explota nada todavía, así que el plato seguiría sin receta real aunque exista una
  // fila para él en la hoja. Antes cualquier fila (sin importar el estado) marcaba el plato como
  // resuelto, escondiendo el hueco real.
  leerTabla_(SHEET_NAMES.RECETAS).forEach(function (r) {
    if (!recetaEstadoVigente_(r.estado)) return;
    productosConReceta[claveProducto_(r.producto, indice)] = true;
  });
  const bebidas = {};
  leerTabla_(SHEET_NAMES.CATALOGO)
    .filter(function (c) { return c.categoria && c.categoria.indexOf('Bebidas') === 0; })
    .forEach(function (c) { bebidas[claveProducto_(c.nombre_estandar, indice)] = true; });

  const vistos = {};
  leerTabla_(SHEET_NAMES.VENTAS_FUDO).forEach(function (v) {
    if (ventaCancelada_(v)) return;
    const clave = claveProducto_(v.producto, indice);
    if (productosConReceta[clave] || bebidas[clave]) return;
    if (!vistos[clave]) vistos[clave] = { producto: nombreCanonico_(v.producto, indice), cantidad_vendida: 0, sedes: {} };
    vistos[clave].cantidad_vendida += Number(v.cantidad) || 0;
    if (v.sede) vistos[clave].sedes[v.sede] = true;
  });

  return Object.keys(vistos).map(function (clave) {
    const it = vistos[clave];
    return { producto: it.producto, cantidad_vendida: it.cantidad_vendida, sedes: Object.keys(it.sedes).sort() };
  }).sort(function (a, b) { return b.cantidad_vendida - a.cantidad_vendida; });
}
