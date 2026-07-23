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
  // sedeEscrituraPermitida_ (Code.gs) también deja registrar en Centro de Producción sin importar
  // la sede propia — San Antonio/Capri/Ambas cubren ese sitio en la práctica.
  if (items.some(function (it) { return !sedeEscrituraPermitida_(usuario, it.sede); })) {
    return { ok: false, error: 'No puedes registrar conteos para una sede distinta a la tuya (' + usuario.sede + ')' };
  }

  const faltantes = productosObligatoriosFaltantes_(items);
  if (faltantes.length) {
    return { ok: false, error: 'Faltan productos obligatorios de hoy: ' + faltantes.join(', ') };
  }

  const ahora = new Date();
  let n = 0;
  let actualizados = 0;
  items.forEach(function (it) {
    const datos = {
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
    };
    catalogoAsegurar_(it.producto, it.unidad);
    const existente = conteoBuscarFila_(it);
    if (existente) {
      existente.headers.forEach(function (h, c) {
        if (h === 'id') return;
        if (datos[h] !== undefined) existente.sh.getRange(existente.fila, c + 1).setValue(datos[h]);
      });
      actualizados++;
    } else {
      appendRowFromObj_(SHEET_NAMES.CONTEOS, datos);
    }
    n++;
  });

  try {
    revisarAlertas_(items[0].fecha);
  } catch (err) {
    Logger.log('revisarAlertas_ falló tras conteo_registrar: ' + err.message);
  }

  return { ok: true, registrados: n, actualizados: actualizados };
}

/**
 * Espejo servidor del bloqueo que ya hace conteo.html (marca * y deshabilita Guardar): agrupa
 * `items` por sesión de cierre (fecha + sede + punto_conteo) y, para cada una, revisa que estén
 * todos los productos de la lista fija que toca ese día (Diario siempre; Miércoles/Viernes según
 * el día de la semana; Mensual del 1 al 5 del mes — ver frecuenciasObligatoriasDelDia_ en
 * Catalogo.gs). Existe para que la regla se cumpla también si alguien llama a conteo_registrar
 * directo (sin pasar por la pantalla), no solo como ayuda visual en el navegador.
 */
function productosObligatoriosFaltantes_(items) {
  const sesiones = {};
  items.forEach(function (it) {
    const clave = [it.fecha, it.sede, it.punto_conteo || ''].join('|');
    if (!sesiones[clave]) sesiones[clave] = { fecha: it.fecha, productos: {} };
    sesiones[clave].productos[normalizar_(it.producto)] = true;
  });

  const catalogo = leerTabla_(SHEET_NAMES.CATALOGO);
  const faltantes = {};
  Object.keys(sesiones).forEach(function (clave) {
    const sesion = sesiones[clave];
    const frecuencias = frecuenciasObligatoriasDelDia_(sesion.fecha);
    catalogo
      .filter(function (p) { return p.frecuencia_conteo && frecuencias.indexOf(p.frecuencia_conteo) !== -1; })
      .filter(function (p) { return !sesion.productos[normalizar_(p.nombre_estandar)]; })
      .forEach(function (p) { faltantes[p.nombre_estandar] = true; });
  });
  return Object.keys(faltantes);
}

/** Un nuevo conteo del mismo cierre corrige el anterior, no se suma a él. */
function conteoBuscarFila_(item) {
  const sh = sheet_(SHEET_NAMES.CONTEOS);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0];
  const col = function (nombre) { return headers.indexOf(nombre); };
  for (let r = data.length - 1; r >= 1; r--) {
    const fila = data[r];
    if (formatearFecha_(fila[col('fecha')]) === item.fecha &&
      fila[col('sede')] === item.sede &&
      fila[col('punto_conteo')] === (item.punto_conteo || 'Café') &&
      fila[col('turno')] === (item.turno || 'Cierre de turno') &&
      normalizar_(fila[col('producto')]) === normalizar_(item.producto)) {
      return { sh: sh, headers: headers, fila: r + 1 };
    }
  }
  return null;
}

function conteoListar_(fecha, sede) {
  let rows = leerTabla_(SHEET_NAMES.CONTEOS);
  if (fecha) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) === fecha; });
  if (sede) rows = rows.filter(function (r) { return r.sede === sede; });
  return rows;
}

/**
 * Histórico completo de conteos (a diferencia de conteoListar_, que solo sirve para UN día): por
 * rango de fechas, sede (vacío o 'Ambas' = todas las sedes, no filtra), punto de conteo y/o
 * búsqueda por nombre de producto. Más reciente primero por timestamp de registro (no por fecha
 * del conteo, para que dos conteos del mismo día se ordenen por cuál se guardó después).
 * fechaDesde/fechaHasta acotan por defecto quién llama esto (ver historial-conteos.html) para no
 * traer toda la hoja de una vez si crece mucho con el tiempo.
 */
function conteosHistorial_(filtros) {
  filtros = filtros || {};
  let rows = leerTabla_(SHEET_NAMES.CONTEOS);
  if (filtros.fecha_desde) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) >= filtros.fecha_desde; });
  if (filtros.fecha_hasta) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) <= filtros.fecha_hasta; });
  if (filtros.sede && filtros.sede !== 'Ambas') rows = rows.filter(function (r) { return r.sede === filtros.sede; });
  if (filtros.punto_conteo) rows = rows.filter(function (r) { return r.punto_conteo === filtros.punto_conteo; });
  if (filtros.producto) {
    const q = normalizar_(filtros.producto);
    rows = rows.filter(function (r) { return normalizar_(r.producto).indexOf(q) !== -1; });
  }
  return rows.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
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
