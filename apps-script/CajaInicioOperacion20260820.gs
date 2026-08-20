/**
 * INICIO OPERATIVO OFICIAL DE CAJA — 20/08/2026
 *
 * Diana definió que el módulo Caja arranca desde cero el 20 de agosto de 2026.
 * Todo registro anterior se conserva únicamente como archivo histórico y se retira
 * de las hojas activas que alimentan los cálculos de Caja.
 */
const CAJA_FECHA_INICIO_OFICIAL_ = '2026-08-20';
const CAJA_ARCHIVO_TURNOS_PRE_INICIO_ = 'Caja_Turno_Archivo_Pre20260820';
const CAJA_ARCHIVO_MOVIMIENTOS_PRE_INICIO_ = 'Caja_Movimientos_Archivo_Pre20260820';

function cajaFechaEsAnteriorInicioOficial_(valor) {
  const fecha = formatearFecha_(valor);
  return !!fecha && fecha < CAJA_FECHA_INICIO_OFICIAL_;
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
 * Ejecutar UNA sola vez después de desplegar esta versión.
 *
 * - Archiva y retira de Caja_Turno todo lo anterior al 20/08/2026.
 * - Archiva y retira de Caja_Movimientos todo lo anterior al 20/08/2026.
 * - Marca la migración histórica antigua como terminada para que no vuelva a insertar
 *   movimientos de agosto previos al nuevo inicio operativo.
 *
 * Es idempotente: si se ejecuta otra vez, no vuelve a copiar filas ya retiradas.
 */
function cajaInicializarOperacionDesde20Agosto2026() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Otra inicialización de Caja está en curso.');
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('CAJA_MIGRACION_HISTORICA_HECHA', 'true');
    props.setProperty('CAJA_FECHA_INICIO_OPERACION', CAJA_FECHA_INICIO_OFICIAL_);

    const turnos = cajaArchivarFilasAnterioresInicio_(SHEET_NAMES.CAJA_TURNO, CAJA_ARCHIVO_TURNOS_PRE_INICIO_);
    const movimientos = cajaArchivarFilasAnterioresInicio_(SHEET_NAMES.CAJA_MOVIMIENTOS, CAJA_ARCHIVO_MOVIMIENTOS_PRE_INICIO_);

    return {
      ok:true,
      fecha_inicio:CAJA_FECHA_INICIO_OFICIAL_,
      turnos:turnos,
      movimientos:movimientos,
      mensaje:'Caja quedó inicializada desde el 20/08/2026. Los registros anteriores quedaron archivados y fuera de los cálculos activos.'
    };
  } finally {
    lock.releaseLock();
  }
}
