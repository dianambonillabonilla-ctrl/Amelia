/**
 * IMPORTACIÓN DE HISTÓRICO MANUAL (Excel) — jul 2026
 *
 * Negocio recién empezando: antes de usar Dilana OS, compras/producción/traslados/conteos/mermas
 * se llevaban en Excel a mano. Esto da una forma de traer ese histórico al sistema en vez de
 * volver a escribirlo a mano una fila a la vez desde las pantallas normales.
 *
 * Reutiliza EXACTAMENTE los mismos validadores/escritores que usan las pantallas manuales
 * (ajusteInventarioRegistrar_, produccionRegistrar_, trasladoCrear_/trasladoConfirmar_,
 * conteoRegistrar_) — una fila importada queda sujeta a las mismas reglas de negocio (permisos de
 * sede, cantidades válidas, tipos de ajuste válidos, etc.) que si se hubiera tecleado en
 * compras.html/producir.html/traslados.html/conteo.html. No se reimplementa esa lógica aquí.
 *
 * Ver historico_tipos_listar / historico_importar en Code.gs — acción solo Administrador, misma
 * pantalla que "Importar de FUDO" (importar.html), sección "Datos históricos manuales (Excel)".
 *
 * Dedupe: a diferencia de Fudo (que dedupe por id real de la venta/pago), estas hojas no tienen un
 * id externo — se dedupea por contenido (fecha+sede+producto+cantidad+…, ver historicoClave*_)
 * usando el mismo contadorClaves_ de Fudo.gs (cuenta ocurrencias previas en la hoja, no solo
 * existe/no existe) — así subir el mismo archivo dos veces por accidente no duplica filas, pero dos
 * compras genuinamente idénticas el mismo día sí se aceptan las dos. Conteos no necesita esto:
 * conteoRegistrar_ ya hace upsert por (fecha, sede, punto, turno, producto).
 */

const HISTORICO_TIPOS_ = {
  compras: {
    etiqueta: 'Compras y recepciones',
    campos: [
      { clave: 'fecha', etiqueta: 'Fecha', obligatorio: true },
      { clave: 'sede', etiqueta: 'Sede', obligatorio: true },
      { clave: 'punto', etiqueta: 'Punto (bodega, etc.)' },
      { clave: 'producto', etiqueta: 'Producto', obligatorio: true },
      { clave: 'unidad', etiqueta: 'Unidad', obligatorio: true },
      { clave: 'cantidad', etiqueta: 'Cantidad recibida', obligatorio: true },
      { clave: 'proveedor', etiqueta: 'Proveedor' },
      { clave: 'numero_factura', etiqueta: 'N° de factura' },
      { clave: 'costo', etiqueta: 'Costo' },
      { clave: 'motivo', etiqueta: 'Nota' }
    ]
  },
  mermas_ajustes: {
    etiqueta: 'Mermas y ajustes',
    campos: [
      { clave: 'fecha', etiqueta: 'Fecha', obligatorio: true },
      { clave: 'sede', etiqueta: 'Sede', obligatorio: true },
      { clave: 'punto', etiqueta: 'Punto' },
      { clave: 'tipo', etiqueta: 'Tipo (Merma / desperdicio, Ajuste operativo o Consumo interno)', obligatorio: true },
      { clave: 'producto', etiqueta: 'Producto', obligatorio: true },
      { clave: 'unidad', etiqueta: 'Unidad', obligatorio: true },
      { clave: 'cantidad', etiqueta: 'Cantidad', obligatorio: true },
      { clave: 'motivo', etiqueta: 'Motivo' }
    ]
  },
  producciones: {
    etiqueta: 'Producción',
    campos: [
      { clave: 'fecha', etiqueta: 'Fecha', obligatorio: true },
      { clave: 'sede', etiqueta: 'Sede', obligatorio: true },
      { clave: 'item', etiqueta: 'Producto preparado', obligatorio: true },
      { clave: 'unidad', etiqueta: 'Unidad', obligatorio: true },
      { clave: 'cantidad', etiqueta: 'Cantidad producida', obligatorio: true },
      { clave: 'insumo_producto', etiqueta: 'Insumo crudo consumido (opcional)' },
      { clave: 'insumo_cantidad', etiqueta: 'Cantidad de insumo (opcional)' },
      { clave: 'insumo_unidad', etiqueta: 'Unidad de insumo (opcional)' },
      { clave: 'merma_cantidad', etiqueta: 'Merma de proceso (opcional)' },
      { clave: 'observacion', etiqueta: 'Observación (opcional)' }
    ]
  },
  traslados: {
    etiqueta: 'Traslados entre sedes',
    campos: [
      { clave: 'fecha', etiqueta: 'Fecha', obligatorio: true },
      { clave: 'producto', etiqueta: 'Producto', obligatorio: true },
      { clave: 'unidad', etiqueta: 'Unidad', obligatorio: true },
      { clave: 'cantidad', etiqueta: 'Cantidad enviada', obligatorio: true },
      { clave: 'sede_origen', etiqueta: 'Sede origen', obligatorio: true },
      { clave: 'punto_origen', etiqueta: 'Punto origen (opcional)' },
      { clave: 'sede_destino', etiqueta: 'Sede destino', obligatorio: true },
      { clave: 'punto_destino', etiqueta: 'Punto destino (opcional)' },
      { clave: 'cantidad_recibida', etiqueta: 'Cantidad recibida, si ya llegó (opcional)' }
    ]
  },
  conteos: {
    etiqueta: 'Conteos físicos históricos',
    campos: [
      { clave: 'fecha', etiqueta: 'Fecha', obligatorio: true },
      { clave: 'sede', etiqueta: 'Sede', obligatorio: true },
      { clave: 'punto_conteo', etiqueta: 'Punto de conteo (opcional)' },
      { clave: 'producto', etiqueta: 'Producto', obligatorio: true },
      { clave: 'unidad', etiqueta: 'Unidad', obligatorio: true },
      { clave: 'cantidad', etiqueta: 'Cantidad contada', obligatorio: true }
    ]
  }
};

/** Para armar el selector de tipo + la UI de mapeo de columnas en importar.html. */
function historicoTiposListar_() {
  return Object.keys(HISTORICO_TIPOS_).map(function (k) {
    return { tipo: k, etiqueta: HISTORICO_TIPOS_[k].etiqueta, campos: HISTORICO_TIPOS_[k].campos };
  });
}

function historicoNormNum_(v) {
  const n = Number(v);
  return isNaN(n) ? '' : String(n);
}

function historicoClaveCompraAjuste_(fecha, sede, tipo, producto, cantidad, proveedor, numeroFactura) {
  return [normalizar_(fecha), normalizar_(sede), normalizar_(tipo), normalizar_(producto),
    historicoNormNum_(cantidad), normalizar_(proveedor), normalizar_(numeroFactura)].join('|');
}

function historicoClaveProduccion_(fecha, sede, item, cantidad, unidad) {
  return [normalizar_(fecha), normalizar_(sede), normalizar_(item), historicoNormNum_(cantidad), normalizar_(unidad)].join('|');
}

function historicoClaveTraslado_(fecha, producto, cantidad, sedeOrigen, sedeDestino) {
  return [normalizar_(fecha), normalizar_(producto), historicoNormNum_(cantidad), normalizar_(sedeOrigen), normalizar_(sedeDestino)].join('|');
}

function historicoFechaTexto_(v) {
  return v ? formatearFecha_(v) : '';
}

/**
 * Compras y Mermas/Ajustes van a la misma hoja (Ajustes_Inventario, ver AjustesInventario.gs) —
 * tipoFijo fuerza 'Compra cruda' para el destino "compras" (para que no dependa de que el Excel
 * traiga esa columna); mermas_ajustes deja que cada fila traiga su propio tipo (validado por
 * ajusteInventarioValidar_ contra TIPOS_AJUSTE_INVENTARIO, no se repite esa lista aquí).
 */
function historicoImportarAjustes_(filas, usuario, tipoFijo) {
  const contador = contadorClaves_();
  leerTabla_(SHEET_NAMES.AJUSTES_INVENTARIO).forEach(function (r) {
    contador.marcarPrevio(historicoClaveCompraAjuste_(r.fecha, r.sede, r.tipo, r.producto, r.cantidad, r.proveedor, r.numero_factura));
  });

  let importados = 0;
  let omitidos = 0;
  const errores = [];
  filas.forEach(function (f, i) {
    const item = {
      fecha: historicoFechaTexto_(f.fecha),
      sede: f.sede || '',
      punto: f.punto || '',
      tipo: tipoFijo || f.tipo || '',
      producto: f.producto || '',
      unidad: f.unidad || '',
      cantidad: f.cantidad,
      motivo: f.motivo || '',
      proveedor: f.proveedor || '',
      numero_factura: f.numero_factura || '',
      costo: f.costo
    };
    const clave = historicoClaveCompraAjuste_(item.fecha, item.sede, item.tipo, item.producto, item.cantidad, item.proveedor, item.numero_factura);
    if (contador.esDuplicadaPrevia(clave)) { omitidos++; return; }
    const resultado = ajusteInventarioRegistrar_(item, usuario);
    if (resultado.ok) importados++;
    else errores.push('Fila ' + (i + 1) + ': ' + resultado.error);
  });
  return { ok: true, importados: importados, omitidos_duplicados: omitidos, errores: errores.slice(0, 20), total_errores: errores.length };
}

function historicoImportarProducciones_(filas, usuario) {
  const contador = contadorClaves_();
  leerTabla_(SHEET_NAMES.PRODUCCIONES).forEach(function (r) {
    contador.marcarPrevio(historicoClaveProduccion_(r.fecha, r.sede, r.item, r.cantidad, r.unidad));
  });

  let importados = 0;
  let omitidos = 0;
  const errores = [];
  filas.forEach(function (f, i) {
    const item = {
      fecha: historicoFechaTexto_(f.fecha),
      sede: f.sede || '',
      item: f.item || '',
      cantidad: f.cantidad,
      unidad: f.unidad || '',
      insumo_producto: f.insumo_producto || '',
      insumo_cantidad: f.insumo_cantidad,
      insumo_unidad: f.insumo_unidad || '',
      merma_cantidad: f.merma_cantidad,
      observacion: f.observacion || ''
    };
    const clave = historicoClaveProduccion_(item.fecha, item.sede, item.item, item.cantidad, item.unidad);
    if (contador.esDuplicadaPrevia(clave)) { omitidos++; return; }
    // Una a la vez (no como arreglo completo): así una fila con datos malos queda como error propio
    // en vez de tumbar el resto del lote — importante en histórico, donde es normal que algunas
    // filas del Excel viejo tengan huecos.
    const resultado = produccionRegistrar_([item], usuario, {});
    if (resultado.ok) importados++;
    else errores.push('Fila ' + (i + 1) + ': ' + resultado.error);
  });
  return { ok: true, importados: importados, omitidos_duplicados: omitidos, errores: errores.slice(0, 20), total_errores: errores.length };
}

function historicoImportarTraslados_(filas, usuario) {
  const contador = contadorClaves_();
  leerTabla_(SHEET_NAMES.TRASLADOS).forEach(function (r) {
    contador.marcarPrevio(historicoClaveTraslado_(r.fecha, r.producto, r.cantidad_enviada, r.sede_origen, r.sede_destino));
  });

  let importados = 0;
  let omitidos = 0;
  const errores = [];
  filas.forEach(function (f, i) {
    const fecha = historicoFechaTexto_(f.fecha);
    const clave = historicoClaveTraslado_(fecha, f.producto, f.cantidad, f.sede_origen, f.sede_destino);
    if (contador.esDuplicadaPrevia(clave)) { omitidos++; return; }
    const resultado = trasladoCrear_({
      fecha: fecha,
      producto: f.producto || '',
      unidad: f.unidad || '',
      cantidad: f.cantidad,
      sede_origen: f.sede_origen || '',
      punto_origen: f.punto_origen || '',
      sede_destino: f.sede_destino || '',
      punto_destino: f.punto_destino || ''
    }, usuario);
    if (!resultado.ok) { errores.push('Fila ' + (i + 1) + ': ' + resultado.error); return; }
    importados++;
    // Si el Excel ya traía la cantidad realmente recibida, confirma el traslado de una vez — un
    // traslado que en la realidad ya llegó hace meses no debería quedar "Enviado" para siempre
    // solo porque se está importando ahora.
    if (f.cantidad_recibida !== undefined && f.cantidad_recibida !== '' && f.cantidad_recibida !== null) {
      trasladoConfirmar_(resultado.id, f.cantidad_recibida, usuario);
    }
  });
  return { ok: true, importados: importados, omitidos_duplicados: omitidos, errores: errores.slice(0, 20), total_errores: errores.length };
}

function historicoImportarConteos_(filas, usuario) {
  let importados = 0;
  let actualizados = 0;
  const errores = [];
  filas.forEach(function (f, i) {
    const item = {
      fecha: historicoFechaTexto_(f.fecha),
      sede: f.sede || '',
      punto_conteo: f.punto_conteo || 'Café',
      producto: f.producto || '',
      unidad: f.unidad || '',
      cantidad: f.cantidad
    };
    // Se registra de a una fila (no el arreglo completo junto): cada fila del histórico puede ser de
    // una fecha/sede distinta, y conteoRegistrar_ asume que un mismo envío es una sola sesión de
    // conteo. omitir_obligatorios_del_dia:true porque un conteo histórico parcial no debería
    // bloquearse por no traer TODOS los productos obligatorios de ese día (esa regla es para el
    // cierre de turno real de hoy, no para poblar historial). El upsert por (fecha, sede, punto,
    // turno, producto) de conteoRegistrar_ ya evita duplicar si el mismo archivo se sube dos veces.
    const resultado = conteoRegistrar_([item], usuario, { omitir_obligatorios_del_dia: true });
    if (resultado.ok) {
      importados += resultado.registrados || 0;
      actualizados += resultado.actualizados || 0;
    } else {
      errores.push('Fila ' + (i + 1) + ': ' + resultado.error);
    }
  });
  return { ok: true, importados: importados, actualizados: actualizados, errores: errores.slice(0, 20), total_errores: errores.length };
}

function historicoImportarFilas_(tipoDestino, filas, usuario, opciones) {
  opciones = opciones || {};
  if (!HISTORICO_TIPOS_[tipoDestino]) return { ok: false, error: 'Tipo de destino no reconocido: ' + tipoDestino };
  if (!filas || !filas.length) return { ok: false, error: 'No se recibieron filas' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, error: 'Otra importación histórica está en curso ahora mismo — espera un momento y vuelve a intentarlo.' };
  }
  try {
    if (tipoDestino === 'compras') return historicoImportarAjustes_(filas, usuario, 'Compra cruda');
    if (tipoDestino === 'mermas_ajustes') return historicoImportarAjustes_(filas, usuario, null);
    if (tipoDestino === 'producciones') return historicoImportarProducciones_(filas, usuario);
    if (tipoDestino === 'traslados') return historicoImportarTraslados_(filas, usuario);
    if (tipoDestino === 'conteos') return historicoImportarConteos_(filas, usuario);
    return { ok: false, error: 'Tipo de destino no implementado: ' + tipoDestino };
  } finally {
    lock.releaseLock();
  }
}
