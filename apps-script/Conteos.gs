/**
 * CONTEOS MANUALES
 * Reemplaza las hojas "Diario" / "Miercoles" / "Viernes" de los Excel de inventario.
 * Cada fila es UN producto contado, en UNA sede, en UN cierre de turno.
 */

function conteoRegistrar_(items, usuario, opciones) {
  opciones = opciones || {};
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

  // productosObligatoriosFaltantes_ asume que este envío ES la sesión completa de conteo de ese
  // (fecha, sede, punto) — exige TODOS los productos Diario/Miércoles/Viernes/Mensual de hoy ahí
  // mismo. producir.html reutiliza esta misma acción para guardar los insumos obligatorios de
  // cocina (vinagre balsámico, salsa de soya, sal marina...) como un envío APARTE, no como el
  // cierre del día — exigirle también el resto de la lista diaria ahí bloquearía guardar
  // producción sin motivo.
  if (!opciones.omitir_obligatorios_del_dia) {
    const faltantes = productosObligatoriosFaltantes_(items);
    if (faltantes.length) {
      return { ok: false, error: 'Faltan productos obligatorios de hoy: ' + faltantes.join(', ') };
    }
  }

  // A qué 'turno' pertenece este envío si no lo trae explícito — 'Inicio de turno' si ayer no se
  // cerró el turno de esta sede y el sector de hoy de quien guarda todavía no completó su conteo
  // de inicio; 'Cierre de turno' en cualquier otro caso (el comportamiento de siempre). Se calcula
  // UNA vez por envío (todos los items de un mismo "Guardar conteo" son la misma sesión: misma
  // fecha/sede) — ver turnoOportuno_ en Turnos.gs. Pedido real: "cuando no se registre conteo de
  // cierre... debe de pedir conteo de inicio de turno y después el conteo de cierre de turno".
  const turnoPorDefecto = opciones.omitir_obligatorios_del_dia
    ? 'Cierre de turno'
    : turnoOportuno_(items[0].fecha, items[0].sede, usuario);

  // Busca-o-inserta por fila (conteoBuscarFila_ lee, después se decide actualizar o appendRowFromObj_)
  // bajo un lock de todo el script: sin esto, dos solicitudes simultáneas para la MISMA combinación
  // de fecha/sede/punto/turno/producto (ej. doble clic, o dos personas guardando el mismo cierre a
  // la vez) podían no encontrarse la una a la otra todavía y ambas insertar una fila nueva, en vez
  // de que la segunda corrija la primera (auditoría de seguridad, jul 2026).
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, error: 'Otro conteo se está guardando ahora mismo — espera un momento y vuelve a intentarlo.' };
  }
  let n = 0;
  let actualizados = 0;
  try {
    const ahora = new Date();
    items.forEach(function (it) {
      const turnoItem = it.turno || turnoPorDefecto;
      const datos = {
        id: Utilities.getUuid(),
        fecha: it.fecha,
        sede: it.sede,
        punto_conteo: it.punto_conteo || 'Café',
        turno: turnoItem,
        producto: it.producto,
        unidad: it.unidad,
        cantidad: it.cantidad,
        usuario: usuario.nombre,
        timestamp: ahora
      };
      catalogoAsegurar_(it.producto, it.unidad);
      const existente = conteoBuscarFila_(Object.assign({}, it, { turno: turnoItem }));
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
  } finally {
    lock.releaseLock();
  }

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
  // claveProducto_/indiceCatalogo_ (no normalizar_ a secas): sin esto, contar un producto obligatorio
  // bajo su alias de FUDO (nombre_fudo) en vez de su nombre_estandar exacto lo dejaba marcado como
  // "faltante" aunque sí se hubiera contado — bloqueaba guardar el cierre por un falso positivo.
  const indice = indiceCatalogo_();
  const sesiones = {};
  items.forEach(function (it) {
    const clave = [it.fecha, it.sede, it.punto_conteo || ''].join('|');
    if (!sesiones[clave]) sesiones[clave] = { fecha: it.fecha, sede: it.sede, productos: {} };
    sesiones[clave].productos[claveProducto_(it.producto, indice)] = true;
  });

  const catalogo = leerTabla_(SHEET_NAMES.CATALOGO);
  const faltantes = {};
  Object.keys(sesiones).forEach(function (clave) {
    const sesion = sesiones[clave];
    const frecuencias = frecuenciasObligatoriasDelDia_(sesion.fecha);
    catalogo
      .filter(function (p) { return p.frecuencia_conteo && frecuencias.indexOf(p.frecuencia_conteo) !== -1; })
      // Un producto solo de una sede (ej. "Salsa de mora" que solo se vende en Capri) no debe
      // exigirse en la otra — pedido real: "que no me aparezca en San Antonio que me falta salsa
      // de mora cuando allá no se usa". Vacío o 'Ambas' = aplica a cualquier sede, como antes.
      .filter(function (p) { return !p.sede || p.sede === 'Ambas' || p.sede === sesion.sede; })
      .filter(function (p) { return !sesion.productos[claveProducto_(p.nombre_estandar, indice)]; })
      .forEach(function (p) { faltantes[p.nombre_estandar] = true; });
  });
  return Object.keys(faltantes);
}

/**
 * Un nuevo conteo del mismo cierre corrige el anterior, no se suma a él. Compara el producto por
 * claveProducto_ (no normalizar_ a secas): si el cierre se corrige usando el alias de FUDO del
 * mismo producto (nombre_fudo en vez de nombre_estandar), antes no lo reconocía como "el mismo" y
 * creaba una fila duplicada en vez de corregir la existente.
 */
function conteoBuscarFila_(item) {
  const sh = sheet_(SHEET_NAMES.CONTEOS);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0];
  const col = function (nombre) { return headers.indexOf(nombre); };
  const indice = indiceCatalogo_();
  const claveItem = claveProducto_(item.producto, indice);
  for (let r = data.length - 1; r >= 1; r--) {
    const fila = data[r];
    if (formatearFecha_(fila[col('fecha')]) === item.fecha &&
      fila[col('sede')] === item.sede &&
      fila[col('punto_conteo')] === (item.punto_conteo || 'Café') &&
      fila[col('turno')] === (item.turno || 'Cierre de turno') &&
      claveProducto_(fila[col('producto')], indice) === claveItem) {
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
