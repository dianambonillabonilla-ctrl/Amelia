/**
 * REGISTRO DE PRODUCCIÓN
 * Registra directamente cuánto se preparó de un ítem (ej. "8kg de Costilla Preparada"),
 * en vez de inferirlo restando el conteo de un día contra el anterior. Conciliacion.gs usa
 * este dato cuando existe y cae al cálculo inferido (cambio físico) cuando no hay producción
 * registrada para esa fecha/sede/ítem.
 *
 * insumo_producto/insumo_cantidad/insumo_unidad/merma_cantidad/merma_unidad son OPCIONALES (jul
 * 2026, ver docs/modelo-inventario.md sección 6.B): registran cuánto insumo crudo entró al lote y
 * cuánto se perdió como merma de proceso, además de lo ya preparado — así un mismo evento de
 * producción puede generar sus tres movimientos ("Entrada por producción", "Consumo de
 * producción", "Merma de producción" — ver movimientosDesdeProduccion_ en MovimientosInventario.gs)
 * en vez de solo el primero. Si no se mandan (como hasta ahora), producciónRegistrar_ funciona
 * exactamente igual que antes — no se exige nada nuevo a quien solo registra el producto terminado.
 */

/**
 * Solo valida, no escribe nada — separado de produccionRegistrar_ para que
 * produccionConObligatoriosRegistrar_ pueda comprobar ESTO y también los insumos obligatorios
 * ANTES de escribir cualquiera de los dos, sin duplicar las reglas de negocio.
 */
function validarItemsProduccion_(items, usuario) {
  if (!items || !items.length) return 'No se recibieron items para registrar';
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    if (!it.fecha || !it.sede || !it.item || !it.unidad) {
      return 'Cada producción debe tener fecha, sede, producto y unidad';
    }
    if (isNaN(Number(it.cantidad)) || Number(it.cantidad) <= 0) {
      return 'La cantidad producida debe ser un número mayor que cero';
    }
    // El insumo consumido es opcional, pero si se manda alguno de sus tres datos, los tres son
    // obligatorios — un insumo a medias (ej. producto sin unidad) no sirve para nada y generaría un
    // movimiento de "Consumo de producción" incompleto en MovimientosInventario.gs.
    const tieneAlgoDeInsumo = it.insumo_producto || it.insumo_cantidad !== undefined && it.insumo_cantidad !== '' || it.insumo_unidad;
    if (tieneAlgoDeInsumo && (!it.insumo_producto || !it.insumo_unidad || isNaN(Number(it.insumo_cantidad)) || Number(it.insumo_cantidad) <= 0)) {
      return 'Si registras el insumo consumido, debe traer producto, cantidad (mayor que cero) y unidad';
    }
    if (it.merma_cantidad !== undefined && it.merma_cantidad !== '' && (isNaN(Number(it.merma_cantidad)) || Number(it.merma_cantidad) < 0)) {
      return 'La merma de producción no puede ser negativa';
    }
  }
  // sedeEscrituraPermitida_ (Code.gs) también deja registrar en Centro de Producción sin importar
  // la sede propia — San Antonio/Capri/Ambas cubren ese sitio en la práctica.
  if (items.some(function (it) { return !sedeEscrituraPermitida_(usuario, it.sede); })) {
    return 'No puedes registrar producción para una sede distinta a la tuya (' + usuario.sede + ')';
  }
  return null;
}

/** Revisa tanto el producto terminado (item/cantidad/unidad) como, si viene, el insumo consumido
 * (insumo_producto/insumo_cantidad/insumo_unidad) — un error de tecleo en cualquiera de los dos
 * puede dañar el inventario igual de mal. Ver CantidadesRaras.gs. */
function itemsProduccionConCantidadRara_(items) {
  const filas = leerTabla_(SHEET_NAMES.PRODUCCIONES);
  const raras = [];
  items.forEach(function (it) {
    const baseItem = aUnidadBase_(it.cantidad, it.unidad);
    const historialItem = historialCantidadesBase_(filas, 'item', 'cantidad', 'unidad', it.item, baseItem.unidad);
    const raraItem = cantidadEsRara_(historialItem, baseItem.cantidad);
    if (raraItem) raras.push(avisoCantidadRara_(it.item, it.cantidad, it.unidad, baseItem.unidad, raraItem));

    if (it.insumo_producto && it.insumo_cantidad !== undefined && it.insumo_cantidad !== '') {
      const baseInsumo = aUnidadBase_(it.insumo_cantidad, it.insumo_unidad);
      const historialInsumo = historialCantidadesBase_(filas, 'insumo_producto', 'insumo_cantidad', 'insumo_unidad', it.insumo_producto, baseInsumo.unidad);
      const raraInsumo = cantidadEsRara_(historialInsumo, baseInsumo.cantidad);
      if (raraInsumo) raras.push(avisoCantidadRara_(it.insumo_producto, it.insumo_cantidad, it.insumo_unidad, baseInsumo.unidad, raraInsumo));
    }
  });
  return raras;
}

function produccionRegistrar_(items, usuario, opciones) {
  opciones = opciones || {};
  const errorValidacion = validarItemsProduccion_(items, usuario);
  if (errorValidacion) return { ok: false, error: errorValidacion };

  if (!opciones.confirmar_cantidades_raras) {
    const raras = itemsProduccionConCantidadRara_(items);
    if (raras.length) return { ok: false, requiere_confirmacion: true, cantidades_raras: raras };
  }

  // Idempotencia: producir.html manda un request_id nuevo por cada clic en "Guardar" (ver
  // assets/idempotencia.js). Sin esto, cada llamada creaba filas nuevas sin importar si los datos
  // eran idénticos — un reintento de red después de que el servidor ya había guardado, o un doble
  // clic, duplicaba la producción registrada (auditoría de seguridad, jul 2026). Lectura+escritura
  // van bajo lock para que dos solicitudes con el MISMO request_id casi simultáneas (dos pestañas)
  // no pasen ambas la comprobación antes de que ninguna hubiera escrito todavía.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, error: 'Ya se está guardando producción ahora mismo — espera un momento y vuelve a intentarlo.' };
  }
  try {
    if (opciones.request_id) {
      const yaRegistrado = leerTabla_(SHEET_NAMES.PRODUCCIONES).some(function (r) { return r.request_id === opciones.request_id; });
      if (yaRegistrado) return { ok: true, registrados: items.length, repetido: true };
    }

    const ahora = new Date();
    items.forEach(function (it) {
      const fila = {
        id: Utilities.getUuid(),
        fecha: it.fecha,
        sede: it.sede,
        item: it.item,
        cantidad: Number(it.cantidad),
        unidad: it.unidad,
        usuario: usuario.nombre,
        timestamp: ahora,
        request_id: opciones.request_id || '',
        insumo_producto: it.insumo_producto || '',
        insumo_cantidad: it.insumo_cantidad !== undefined && it.insumo_cantidad !== '' ? Number(it.insumo_cantidad) : '',
        insumo_unidad: it.insumo_unidad || '',
        merma_cantidad: it.merma_cantidad !== undefined && it.merma_cantidad !== '' ? Number(it.merma_cantidad) : '',
        merma_unidad: it.merma_unidad || it.insumo_unidad || it.unidad || '',
        rendimiento_porcentaje: it.rendimiento_porcentaje !== undefined && it.rendimiento_porcentaje !== '' ? Number(it.rendimiento_porcentaje) : '',
        receta_referencia: it.receta_referencia || '',
        hora_inicio: it.hora_inicio || '',
        hora_fin: it.hora_fin || '',
        observacion: it.observacion || '',
        evidencia_url: it.evidencia_url || ''
      };
      appendRowFromObj_(SHEET_NAMES.PRODUCCIONES, fila);
      if (typeof inventarioLibroIntentarDesdeProduccion_ === 'function') {
        inventarioLibroIntentarDesdeProduccion_(fila, usuario);
      }
    });
    return { ok: true, registrados: items.length };
  } finally {
    lock.releaseLock();
  }
}

function produccionListar_(fecha, sede) {
  let rows = leerTabla_(SHEET_NAMES.PRODUCCIONES);
  if (fecha) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) === fecha; });
  if (sede) rows = rows.filter(function (r) { return r.sede === sede; });
  return rows;
}

/** Mismo patrón que conteosHistorial_ (Conteos.gs) y ajustesInventarioHistorial_ (AjustesInventario.gs). */
function produccionHistorial_(filtros) {
  filtros = filtros || {};
  let rows = leerTabla_(SHEET_NAMES.PRODUCCIONES);
  if (filtros.fecha_desde) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) >= filtros.fecha_desde; });
  if (filtros.fecha_hasta) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) <= filtros.fecha_hasta; });
  if (filtros.sede && filtros.sede !== 'Ambas') rows = rows.filter(function (r) { return r.sede === filtros.sede; });
  if (filtros.producto) {
    const q = normalizar_(filtros.producto);
    rows = rows.filter(function (r) { return normalizar_(r.item).indexOf(q) !== -1; });
  }
  return rows.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
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
function producidoTotalIngrediente_(fecha, ingrediente, indice, sede) {
  indice = indice || indiceCatalogo_();
  const clave = claveProducto_(ingrediente, indice);
  return leerTabla_(SHEET_NAMES.PRODUCCIONES)
    .filter(function (r) {
      return formatearFecha_(r.fecha) === fecha && claveProducto_(r.item, indice) === clave &&
        (!sede || sede === 'Ambas' || r.sede === sede);
    })
    .reduce(function (acc, r) { return acc + (Number(r.cantidad) || 0); }, 0);
}

/**
 * Une "guardar producción" + "guardar insumos obligatorios de cocina" en UNA sola operación de
 * negocio: valida los DOS conjuntos de items ANTES de escribir cualquiera de los dos. Antes
 * producir.html mandaba dos llamadas independientes en paralelo (Promise.all) — si la de
 * producción pasaba pero la de conteos obligatorios fallaba (o al revés), quedaba un estado a
 * medias: producción guardada sin sus insumos obligatorios, o viceversa, con el usuario viendo un
 * solo mensaje de error sin saber cuál de las dos sí se guardó (auditoría de seguridad, jul 2026).
 * `opciones.produccion`/`opciones.conteo` se reenvían tal cual a cada función (ej. request_id).
 */
function produccionConObligatoriosRegistrar_(itemsProduccion, itemsObligatorios, usuario, opciones) {
  opciones = opciones || {};
  itemsProduccion = itemsProduccion || [];
  itemsObligatorios = itemsObligatorios || [];
  if (!itemsProduccion.length && !itemsObligatorios.length) {
    return { ok: false, error: 'No se recibió nada para registrar' };
  }

  if (itemsProduccion.length) {
    const errorProduccion = validarItemsProduccion_(itemsProduccion, usuario);
    if (errorProduccion) return { ok: false, error: errorProduccion };
  }
  // omitir_obligatorios_del_dia: este envío es SOLO los insumos obligatorios de cocina, no el
  // cierre de conteo del día — ver el mismo comentario en Conteos.gs.
  if (itemsObligatorios.length) {
    const errorConteo = validarItemsConteo_(itemsObligatorios, usuario, { omitir_obligatorios_del_dia: true });
    if (errorConteo) return { ok: false, error: errorConteo };
  }

  const resultado = { ok: true };
  if (itemsProduccion.length) {
    resultado.produccion = produccionRegistrar_(itemsProduccion, usuario, opciones.produccion);
    if (!resultado.produccion.ok) return resultado.produccion;
  }
  if (itemsObligatorios.length) {
    resultado.conteo = conteoRegistrar_(itemsObligatorios, usuario, Object.assign({ omitir_obligatorios_del_dia: true }, opciones.conteo));
    if (!resultado.conteo.ok) return resultado.conteo;
  }
  return resultado;
}
