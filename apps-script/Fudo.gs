/**
 * IMPORTACIÓN DE REPORTES DE FUDO
 * El navegador (frontend) lee el .xls/.xlsx con SheetJS y envía las filas ya como JSON —
 * Apps Script nunca necesita abrir el archivo binario, solo recibe arrays de objetos.
 *
 * tipo: 'movimientos' | 'ventas'
 * filas: array de objetos ya parseados en el navegador con las columnas que trae cada reporte.
 */

function importarFudo_(tipo, filas, usuario) {
  if (!tipo || !filas || !filas.length) return { ok: false, error: 'Falta tipo o filas' };
  const ahora = new Date();

  if (tipo === 'movimientos') {
    filas.forEach(function (f) {
      appendRowFromObj_(SHEET_NAMES.MOVIMIENTOS_FUDO, {
        fecha: f['Fecha'],
        tipo: f['Tipo'],
        evento: f['Evento'],
        nombre: f['Nombre'],
        stock_anterior: f['Stock Anterior'],
        stock_actual: f['Stock Actual'],
        diferencia: f['Diferencia'],
        usuario: f['Usuario'],
        costo: f['Costo'],
        importado_por: usuario.nombre,
        importado_en: ahora
      });
    });
    return { ok: true, importados: filas.length, tipo: tipo };
  }

  if (tipo === 'ventas') {
    filas.forEach(function (f) {
      appendRowFromObj_(SHEET_NAMES.VENTAS_FUDO, {
        id_venta: f['Id. Venta'],
        creacion: f['Creación'],
        producto: f['Producto'],
        categoria: f['Categoría'],
        cantidad: f['Cantidad'],
        precio: f['Precio'],
        cancelada: f['Cancelada'],
        creada_por: f['Creada por'],
        sede: sedeDesdeCreadaPor_(f['Creada por']),
        importado_en: ahora
      });
    });
    return { ok: true, importados: filas.length, tipo: tipo };
  }

  return { ok: false, error: 'Tipo de importación no reconocido: ' + tipo };
}

/**
 * FUDO no tiene un campo de "sede" explícito -- se infiere del usuario/terminal que registró la venta.
 * AJUSTA ESTA LISTA si cambian los nombres de caja/terminal en FUDO.
 */
function sedeDesdeCreadaPor_(creadaPor) {
  const valor = normalizar_(creadaPor);
  const capri = ['cajacapri', 'terrazacapri', 'caja capri'];
  const sanAntonio = ['terraza', 'caja', 'caja san antonio', 'terraza san antonio'];
  if (capri.indexOf(valor) !== -1) return 'Capri';
  if (sanAntonio.indexOf(valor) !== -1) return 'San Antonio';
  return 'Sin identificar';
}
