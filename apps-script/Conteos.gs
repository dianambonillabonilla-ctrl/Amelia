/**
 * CONTEOS MANUALES
 * Reemplaza las hojas "Diario" / "Miercoles" / "Viernes" de los Excel de inventario.
 * Cada fila es UN producto contado, en UNA sede, en UN cierre de turno.
 */

function conteoRegistrar_(items, usuario) {
  if (!items || !items.length) return { ok: false, error: 'No se recibieron items para registrar' };
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    if (!it.fecha || !it.sede || !it.producto || !it.unidad) {
      return { ok: false, error: 'Cada conteo debe tener fecha, sede, producto y unidad' };
    }
    if (isNaN(Number(it.cantidad)) || Number(it.cantidad) < 0) {
      return { ok: false, error: 'La cantidad contada debe ser un número igual o mayor que cero' };
    }
  }
  if (usuario.sede !== 'Ambas' && items.some(function (it) { return it.sede !== usuario.sede; })) {
    return { ok: false, error: 'No puedes registrar conteos para una sede distinta a la tuya (' + usuario.sede + ')' };
  }

  const ahora = new Date();
  let n = 0;
  items.forEach(function (it) {
    appendRowFromObj_(SHEET_NAMES.CONTEOS, {
      id: Utilities.getUuid(),
      fecha: it.fecha,
      sede: it.sede,
      punto_conteo: it.punto_conteo || 'Café',
      turno: it.turno || 'Cierre de turno',
      producto: it.producto,
      unidad: it.unidad,
      cantidad: it.cantidad,
      usuario: usuario.nombre,
      timestamp: ahora
    });
    n++;
  });

  try {
    revisarAlertas_(items[0].fecha);
  } catch (err) {
    Logger.log('revisarAlertas_ falló tras conteo_registrar: ' + err.message);
  }

  return { ok: true, registrados: n };
}

function conteoListar_(fecha, sede) {
  let rows = leerTabla_(SHEET_NAMES.CONTEOS);
  if (fecha) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) === fecha; });
  if (sede) rows = rows.filter(function (r) { return r.sede === sede; });
  return rows;
}

function formatearFecha_(valor) {
  if (!valor) return '';
  const d = (valor instanceof Date) ? valor : new Date(valor);
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'America/Bogota', 'yyyy-MM-dd');
}

/**
 * Suma el conteo de todas las sedes para un producto en una fecha dada.
 * Es la base de "cuánto hay realmente", ya que el stock físico total no vive en ninguna
 * sede sola sino en la suma de Café San Antonio + Café Capri + Centro Producción.
 */
function conteoTotalPorProducto_(fecha) {
  const rows = conteoListar_(fecha, null);
  const totales = {};
  rows.forEach(function (r) {
    const key = r.producto;
    if (!totales[key]) totales[key] = { producto: key, unidad: r.unidad, cantidad: 0, sedes: {} };
    totales[key].cantidad += Number(r.cantidad) || 0;
    totales[key].sedes[r.sede] = (totales[key].sedes[r.sede] || 0) + (Number(r.cantidad) || 0);
  });
  return totales;
}
