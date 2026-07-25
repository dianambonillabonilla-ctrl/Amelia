/**
 * STOCK BASE DE FUDO
 * Punto de partida real: un snapshot del stock actual de FUDO (export "Control de Stock",
 * pestañas Productos + Ingredientes) que se sube para tener un número de arranque confiable —
 * antes de esto, una bebida sin ninguna venta ese día no tenía NINGÚN dato de FUDO en todo el
 * sistema (Conciliación la mostraba "Sin datos FUDO" aunque FUDO sí supiera su stock real).
 *
 * Con esta base, conciliarBebidas_ (Conciliacion.gs) calcula el stock esperado de cualquier
 * bebida como "stock de la base − lo vendido desde la fecha de la base", sin depender de que
 * haya habido movimiento ese día puntual.
 *
 * Es un UPSERT por nombre normalizado — subir un archivo más reciente reemplaza el punto de
 * partida anterior de cada producto/ingrediente (no se acumulan snapshots viejos; solo importa
 * cuál es el más reciente).
 */
function stockFudoBaseImportar_(filas, usuario) {
  if (!filas || !filas.length) return { ok: false, error: 'No hay filas para importar' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, error: 'Otra importación de stock base está en curso ahora mismo — espera un momento y vuelve a intentarlo.' };
  }
  try {
    const sh = sheet_(SHEET_NAMES.STOCK_FUDO_BASE);
    const data = sh.getDataRange().getValues();
    const headers = data[0];
    const nombreCol = headers.indexOf('nombre_fudo');
    const filaPorNombre = {};
    for (let r = 1; r < data.length; r++) {
      filaPorNombre[normalizar_(data[r][nombreCol])] = r + 1; // fila real de la hoja (1-indexed)
    }

    const ahora = new Date();
    let actualizados = 0;
    let creados = 0;
    let sinNombre = 0;
    let sinStock = 0;
    const nuevasFilas = [];

    filas.forEach(function (f) {
      const nombreFudo = valorFudo_(f, ['nombre_fudo', 'Nombre']);
      if (!nombreFudo) { sinNombre++; return; }
      const stock = valorFudo_(f, ['stock', 'Stock']);
      if (stock === '' || isNaN(Number(stock))) { sinStock++; return; }
      const obj = neutralizarObjetoFormulas_({
        nombre_fudo: nombreFudo,
        tipo: valorFudo_(f, ['tipo', 'Tipo']) || '',
        stock: Number(stock),
        unidad: valorFudo_(f, ['unidad', 'Unidad']) || '',
        fecha_base: valorFudo_(f, ['fecha_base']) || formatearFecha_(ahora),
        importado_por: usuario.nombre,
        importado_en: ahora
      });
      const filaExistente = filaPorNombre[normalizar_(nombreFudo)];
      if (filaExistente) {
        headers.forEach(function (h, c) {
          if (obj[h] !== undefined) sh.getRange(filaExistente, c + 1).setValue(obj[h]);
        });
        actualizados++;
      } else {
        nuevasFilas.push(obj);
        creados++;
      }
    });
    appendRowsFromObjs_(SHEET_NAMES.STOCK_FUDO_BASE, nuevasFilas);
    return { ok: true, actualizados: actualizados, creados: creados, sin_nombre: sinNombre, sin_stock: sinStock };
  } finally {
    lock.releaseLock();
  }
}

/** Índice nombre_fudo normalizado -> fila de Stock_FUDO_Base, para resolver rápido desde Conciliacion.gs. */
function stockFudoBaseIndice_() {
  const indice = {};
  leerTabla_(SHEET_NAMES.STOCK_FUDO_BASE).forEach(function (r) {
    indice[normalizar_(r.nombre_fudo)] = r;
  });
  return indice;
}
