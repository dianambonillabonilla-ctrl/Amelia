/**
 * CONTEOS MANUALES
 * Reemplaza las hojas "Diario" / "Miercoles" / "Viernes" de los Excel de inventario.
 * Cada fila es UN producto contado, en UNA sede, en UN cierre de turno.
 */

/**
 * Solo valida, no escribe nada — separado de conteoRegistrar_ para que
 * produccionConObligatoriosRegistrar_ (Produccion.gs) pueda comprobar ESTO y también la
 * producción ANTES de escribir cualquiera de los dos, sin duplicar las reglas de negocio.
 */
function validarItemsConteo_(items, usuario, opciones) {
  opciones = opciones || {};
  if (!items || !items.length) return 'No se recibieron items para registrar';
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    if (!it.fecha || !it.sede || !it.producto || !it.unidad) {
      return 'Cada conteo debe tener fecha, sede, producto y unidad';
    }
    if (isNaN(Number(it.cantidad)) || Number(it.cantidad) < 0) {
      return 'La cantidad contada debe ser un número igual o mayor que cero';
    }
  }
  // sedeEscrituraPermitida_ (Code.gs) también deja registrar en Centro de Producción sin importar
  // la sede propia — San Antonio/Capri/Ambas cubren ese sitio en la práctica.
  if (items.some(function (it) { return !sedeEscrituraPermitida_(usuario, it.sede); })) {
    return 'No puedes registrar conteos para una sede distinta a la tuya (' + usuario.sede + ')';
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
      return 'Faltan productos obligatorios de hoy: ' + faltantes.join(', ');
    }
  }
  return null;
}

function conteoRegistrar_(items, usuario, opciones) {
  opciones = opciones || {};
  const errorValidacion = validarItemsConteo_(items, usuario, opciones);
  if (errorValidacion) return { ok: false, error: errorValidacion };

  // A qué 'turno' pertenece este envío si no lo trae explícito — se calcula una sola vez.
  const turnoPorDefecto = opciones.omitir_obligatorios_del_dia
    ? 'Cierre de turno'
    : turnoOportuno_(items[0].fecha, items[0].sede, usuario);

  // Un único lock protege toda la operación. Dentro se leen las hojas una sola vez y se escriben
  // filas completas, evitando el patrón anterior de releer Conteos_Manuales por cada producto.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, error: 'Otro conteo se está guardando ahora mismo — espera un momento y vuelve a intentarlo.' };
  }

  let registrados = 0;
  let actualizados = 0;
  try {
    const ahora = new Date();

    // Asegurar el catálogo una sola vez por combinación producto/unidad, no una vez por cada fila.
    const catalogoVistos = {};
    items.forEach(function (it) {
      const claveCatalogo = normalizar_(it.producto) + '|' + normalizar_(it.unidad);
      if (catalogoVistos[claveCatalogo]) return;
      catalogoVistos[claveCatalogo] = true;
      catalogoAsegurar_(it.producto, it.unidad);
    });

    const sh = sheet_(SHEET_NAMES.CONTEOS);
    const data = sh.getDataRange().getValues();
    const headers = data.length ? data[0] : [];
    if (!headers.length) {
      throw new Error('La hoja Conteos_Manuales no tiene encabezados. Corre configurarHojas().');
    }

    const col = {};
    headers.forEach(function (h, i) { col[h] = i; });
    ['id', 'fecha', 'sede', 'punto_conteo', 'turno', 'producto', 'unidad', 'cantidad', 'usuario', 'timestamp']
      .forEach(function (h) {
        if (col[h] === undefined) {
          throw new Error('Falta la columna "' + h + '" en Conteos_Manuales. Corre configurarHojas().');
        }
      });

    const indiceCatalogo = indiceCatalogo_();
    const claveFila = function (fecha, sede, punto, turno, producto) {
      return [
        formatearFecha_(fecha),
        sede || '',
        punto || 'Café',
        turno || 'Cierre de turno',
        claveProducto_(producto, indiceCatalogo)
      ].join('|');
    };

    // Índice de lo ya guardado: una sola lectura completa para todo el envío.
    const existentes = {};
    for (let r = 1; r < data.length; r++) {
      const fila = data[r];
      const clave = claveFila(
        fila[col.fecha],
        fila[col.sede],
        fila[col.punto_conteo],
        fila[col.turno],
        fila[col.producto]
      );
      // Se conserva la fila más reciente si el histórico ya contenía duplicados.
      existentes[clave] = { filaHoja: r + 1, valores: fila.slice() };
    }

    const nuevas = [];
    const actualizaciones = [];
    const auditorias = [];
    const pendientesNuevas = {};

    items.forEach(function (it) {
      const turnoItem = it.turno || turnoPorDefecto;
      const punto = it.punto_conteo || 'Café';
      const clave = claveFila(it.fecha, it.sede, punto, turnoItem, it.producto);
      const datos = neutralizarObjetoFormulas_({
        id: Utilities.getUuid(),
        fecha: it.fecha,
        sede: it.sede,
        punto_conteo: punto,
        turno: turnoItem,
        producto: it.producto,
        unidad: it.unidad,
        cantidad: Number(it.cantidad),
        usuario: usuario.nombre,
        timestamp: ahora
      });

      const existente = existentes[clave];
      if (existente) {
        const anterior = existente.valores.slice();
        const nuevaFila = anterior.slice();
        headers.forEach(function (h, c) {
          if (h === 'id') return;
          if (datos[h] !== undefined) nuevaFila[c] = datos[h];
        });
        actualizaciones.push({ filaHoja: existente.filaHoja, valores: nuevaFila });
        existente.valores = nuevaFila;
        actualizados++;
        auditorias.push({
          id: anterior[col.id],
          sede: it.sede,
          anterior: {
            cantidad: anterior[col.cantidad],
            usuario: anterior[col.usuario],
            timestamp: anterior[col.timestamp]
          },
          nuevo: {
            cantidad: datos.cantidad,
            usuario: datos.usuario,
            timestamp: datos.timestamp
          }
        });
      } else if (pendientesNuevas[clave] !== undefined) {
        // Doble producto dentro del mismo envío: la última cantidad reemplaza la anterior.
        const idx = pendientesNuevas[clave];
        const filaPendiente = nuevas[idx];
        headers.forEach(function (h, c) {
          if (h === 'id') return;
          if (datos[h] !== undefined) filaPendiente[c] = datos[h];
        });
      } else {
        const nuevaFila = headers.map(function (h) {
          return datos[h] !== undefined ? datos[h] : '';
        });
        pendientesNuevas[clave] = nuevas.length;
        nuevas.push(nuevaFila);
        registrados++;
      }
    });

    // Una escritura por fila corregida, pero la fila completa en una sola llamada.
    actualizaciones.forEach(function (act) {
      sh.getRange(act.filaHoja, 1, 1, headers.length).setValues([act.valores]);
    });

    // Todos los conteos nuevos se agregan en una sola escritura por lotes.
    if (nuevas.length) {
      sh.getRange(sh.getLastRow() + 1, 1, nuevas.length, headers.length).setValues(nuevas);
    }

    // La auditoría se conserva después de completar las escrituras principales.
    auditorias.forEach(function (a) {
      auditoriaRegistrar_(usuario, 'conteo_corregido', 'Conteo', a.id,
        a.anterior, a.nuevo, a.sede);
    });

    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  try {
    revisarAlertas_(items[0].fecha);
  } catch (err) {
    Logger.log('revisarAlertas_ falló tras conteo_registrar: ' + err.message);
  }

  return {
    ok: true,
    registrados: registrados,
    actualizados: actualizados,
    procesados: registrados + actualizados
  };
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
  if (typeof valor === 'string') {
    const texto = valor.trim();
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(texto)) return texto;
  }
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
