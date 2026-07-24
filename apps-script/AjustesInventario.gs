/**
 * AJUSTES DE INVENTARIO
 * Registra eventos que explican por qué cambia el inventario físico sin ser una venta:
 *  - Compra cruda: entrada de materia prima al Centro de Producción o a una sede.
 *  - Merma / desperdicio: producto que se pierde, se daña, se recorta o no queda usable.
 *  - Ajuste operativo: corrección documentada cuando el conteo físico detecta diferencia.
 *
 * Estos registros no reemplazan el conteo físico: lo explican en conciliación. El conteo sigue
 * siendo la verdad del inventario al cierre; compra/merma/ajuste ayudan a saber si el cambio
 * entre ayer y hoy cuadra con compras, producción, traslados y ventas.
 */

const TIPOS_AJUSTE_INVENTARIO = ['Compra cruda', 'Merma / desperdicio', 'Ajuste operativo'];

/** Solo valida — no escribe nada. Separado de ajusteInventarioRegistrar_ para que Compras.gs
 * (que registra varias líneas de una factura de una sola vez) pueda validar cada línea con las
 * mismas reglas sin tener que escribir fila por fila — ver ajusteInventarioFila_ + compraRegistrarFactura_. */
function ajusteInventarioValidar_(item, usuario) {
  if (!item || !item.fecha || !item.sede || !item.tipo || !item.producto || !item.unidad) {
    return { ok: false, error: 'Faltan datos del ajuste (fecha, sede, tipo, producto y unidad son obligatorios)' };
  }
  if (TIPOS_AJUSTE_INVENTARIO.indexOf(item.tipo) === -1) {
    return { ok: false, error: 'Tipo de ajuste no válido: ' + item.tipo };
  }
  if (isNaN(Number(item.cantidad)) || Number(item.cantidad) <= 0) {
    return { ok: false, error: 'La cantidad debe ser un número mayor que cero' };
  }
  // sedeEscrituraPermitida_ (Code.gs) también deja registrar en Centro de Producción sin importar
  // la sede propia — San Antonio/Capri/Ambas cubren ese sitio en la práctica.
  if (!sedeEscrituraPermitida_(usuario, item.sede)) {
    return { ok: false, error: 'No puedes registrar ajustes para una sede distinta a la tuya (' + usuario.sede + ')' };
  }
  return { ok: true };
}

/** La fila lista para escribir en Ajustes_Inventario — no valida, asume que ya se llamó
 * ajusteInventarioValidar_. Separado para que appendRowsFromObjs_ pueda escribir muchas de una vez. */
function ajusteInventarioFila_(item, usuario) {
  return {
    id: Utilities.getUuid(),
    fecha: item.fecha,
    sede: item.sede,
    punto: item.punto || '',
    tipo: item.tipo,
    producto: item.producto,
    unidad: item.unidad,
    cantidad: Number(item.cantidad),
    motivo: item.motivo || '',
    usuario: usuario.nombre,
    timestamp: new Date(),
    proveedor: item.proveedor || '',
    numero_factura: item.numero_factura || '',
    costo: item.costo !== undefined && item.costo !== '' && !isNaN(Number(item.costo)) ? Number(item.costo) : '',
    factura_id: item.factura_id || '',
    // "avalado" es solo un estado de revisión del Administrador (ver ajusteInventarioAvalar_) —
    // no bloquea nada: la merma/ajuste ya afecta Disponible Hoy y Conciliación desde que se
    // registra, esperar a que alguien la revise dejaría el inventario desactualizado mientras
    // tanto. Es puramente para que el Administrador pueda marcar "ya revisé esto".
    avalado: false,
    avalado_por: '',
    timestamp_avalado: ''
  };
}

function ajusteInventarioRegistrar_(item, usuario) {
  const validacion = ajusteInventarioValidar_(item, usuario);
  if (!validacion.ok) return validacion;
  appendRowFromObj_(SHEET_NAMES.AJUSTES_INVENTARIO, ajusteInventarioFila_(item, usuario));
  return { ok: true };
}

function ajustesInventarioListar_(fecha, sede) {
  let rows = leerTabla_(SHEET_NAMES.AJUSTES_INVENTARIO);
  if (fecha) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) === fecha; });
  if (sede) rows = rows.filter(function (r) { return r.sede === sede; });
  return rows.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
}

/**
 * Histórico completo de mermas/ajustes (a diferencia de ajustesInventarioListar_, que solo sirve
 * para UN día): por rango de fechas, sede, tipo y/o búsqueda por producto. Más reciente primero.
 * Espejo de conteosHistorial_ en Conteos.gs — misma idea, para "Registrar conteo"/"Compras" pero
 * para mermas y ajustes operativos.
 */
function ajustesInventarioHistorial_(filtros) {
  filtros = filtros || {};
  let rows = leerTabla_(SHEET_NAMES.AJUSTES_INVENTARIO);
  if (filtros.fecha_desde) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) >= filtros.fecha_desde; });
  if (filtros.fecha_hasta) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) <= filtros.fecha_hasta; });
  if (filtros.sede && filtros.sede !== 'Ambas') rows = rows.filter(function (r) { return r.sede === filtros.sede; });
  if (filtros.tipo) rows = rows.filter(function (r) { return r.tipo === filtros.tipo; });
  if (filtros.producto) {
    const q = normalizar_(filtros.producto);
    rows = rows.filter(function (r) { return normalizar_(r.producto).indexOf(q) !== -1; });
  }
  return rows.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
}

/**
 * Marca una merma como revisada por el Administrador — pedido explícito: "el administrador puede
 * ver que mermas le registraron y si están avaladas". Solo aplica a "Merma / desperdicio": una
 * compra ya tiene su propio rastro (proveedor/factura en Compras) y un ajuste operativo es una
 * corrección ya documentada al momento, no algo que necesite revisión aparte.
 */
function ajusteInventarioAvalar_(id, usuario) {
  if (!id) return { ok: false, error: 'Falta el id del movimiento a avalar' };
  const sh = sheet_(SHEET_NAMES.AJUSTES_INVENTARIO);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const tipoCol = headers.indexOf('tipo');
  const avaladoCol = headers.indexOf('avalado');
  const avaladoPorCol = headers.indexOf('avalado_por');
  const timestampAvaladoCol = headers.indexOf('timestamp_avalado');
  // Si la hoja Ajustes_Inventario todavía no tiene estas 3 columnas (falta correr
  // configurarHojas() una vez desde el editor de Apps Script después de este cambio), .indexOf
  // devuelve -1 y sh.getRange(fila, -1 + 1) = sh.getRange(fila, 0) explota con un error de Sheets
  // ("La columna inicial del intervalo es demasiado pequeña") que no dice nada de esto. Se
  // detecta antes y se explica qué hace falta en vez de dejar pasar ese error críptico.
  if (avaladoCol === -1 || avaladoPorCol === -1 || timestampAvaladoCol === -1) {
    return { ok: false, error: 'Falta preparar la hoja Ajustes_Inventario para avalar mermas: corre configurarHojas() una vez desde el editor de Apps Script (Extensiones → Apps Script → elige configurarHojas en el menú de funciones → Ejecutar) y vuelve a intentar.' };
  }
  for (let r = 1; r < data.length; r++) {
    if (data[r][idCol] === id) {
      if (data[r][tipoCol] !== 'Merma / desperdicio') {
        return { ok: false, error: 'Solo las mermas se avalan (compras y ajustes operativos no lo necesitan)' };
      }
      sh.getRange(r + 1, avaladoCol + 1).setValue(true);
      sh.getRange(r + 1, avaladoPorCol + 1).setValue(usuario.nombre);
      sh.getRange(r + 1, timestampAvaladoCol + 1).setValue(new Date());
      return { ok: true };
    }
  }
  return { ok: false, error: 'No se encontró el movimiento ' + id };
}

/**
 * Corrige la unidad (y cantidad) de una compra YA registrada — la acción real detrás de la opción
 * "la unidad del último conteo es la correcta" en Diagnóstico → "Compras que no están sumando",
 * para el caso en que la unidad de la compra no combina con la del último conteo físico. Solo
 * aplica a "Compra cruda": mermas y ajustes operativos no pasan por este flujo de corrección.
 * Deja constancia en `motivo` de qué tenía antes — a diferencia de crear/vincular/fusionar
 * productos del catálogo, esto sí reescribe un dato ya registrado, así que conviene que quede
 * rastro de quién lo corrigió y qué decía originalmente.
 */
function ajusteInventarioCorregirUnidad_(id, unidadNueva, cantidadNueva, usuario) {
  if (!id) return { ok: false, error: 'Falta el id de la compra a corregir' };
  if (!unidadNueva) return { ok: false, error: 'Falta la unidad correcta' };
  if (isNaN(Number(cantidadNueva)) || Number(cantidadNueva) <= 0) {
    return { ok: false, error: 'La cantidad debe ser un número mayor que cero' };
  }

  const sh = sheet_(SHEET_NAMES.AJUSTES_INVENTARIO);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const tipoCol = headers.indexOf('tipo');
  const unidadCol = headers.indexOf('unidad');
  const cantidadCol = headers.indexOf('cantidad');
  const motivoCol = headers.indexOf('motivo');

  for (let r = 1; r < data.length; r++) {
    if (data[r][idCol] === id) {
      if (data[r][tipoCol] !== 'Compra cruda') {
        return { ok: false, error: 'Solo se corrige la unidad de compras (Compra cruda)' };
      }
      const unidadVieja = data[r][unidadCol];
      const cantidadVieja = data[r][cantidadCol];
      sh.getRange(r + 1, unidadCol + 1).setValue(unidadNueva);
      sh.getRange(r + 1, cantidadCol + 1).setValue(Number(cantidadNueva));
      if (motivoCol !== -1) {
        const notaAnterior = data[r][motivoCol] || '';
        const nota = 'Unidad corregida desde Diagnóstico por ' + usuario.nombre + ' (antes: ' + cantidadVieja + ' ' + unidadVieja + ').';
        sh.getRange(r + 1, motivoCol + 1).setValue(notaAnterior ? notaAnterior + ' | ' + nota : nota);
      }
      return { ok: true };
    }
  }
  return { ok: false, error: 'No se encontró la compra ' + id };
}

function ajustesNetosPorItem_(fecha, sede, indice) {
  const totales = {};
  ajustesInventarioListar_(fecha, sede).forEach(function (a) {
    const base = aUnidadBase_(a.cantidad, a.unidad);
    const clave = claveProducto_(a.producto, indice);
    if (!totales[clave]) {
      totales[clave] = { cantidad: 0, compras: 0, mermas: 0, ajustes: 0, unidad: base.unidad };
    }
    if (totales[clave].unidad !== base.unidad) return;
    if (a.tipo === 'Compra cruda') {
      totales[clave].cantidad += base.cantidad;
      totales[clave].compras += base.cantidad;
    } else if (a.tipo === 'Merma / desperdicio') {
      totales[clave].cantidad -= base.cantidad;
      totales[clave].mermas += base.cantidad;
    } else {
      totales[clave].cantidad += base.cantidad;
      totales[clave].ajustes += base.cantidad;
    }
  });
  return totales;
}
