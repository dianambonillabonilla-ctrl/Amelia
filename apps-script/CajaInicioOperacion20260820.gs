/**
 * INICIO OPERATIVO OFICIAL DE CAJA — 20/08/2026
 *
 * El módulo Caja comienza su historia propia el 20 de agosto de 2026. Los registros
 * DILANA anteriores se archivan y salen de los cálculos activos, pero FUDO NO se corta:
 * mientras todavía no exista un cierre DILANA posterior al corte, la apertura usa el
 * día FUDO inmediatamente anterior como referencia TOTAL de efectivo bajo custodia.
 *
 * Importante: FUDO no sabe cómo quedó repartido el efectivo entre caja operativa y caja
 * fuerte. Por eso la referencia inicial es una sola cifra total. El primer conteo físico
 * del nuevo sistema fija la distribución real y, desde ese cierre en adelante, DILANA
 * encadena caja operativa y caja fuerte normalmente.
 */
const CAJA_FECHA_INICIO_OFICIAL_ = '2026-08-20';
const CAJA_ARCHIVO_TURNOS_PRE_INICIO_ = 'Caja_Turno_Archivo_Pre20260820';
const CAJA_ARCHIVO_MOVIMIENTOS_PRE_INICIO_ = 'Caja_Movimientos_Archivo_Pre20260820';
const CAJA_COLUMNAS_INICIO_OPERACION_ = [
  'tipo_referencia_apertura','fecha_referencia_apertura','referencia_total_apertura',
  'efectivo_fudo_referencia_apertura','gastos_fudo_referencia_apertura','referencia_fudo_confirmada_apertura'
];

function cajaFechaEsAnteriorInicioOficial_(valor) {
  const fecha = formatearFecha_(valor);
  return !!fecha && fecha < CAJA_FECHA_INICIO_OFICIAL_;
}

function cajaFechaOperacionPermitida_(valor) {
  const fecha = formatearFecha_(valor);
  return !!fecha && fecha >= CAJA_FECHA_INICIO_OFICIAL_;
}

function cajaAsegurarColumnasInicioOperacion_() {
  asegurarColumnas_(sheet_(SHEET_NAMES.CAJA_TURNO), CAJA_COLUMNAS_INICIO_OPERACION_);
}

function cajaSepararFilasPorInicioOficial_(encabezados, filas) {
  const idxFecha = encabezados.indexOf('fecha');
  if (idxFecha < 0) throw new Error('La hoja de Caja no tiene columna fecha.');
  const anteriores = [];
  const vigentes = [];
  (filas || []).forEach(function (fila) {
    if (cajaFechaEsAnteriorInicioOficial_(fila[idxFecha])) anteriores.push(fila);
    else vigentes.push(fila);
  });
  return { anteriores: anteriores, vigentes: vigentes };
}

function cajaArchivarFilasAnterioresInicio_(nombreHojaActiva, nombreHojaArchivo) {
  const origen = sheet_(nombreHojaActiva);
  const valores = origen.getDataRange().getValues();
  if (!valores.length) return { archivadas:0, retiradas:0 };

  const encabezados = valores[0];
  const filas = valores.slice(1);
  const separadas = cajaSepararFilasPorInicioOficial_(encabezados, filas);
  if (!separadas.anteriores.length) return { archivadas:0, retiradas:0 };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let archivo = ss.getSheetByName(nombreHojaArchivo);
  if (!archivo) archivo = ss.insertSheet(nombreHojaArchivo);

  if (archivo.getLastRow() === 0) {
    archivo.getRange(1,1,1,encabezados.length).setValues([encabezados]);
    archivo.setFrozenRows(1);
  }

  const idxId = encabezados.indexOf('id');
  const existentes = {};
  if (idxId >= 0 && archivo.getLastRow() > 1) {
    const datosArchivo = archivo.getRange(2,1,archivo.getLastRow()-1,encabezados.length).getValues();
    datosArchivo.forEach(function (fila) {
      const id = String(fila[idxId] || '');
      if (id) existentes[id] = true;
    });
  }

  const nuevas = separadas.anteriores.filter(function (fila) {
    if (idxId < 0) return true;
    const id = String(fila[idxId] || '');
    return !id || !existentes[id];
  });

  if (nuevas.length) {
    archivo.getRange(archivo.getLastRow()+1,1,nuevas.length,encabezados.length).setValues(nuevas);
  }

  // Se eliminan desde abajo para conservar los números de fila durante el recorrido.
  const idxFecha = encabezados.indexOf('fecha');
  let retiradas = 0;
  for (let i = valores.length - 1; i >= 1; i--) {
    if (cajaFechaEsAnteriorInicioOficial_(valores[i][idxFecha])) {
      origen.deleteRow(i + 1);
      retiradas++;
    }
  }

  return { archivadas:nuevas.length, retiradas:retiradas };
}

/**
 * Referencia económica de arranque cuando todavía no existe cierre DILANA previo:
 * efectivo cobrado en FUDO del día anterior menos gastos FUDO en efectivo que impactan arqueo.
 * No asigna esa cifra a caja operativa ni a caja fuerte; es referencia TOTAL.
 */
function cajaReferenciaFudoDiaAnterior_(fecha, sede) {
  const fechaFmt = formatearFecha_(fecha);
  const fechaRef = cajaDiaAnteriorReactivacion_(fechaFmt);
  const sync = cajaLeerEstadoFudo_(fechaRef, sede);
  const confirmado = !!(sync && sync.ok && sync.aplica !== false);
  const resumen = typeof turnoResumenCierre_ === 'function'
    ? turnoResumenCierre_(fechaRef, sede)
    : { pagos_efectivo_esperado:0, pagos_fudo_total:0, ventas_fudo_total:0 };
  const gastos = typeof fudoGastosArqueoTotalDia_ === 'function'
    ? fudoGastosArqueoTotalDia_(fechaRef, sede)
    : { total:0, cantidad:0 };
  const efectivo = Number(resumen.pagos_efectivo_esperado) || 0;
  const gastosEfectivo = Number(gastos.total) || 0;
  return {
    fecha_referencia:fechaRef,
    confirmado:confirmado,
    sincronizacion:sync,
    efectivo_fudo:Number(efectivo.toFixed(2)),
    gastos_fudo_efectivo:Number(gastosEfectivo.toFixed(2)),
    referencia_total:Number((efectivo-gastosEfectivo).toFixed(2)),
    ventas_total:Number(resumen.ventas_fudo_total)||0,
    pagos_total:Number(resumen.pagos_fudo_total)||0,
    gastos_cantidad:Number(gastos.cantidad)||0
  };
}

/** Devuelve true mientras la sede todavía no tenga un cierre DILANA desde el corte oficial. */
function cajaUsaReferenciaFudoInicial_(fecha, sede) {
  const fechaFmt = formatearFecha_(fecha);
  if (fechaFmt < CAJA_FECHA_INICIO_OFICIAL_) return false;
  return !cajaUltimoCierreAntes_(fechaFmt, sede);
}

/**
 * Ejecutar UNA sola vez después de desplegar esta versión.
 *
 * 1. Archiva y retira de Caja_Turno/Caja_Movimientos lo anterior al 20/08/2026.
 * 2. Desactiva las migraciones históricas antiguas de Caja.
 * 3. Sincroniza FUDO del 19/08/2026 para ambas sedes y deja lista la referencia inicial.
 *
 * Es idempotente: ejecutar de nuevo no duplica el archivo histórico.
 */
function cajaInicializarOperacionDesde20Agosto2026() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Otra inicialización de Caja está en curso.');
  let turnos, movimientos;
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('CAJA_MIGRACION_HISTORICA_HECHA', 'true');
    props.setProperty('CAJA_FECHA_INICIO_OPERACION', CAJA_FECHA_INICIO_OFICIAL_);
    cajaAsegurarColumnasInicioOperacion_();
    turnos = cajaArchivarFilasAnterioresInicio_(SHEET_NAMES.CAJA_TURNO, CAJA_ARCHIVO_TURNOS_PRE_INICIO_);
    movimientos = cajaArchivarFilasAnterioresInicio_(SHEET_NAMES.CAJA_MOVIMIENTOS, CAJA_ARCHIVO_MOVIMIENTOS_PRE_INICIO_);
  } finally {
    lock.releaseLock();
  }

  // La API se consulta fuera del candado: los importadores FUDO pueden usar sus propios locks.
  const usuarioSistema = { id:'sistema-caja-inicio', nombre:'Inicialización Caja 20/08/2026', rol:'Administrador', sede:'Ambas' };
  const referencias = {};
  ['San Antonio','Capri'].forEach(function (sede) {
    const sync = cajaSincronizarFudo_('2026-08-19', sede, usuarioSistema, true);
    referencias[sede] = {
      sincronizacion:sync,
      referencia:cajaReferenciaFudoDiaAnterior_(CAJA_FECHA_INICIO_OFICIAL_, sede)
    };
  });

  return {
    ok:true,
    fecha_inicio:CAJA_FECHA_INICIO_OFICIAL_,
    turnos:turnos,
    movimientos:movimientos,
    referencias:referencias,
    mensaje:'Caja inicia el 20/08/2026. La historia DILANA anterior quedó archivada y FUDO del 19/08 quedó como referencia total para el primer conteo físico.'
  };
}
