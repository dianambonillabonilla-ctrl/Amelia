/**
 * LIBRO CENTRAL DE MOVIMIENTOS DE INVENTARIO (tabla física Movimientos_Inventario)
 * Complementa la vista de solo lectura en MovimientosInventario.gs — no la reemplaza todavía.
 * Los módulos operativos (Ajustes, Producción, Traslados) siguen escribiendo en sus hojas;
 * cuando INVENTARIO_LIBRO_ACTIVO=true en Propiedades del Script, también duplican aquí con
 * clave idempotente. La vista calculada sigue siendo la fuente de verdad para Conciliacion.gs
 * y DisponibleHoy.gs hasta que se decida cortar (ver docs/modelo-inventario.md).
 *
 * Activar dual-write (una vez, desde el editor de Apps Script):
 *   inventarioLibroConfigurarActivo_(true)
 * Desactivar:
 *   inventarioLibroConfigurarActivo_(false)
 */

const INVENTARIO_LIBRO_PROP_ACTIVO_ = 'INVENTARIO_LIBRO_ACTIVO';

const INVENTARIO_MOVIMIENTO_ESTADOS_ = ['Registrado', 'Avalado', 'Revertido', 'Anulado'];

function inventarioLibroActivo_() {
  return PropertiesService.getScriptProperties().getProperty(INVENTARIO_LIBRO_PROP_ACTIVO_) === 'true';
}

/** Correr manualmente desde el editor — no expuesto en la app web por defecto. */
function inventarioLibroConfigurarActivo_(activo) {
  PropertiesService.getScriptProperties().setProperty(INVENTARIO_LIBRO_PROP_ACTIVO_, activo ? 'true' : 'false');
  return activo
    ? 'Libro central de movimientos ACTIVO — los registros nuevos también escribirán en Movimientos_Inventario.'
    : 'Libro central de movimientos INACTIVO — solo las hojas operativas (comportamiento anterior).';
}

/** Expuesto vía API web — solo Administrador. */
function inventarioLibroConfigurarDesdeApi_(activo) {
  const mensaje = inventarioLibroConfigurarActivo_(activo === true);
  return { ok: true, data: inventarioLibroEstado_(), mensaje: mensaje };
}

function inventarioLibroEstado_() {
  return {
    activo: inventarioLibroActivo_(),
    filas_libro: leerTabla_(SHEET_NAMES.MOVIMIENTOS_INVENTARIO).length
  };
}

function inventarioMovimientoSigno_(tipoMovimiento) {
  const signo = MOVIMIENTO_TIPOS_SIGNO_[tipoMovimiento];
  if (signo === undefined) throw new Error('Tipo de movimiento no válido: ' + tipoMovimiento);
  return signo;
}

function inventarioMovimientoBuscarPorClave_(claveIdempotencia) {
  if (!claveIdempotencia) return null;
  return leerTabla_(SHEET_NAMES.MOVIMIENTOS_INVENTARIO).find(function (m) {
    return m.clave_idempotencia === claveIdempotencia && m.estado !== 'Anulado';
  }) || null;
}

function inventarioMovimientoValidar_(item) {
  if (!item || !item.tipo_movimiento || !item.producto || !item.unidad) {
    return 'Faltan tipo_movimiento, producto o unidad';
  }
  if (MOVIMIENTO_TIPOS_SIGNO_[item.tipo_movimiento] === undefined) {
    return 'Tipo de movimiento no válido: ' + item.tipo_movimiento;
  }
  const cantidadAbs = Math.abs(Number(item.cantidad));
  if (isNaN(cantidadAbs) || cantidadAbs <= 0) {
    return 'La cantidad debe ser un número mayor que cero';
  }
  if (!item.fecha) return 'Falta la fecha del movimiento';
  if (!item.sede && !item.sede_origen && !item.sede_destino) {
    return 'Falta la sede del movimiento';
  }
  if (!item.clave_idempotencia) return 'Falta clave_idempotencia';
  if (!item.entidad_tipo || !item.entidad_id) return 'Faltan entidad_tipo o entidad_id';
  return null;
}

function inventarioMovimientoFila_(item, usuario) {
  const signo = item.invertir_signo
    ? -inventarioMovimientoSigno_(item.tipo_movimiento)
    : inventarioMovimientoSigno_(item.tipo_movimiento);
  const cantidadAbs = Math.abs(Number(item.cantidad));
  const ahora = new Date();
  const sedePrincipal = item.sede || item.sede_destino || item.sede_origen || '';
  return neutralizarObjetoFormulas_({
    id: Utilities.getUuid(),
    fecha: formatearFecha_(item.fecha),
    timestamp: item.timestamp || ahora,
    catalogo_id: item.catalogo_id || '',
    producto: item.producto,
    cantidad: signo < 0 ? -cantidadAbs : cantidadAbs,
    unidad: item.unidad,
    signo: signo,
    tipo_movimiento: item.tipo_movimiento,
    ubicacion_origen: item.ubicacion_origen || '',
    ubicacion_destino: item.ubicacion_destino || '',
    sede_origen: item.sede_origen || '',
    sede_destino: item.sede_destino || '',
    sede: sedePrincipal,
    fuente: item.fuente || 'Amelia',
    entidad_tipo: item.entidad_tipo,
    entidad_id: item.entidad_id,
    clave_idempotencia: item.clave_idempotencia,
    estado: item.estado || 'Registrado',
    usuario_id: (usuario && usuario.id) || '',
    usuario_nombre: (usuario && usuario.nombre) || item.usuario || '',
    observacion: item.observacion || '',
    evidencia_url: item.evidencia_url || '',
    requiere_aprobacion: item.requiere_aprobacion === true,
    aprobado_por: item.aprobado_por || '',
    aprobado_en: item.aprobado_en || '',
    reversa_movimiento_id: item.reversa_movimiento_id || '',
    creado_en: ahora
  });
}

/**
 * Crea UN movimiento en Movimientos_Inventario. Idempotente por clave_idempotencia.
 * Nunca lanza — devuelve { ok, id?, repetido?, error? }.
 */
function inventarioMovimientoCrear_(item, usuario) {
  try {
    const error = inventarioMovimientoValidar_(item);
    if (error) return { ok: false, error: error };
    const existente = inventarioMovimientoBuscarPorClave_(item.clave_idempotencia);
    if (existente) return { ok: true, id: existente.id, repetido: true };

    const fila = inventarioMovimientoFila_(item, usuario);
    appendRowFromObj_(SHEET_NAMES.MOVIMIENTOS_INVENTARIO, fila);
    auditoriaRegistrar_(usuario, 'inventario_movimiento_creado', 'MovimientoInventario', fila.id,
      null, { tipo: fila.tipo_movimiento, producto: fila.producto, cantidad: fila.cantidad, sede: fila.sede },
      fila.sede, '');
    return { ok: true, id: fila.id };
  } catch (err) {
    Logger.log('inventarioMovimientoCrear_ falló: ' + err.message);
    return { ok: false, error: err.message };
  }
}

function inventarioMovimientoCrearLote_(items, usuario) {
  const resultados = { ok: true, creados: 0, repetidos: 0, errores: [] };
  (items || []).forEach(function (item) {
    const r = inventarioMovimientoCrear_(item, usuario);
    if (r.repetido) resultados.repetidos++;
    else if (r.ok) resultados.creados++;
    else resultados.errores.push(r.error || 'Error desconocido');
  });
  if (resultados.errores.length) resultados.ok = false;
  return resultados;
}

/**
 * Revierte un movimiento aprobado/registrado creando el movimiento inverso — nunca borra la fila original.
 */
function inventarioMovimientoRevertir_(movimientoId, usuario, motivo) {
  if (!movimientoId) return { ok: false, error: 'Falta el id del movimiento a revertir' };
  const original = leerTabla_(SHEET_NAMES.MOVIMIENTOS_INVENTARIO).find(function (m) { return m.id === movimientoId; });
  if (!original) return { ok: false, error: 'No se encontró el movimiento ' + movimientoId };
  if (original.estado === 'Revertido') return { ok: false, error: 'Este movimiento ya fue revertido' };
  if (original.estado === 'Anulado') return { ok: false, error: 'Este movimiento está anulado' };

  const claveReversa = 'reversa|' + movimientoId;
  if (inventarioMovimientoBuscarPorClave_(claveReversa)) {
    return { ok: false, error: 'Este movimiento ya tiene una reversión registrada' };
  }

  const itemReversa = {
    fecha: formatearFecha_(new Date()),
    producto: original.producto,
    cantidad: Math.abs(Number(original.cantidad)),
    unidad: original.unidad,
    tipo_movimiento: original.tipo_movimiento,
    invertir_signo: true,
    sede: original.sede,
    sede_origen: original.sede_destino,
    sede_destino: original.sede_origen,
    ubicacion_origen: original.ubicacion_destino,
    ubicacion_destino: original.ubicacion_origen,
    fuente: 'Reversión',
    entidad_tipo: 'MovimientoInventario',
    entidad_id: movimientoId,
    clave_idempotencia: claveReversa,
    observacion: 'Reversión de ' + movimientoId + (motivo ? ': ' + motivo : ''),
    reversa_movimiento_id: movimientoId
  };
  const resultado = inventarioMovimientoCrear_(itemReversa, usuario);
  if (!resultado.ok) return resultado;

  const sh = sheet_(SHEET_NAMES.MOVIMIENTOS_INVENTARIO);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const estadoCol = headers.indexOf('estado');
  for (let r = 1; r < data.length; r++) {
    if (data[r][idCol] === movimientoId) {
      sh.getRange(r + 1, estadoCol + 1).setValue('Revertido');
      break;
    }
  }
  auditoriaRegistrar_(usuario, 'inventario_movimiento_revertido', 'MovimientoInventario', movimientoId,
    { estado: original.estado }, { estado: 'Revertido', reversa_id: resultado.id }, original.sede, motivo || '');
  return { ok: true, reversa_id: resultado.id };
}

function inventarioMovimientosLibroListar_(filtros) {
  filtros = filtros || {};
  const indice = filtros.indice || indiceCatalogo_();
  let rows = leerTabla_(SHEET_NAMES.MOVIMIENTOS_INVENTARIO);
  if (filtros.fecha_desde) rows = rows.filter(function (m) { return formatearFecha_(m.fecha) >= filtros.fecha_desde; });
  if (filtros.fecha_hasta) rows = rows.filter(function (m) { return formatearFecha_(m.fecha) <= filtros.fecha_hasta; });
  if (filtros.sede && filtros.sede !== 'Ambas') {
    rows = rows.filter(function (m) {
      return m.sede === filtros.sede || m.sede_origen === filtros.sede || m.sede_destino === filtros.sede;
    });
  }
  if (filtros.producto) {
    const clave = claveProducto_(filtros.producto, indice);
    rows = rows.filter(function (m) { return claveProducto_(m.producto, indice) === clave; });
  }
  if (filtros.entidad_tipo) rows = rows.filter(function (m) { return m.entidad_tipo === filtros.entidad_tipo; });
  if (filtros.entidad_id) rows = rows.filter(function (m) { return m.entidad_id === filtros.entidad_id; });
  return rows.sort(function (a, b) {
    const ta = new Date(a.timestamp || a.fecha);
    const tb = new Date(b.timestamp || b.fecha);
    return tb - ta;
  });
}

/** Convierte un movimiento de la vista calculada al formato del libro físico. */
function inventarioLibroItemDesdeVista_(vista, meta) {
  meta = meta || {};
  const cantidadAbs = Math.abs(Number(vista.cantidad) || 0);
  const esSalida = Number(vista.cantidad) < 0;
  return {
    fecha: vista.fecha,
    producto: vista.producto,
    cantidad: cantidadAbs,
    unidad: vista.unidad,
    tipo_movimiento: vista.tipo_movimiento,
    sede: vista.sede,
    sede_origen: esSalida ? vista.sede : (meta.sede_origen || ''),
    sede_destino: esSalida ? '' : vista.sede,
    ubicacion_origen: vista.ubicacion_origen || '',
    ubicacion_destino: vista.ubicacion_destino || '',
    fuente: meta.fuente || 'Amelia',
    entidad_tipo: meta.entidad_tipo,
    entidad_id: meta.entidad_id || vista.documento_relacionado,
    clave_idempotencia: meta.clave_idempotencia,
    estado: vista.estado === 'Avalado' ? 'Avalado' : 'Registrado',
    usuario: vista.usuario,
    observacion: meta.observacion || '',
    evidencia_url: meta.evidencia_url || vista.evidencia_url || ''
  };
}

function inventarioLibroClave_(entidadTipo, entidadId, tipoMovimiento, secuencia) {
  return [entidadTipo, entidadId, tipoMovimiento, secuencia || 0].join('|');
}

/**
 * Dual-write: Ajuste_Inventario → libro. Nunca bloquea el registro operativo — errores van al log.
 */
function inventarioLibroIntentarDesdeAjuste_(filaAjuste, usuario) {
  if (!inventarioLibroActivo_()) return;
  try {
    const TIPO_A_MOVIMIENTO = {
      'Compra cruda': 'Compra recibida',
      'Merma / desperdicio': 'Merma en sede',
      'Ajuste operativo': 'Ajuste autorizado'
    };
    const tipoMov = TIPO_A_MOVIMIENTO[filaAjuste.tipo] || 'Ajuste autorizado';
    const esSalida = tipoMov === 'Merma en sede';
    const ubic = movimientoUbicacion_(filaAjuste.sede, filaAjuste.punto);
    inventarioMovimientoCrear_(inventarioLibroItemDesdeVista_({
      fecha: formatearFecha_(filaAjuste.fecha),
      producto: filaAjuste.producto,
      cantidad: esSalida ? -Number(filaAjuste.cantidad) : Number(filaAjuste.cantidad),
      unidad: filaAjuste.unidad,
      sede: filaAjuste.sede,
      ubicacion_origen: esSalida ? ubic : '',
      ubicacion_destino: esSalida ? '' : ubic,
      tipo_movimiento: tipoMov,
      usuario: filaAjuste.usuario,
      documento_relacionado: filaAjuste.id,
      estado: filaAjuste.avalado ? 'Avalado' : 'Registrado'
    }, {
      entidad_tipo: 'Ajuste',
      entidad_id: filaAjuste.id,
      clave_idempotencia: inventarioLibroClave_('Ajuste', filaAjuste.id, tipoMov, 0),
      observacion: filaAjuste.motivo || '',
      evidencia_url: filaAjuste.evidencia_url || ''
    }), usuario);
  } catch (err) {
    Logger.log('inventarioLibroIntentarDesdeAjuste_ falló para ' + filaAjuste.id + ': ' + err.message);
  }
}

function inventarioLibroIntentarDesdeProduccion_(filaProd, usuario) {
  if (!inventarioLibroActivo_()) return;
  try {
    const movimientos = movimientosDesdeProduccion_().filter(function (m) {
      return m.documento_relacionado === filaProd.id;
    });
    // movimientosDesdeProduccion_ lee TODA la hoja — filtrar solo los de esta fila recién escrita
    // puede fallar si hay otra con mismo id (imposible). Mejor generar inline como la vista:
    const items = [];
    const base = {
      fecha: formatearFecha_(filaProd.fecha),
      sede: filaProd.sede,
      usuario: filaProd.usuario,
      documento_relacionado: filaProd.id
    };
    items.push(Object.assign({}, base, {
      producto: filaProd.item,
      cantidad: Math.abs(Number(filaProd.cantidad)),
      unidad: filaProd.unidad,
      ubicacion_origen: '',
      ubicacion_destino: movimientoUbicacion_(filaProd.sede, 'Productos terminados'),
      tipo_movimiento: 'Entrada por producción'
    }));
    if (filaProd.insumo_producto && filaProd.insumo_cantidad !== '' && filaProd.insumo_cantidad != null) {
      items.push(Object.assign({}, base, {
        producto: filaProd.insumo_producto,
        cantidad: -Math.abs(Number(filaProd.insumo_cantidad)),
        unidad: filaProd.insumo_unidad,
        ubicacion_origen: movimientoUbicacion_(filaProd.sede, 'Materia prima cruda'),
        ubicacion_destino: '',
        tipo_movimiento: 'Consumo de producción'
      }));
    }
    if (filaProd.merma_cantidad !== '' && filaProd.merma_cantidad != null && Number(filaProd.merma_cantidad) > 0) {
      items.push(Object.assign({}, base, {
        producto: (filaProd.insumo_producto || filaProd.item) + ' — merma de producción',
        cantidad: -Math.abs(Number(filaProd.merma_cantidad)),
        unidad: filaProd.merma_unidad || filaProd.unidad,
        ubicacion_origen: movimientoUbicacion_(filaProd.sede, 'Mermas de producción'),
        ubicacion_destino: '',
        tipo_movimiento: 'Merma de producción'
      }));
    }
    items.forEach(function (vista, i) {
      inventarioMovimientoCrear_(inventarioLibroItemDesdeVista_(vista, {
        entidad_tipo: 'Produccion',
        entidad_id: filaProd.id,
        clave_idempotencia: inventarioLibroClave_('Produccion', filaProd.id, vista.tipo_movimiento, i)
      }), usuario);
    });
  } catch (err) {
    Logger.log('inventarioLibroIntentarDesdeProduccion_ falló para ' + filaProd.id + ': ' + err.message);
  }
}

function inventarioLibroIntentarDesdeTraslado_(filaTraslado, usuario, evento) {
  if (!inventarioLibroActivo_()) return;
  try {
    if (evento === 'enviado') {
      inventarioMovimientoCrear_(inventarioLibroItemDesdeVista_({
        fecha: formatearFecha_(filaTraslado.fecha),
        producto: filaTraslado.producto,
        cantidad: -Math.abs(Number(filaTraslado.cantidad_enviada)),
        unidad: filaTraslado.unidad,
        sede: filaTraslado.sede_origen,
        ubicacion_origen: movimientoUbicacion_(filaTraslado.sede_origen, filaTraslado.punto_origen),
        ubicacion_destino: movimientoUbicacion_(filaTraslado.sede_destino, filaTraslado.punto_destino),
        tipo_movimiento: 'Traslado enviado',
        usuario: filaTraslado.usuario_envia,
        documento_relacionado: filaTraslado.id,
        estado: filaTraslado.estado
      }, {
        entidad_tipo: 'Traslado',
        entidad_id: filaTraslado.id,
        clave_idempotencia: inventarioLibroClave_('Traslado', filaTraslado.id, 'Traslado enviado', 0),
        sede_origen: filaTraslado.sede_origen
      }), usuario);
    } else if (evento === 'recibido') {
      const cantidadRecibida = filaTraslado.cantidad_recibida !== '' && filaTraslado.cantidad_recibida != null
        ? Number(filaTraslado.cantidad_recibida) : Number(filaTraslado.cantidad_enviada);
      inventarioMovimientoCrear_(inventarioLibroItemDesdeVista_({
        fecha: formatearFecha_(filaTraslado.timestamp_recibe || filaTraslado.fecha),
        producto: filaTraslado.producto,
        cantidad: Math.abs(cantidadRecibida || 0),
        unidad: filaTraslado.unidad,
        sede: filaTraslado.sede_destino,
        ubicacion_origen: movimientoUbicacion_(filaTraslado.sede_origen, filaTraslado.punto_origen),
        ubicacion_destino: movimientoUbicacion_(filaTraslado.sede_destino, filaTraslado.punto_destino),
        tipo_movimiento: 'Traslado recibido',
        usuario: filaTraslado.usuario_recibe,
        documento_relacionado: filaTraslado.id,
        estado: filaTraslado.estado
      }, {
        entidad_tipo: 'Traslado',
        entidad_id: filaTraslado.id,
        clave_idempotencia: inventarioLibroClave_('Traslado', filaTraslado.id, 'Traslado recibido', 0),
        sede_destino: filaTraslado.sede_destino
      }), usuario);
    }
  } catch (err) {
    Logger.log('inventarioLibroIntentarDesdeTraslado_ falló para ' + filaTraslado.id + ': ' + err.message);
  }
}

/**
 * Simula migrar el histórico de la vista calculada al libro físico — NO escribe nada.
 * Idempotente: detecta claves que ya existirían en Movimientos_Inventario.
 */
function migracionInventarioEntidadTipo_(tipoMovimiento) {
  if (['Compra recibida', 'Merma en sede', 'Ajuste autorizado'].indexOf(tipoMovimiento) !== -1) return 'Ajuste';
  if (['Entrada por producción', 'Consumo de producción', 'Merma de producción'].indexOf(tipoMovimiento) !== -1) return 'Produccion';
  if (['Traslado enviado', 'Traslado recibido'].indexOf(tipoMovimiento) !== -1) return 'Traslado';
  return 'Movimiento';
}

function migracionInventarioClaveDesdeMovimiento_(mov) {
  return inventarioLibroClave_(migracionInventarioEntidadTipo_(mov.tipo_movimiento), mov.documento_relacionado, mov.tipo_movimiento, 0);
}

/**
 * Planifica qué movimientos de la vista calculada faltan en el libro físico.
 * Usa movimientosInventarioListar_ como única fuente — misma lógica que verá el usuario en
 * libro-inventario.html y la que usará migracionInventarioEjecutar_.
 */
function migracionInventarioPlanificar_() {
  const clavesExistentes = {};
  leerTabla_(SHEET_NAMES.MOVIMIENTOS_INVENTARIO).forEach(function (m) {
    if (m.clave_idempotencia) clavesExistentes[m.clave_idempotencia] = true;
  });

  const reporte = {
    encontrados: 0,
    migrables: 0,
    omitidos_duplicado: 0,
    pendiente_mapeo: 0,
    error: 0,
    detalle_errores: []
  };
  const pendientes = [];

  movimientosInventarioListar_({}).forEach(function (mov) {
    reporte.encontrados++;
    const clave = migracionInventarioClaveDesdeMovimiento_(mov);
    if (clavesExistentes[clave]) {
      reporte.omitidos_duplicado++;
      return;
    }
    if (!mov.producto || !String(mov.producto).trim()) {
      reporte.error++;
      reporte.detalle_errores.push({ clave: clave, motivo: 'Sin producto' });
      return;
    }
    if (!mov.sede) {
      reporte.pendiente_mapeo++;
      return;
    }
    const c = Number(mov.cantidad);
    if (isNaN(c) || c === 0) {
      reporte.error++;
      reporte.detalle_errores.push({ clave: clave, motivo: 'Cantidad inválida' });
      return;
    }
    reporte.migrables++;
    clavesExistentes[clave] = true;
    pendientes.push({
      clave: clave,
      mov: mov,
      entidadTipo: migracionInventarioEntidadTipo_(mov.tipo_movimiento)
    });
  });

  return { pendientes: pendientes, reporte: reporte };
}

function migracionInventarioSimular_() {
  const plan = migracionInventarioPlanificar_();
  return { ok: true, simulacion: true, reporte: plan.reporte };
}

/**
 * Migra el histórico de la vista calculada al libro físico Movimientos_Inventario.
 * Idempotente por clave_idempotencia — se puede volver a correr sin duplicar filas.
 * Solo Administrador (vía Code.gs). NO activa el dual-write automático.
 */
function migracionInventarioEjecutar_(usuario) {
  const plan = migracionInventarioPlanificar_();
  const resultado = { creados: 0, repetidos: 0, errores: [] };

  plan.pendientes.forEach(function (p) {
    const item = inventarioLibroItemDesdeVista_(p.mov, {
      entidad_tipo: p.entidadTipo,
      entidad_id: p.mov.documento_relacionado,
      clave_idempotencia: p.clave,
      fuente: 'Migración histórica'
    });
    const r = inventarioMovimientoCrear_(item, usuario);
    if (r.repetido) resultado.repetidos++;
    else if (r.ok) resultado.creados++;
    else resultado.errores.push(r.error || 'Error desconocido');
  });

  return {
    ok: resultado.errores.length === 0,
    simulacion: false,
    reporte: Object.assign({}, plan.reporte, {
      creados: resultado.creados,
      repetidos: resultado.repetidos,
      errores_ejecucion: resultado.errores.length
    }),
    errores: resultado.errores
  };
}
