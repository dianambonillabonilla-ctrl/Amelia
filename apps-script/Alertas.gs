/**
 * ALERTAS DE STOCK BAJO
 * Dos chequeos independientes, cada uno con su propio correo:
 *  1) Platos por debajo de su umbral de preparaciones posibles (columna `umbral_alerta` en
 *     Recetas, o UMBRAL_ALERTA_DEFAULT si está vacía) — revisarAlertasPlatos_. Sigue siendo
 *     agregado (todas las sedes juntas): un plato se vende igual desde cualquier sede.
 *  2) Materia prima por debajo del mínimo que Diana configura por producto (columna
 *     `stock_minimo` en Catalogo_Maestro, editable en catalogo.html) — revisarAlertasStockMinimo_.
 *     Diana (ago 2026): quiere enterarse cuando un insumo se está agotando, no solo cuando ya
 *     tumbó las preparaciones posibles de un plato — para poder comprar antes de quedarse sin
 *     nada. Y, a diferencia de los platos, esto SÍ es por sede — "que cada uno sepa": San Antonio
 *     se entera de que a San Antonio se le está acabando algo, Capri de lo suyo, sin que el stock
 *     sobrante de una sede tape el faltante real de la otra.
 *
 * Ambos se disparan desde revisarAlertas_ (el trigger diario tareaDiaria_ en Code.gs, y justo
 * después de conteoRegistrar_ en Conteos.gs) — un import de FUDO no cambia ninguno de los dos
 * cálculos, así que no hace falta revisar tras importar. AlertasEnviadas evita mandar el mismo
 * aviso más de una vez por producto por día, tipo y sede, sin importar cuántas veces se dispare
 * el chequeo.
 *
 * Además del correo, alertasStockBajoListar_ (acción de lectura 'alertas_stock_bajo_listar')
 * recalcula el mismo chequeo de materia prima EN VIVO para mostrarlo en inicio.html — no depende
 * de si ya se mandó el correo de hoy, así que sigue visible en pantalla mientras el stock real
 * siga bajo, aunque el aviso por correo de ese día ya se haya enviado.
 */

const UMBRAL_ALERTA_DEFAULT = 5;
const ALERTAS_ENVIADAS_COLUMNAS_ = ['fecha', 'plato', 'tipo', 'sede'];
const ALERTAS_SEDES_STOCK_MINIMO_ = ['San Antonio', 'Capri', 'Centro de Producción'];

function alertasAsegurarEstructura_() {
  asegurarColumnas_(sheet_(SHEET_NAMES.ALERTAS_ENVIADAS), ALERTAS_ENVIADAS_COLUMNAS_);
}

function revisarAlertas_(fecha) {
  fecha = fecha || formatearFecha_(new Date());
  alertasAsegurarEstructura_();
  // Una sola memoización de tablas para todo el chequeo (platos + las 3 sedes de ingredientes) —
  // sin esto, cada sede volvía a leer Conteos_Manuales/Ajustes/Traslados/Producciones completas
  // por su cuenta (ver conCacheDeTablas_ en Code.gs).
  return conCacheDeTablas_(function () {
    const disponible = calcularDisponibleHoy_(fecha);
    const indice = indiceCatalogo_();
    const resultadoPlatos = revisarAlertasPlatos_(fecha, disponible, indice);
    const resultadoIngredientes = revisarAlertasStockMinimo_(fecha, indice);
    return { ok: true, enviados: resultadoPlatos.enviados + resultadoIngredientes.enviados };
  });
}

function revisarAlertasPlatos_(fecha, disponible, indice) {
  const umbrales = {};
  leerTabla_(SHEET_NAMES.RECETAS).forEach(function (r) {
    if (r.umbral_alerta !== '' && r.umbral_alerta !== null && r.umbral_alerta !== undefined) {
      umbrales[claveProducto_(r.producto, indice)] = Number(r.umbral_alerta);
    }
  });

  const bajos = disponible.platos.filter(function (p) {
    if (p.preparaciones_posibles === null) return false;
    const clave = claveProducto_(p.producto, indice);
    const umbral = umbrales[clave] !== undefined ? umbrales[clave] : UMBRAL_ALERTA_DEFAULT;
    return p.preparaciones_posibles < umbral;
  });
  if (!bajos.length) return { ok: true, enviados: 0 };

  const yaEnviados = alertasEnviadasHoy_(fecha, 'plato', '');
  const nuevos = bajos.filter(function (p) { return yaEnviados.indexOf(p.producto) === -1; });
  if (!nuevos.length) return { ok: true, enviados: 0 };

  enviarCorreoAlerta_(fecha, nuevos);
  nuevos.forEach(function (p) {
    appendRowFromObj_(SHEET_NAMES.ALERTAS_ENVIADAS, { fecha: fecha, plato: p.producto, tipo: 'plato', sede: '' });
  });
  return { ok: true, enviados: nuevos.length };
}

/**
 * Cuánta materia prima con `stock_minimo` configurado está por debajo de ese mínimo, EN UNA sede
 * específica (no agregado) — mismo cálculo que ya usa Disponible Hoy: último conteo de esa sede +
 * movimientos posteriores. Solo se revisan productos con un mínimo mayor que cero — sin eso no hay
 * con qué comparar, y cero no sirve como umbral real (nunca se dispararía). Se ignoran valores no
 * numéricos (ej. una nota de texto metida por error en esa celda) en vez de reventar el chequeo
 * completo por un solo dato mal cargado.
 *
 * `stock_minimo` se interpreta en la unidad_base del catálogo (puede ser 'kg' o 'l', no siempre ya
 * viene en la unidad base real de g/ml/u) — se convierte con aUnidadBase_, la misma función que usa
 * Disponible Hoy para normalizar cualquier cantidad, antes de comparar contra el stock ya calculado
 * (que siempre queda en g/ml/u). Si aun así las unidades no calzan (dato inconsistente), esa línea
 * se salta en vez de comparar cantidades en unidades distintas.
 */
function stockBajoMinimoPorSede_(fecha, sede, indice) {
  const stockSede = obtenerUltimoStockPorIngrediente_(fecha, indice, sede);
  const bajos = [];
  leerTabla_(SHEET_NAMES.CATALOGO).forEach(function (c) {
    const minimo = Number(c.stock_minimo);
    if (!isFinite(minimo) || minimo <= 0) return;
    if (!c.nombre_estandar) return;
    const minimoBase = aUnidadBase_(minimo, c.unidad_base);
    const clave = claveProducto_(c.nombre_estandar, indice);
    const actual = stockSede[clave];
    if (!actual) return; // nunca contado ni movido todavía en esta sede — no hay con qué comparar
    if (actual.unidad !== minimoBase.unidad) return;
    if (actual.cantidad < minimoBase.cantidad) {
      bajos.push({ producto: c.nombre_estandar, sede: sede, actual: actual.cantidad, minimo: minimoBase.cantidad, unidad: actual.unidad });
    }
  });
  return bajos;
}

function revisarAlertasStockMinimo_(fecha, indice) {
  let enviados = 0;
  ALERTAS_SEDES_STOCK_MINIMO_.forEach(function (sede) {
    const bajos = stockBajoMinimoPorSede_(fecha, sede, indice);
    if (!bajos.length) return;
    const yaEnviados = alertasEnviadasHoy_(fecha, 'ingrediente', sede);
    const nuevos = bajos.filter(function (b) { return yaEnviados.indexOf(b.producto) === -1; });
    if (!nuevos.length) return;

    enviarCorreoAlertaStockMinimo_(fecha, sede, nuevos);
    nuevos.forEach(function (b) {
      appendRowFromObj_(SHEET_NAMES.ALERTAS_ENVIADAS, { fecha: fecha, plato: b.producto, tipo: 'ingrediente', sede: sede });
    });
    enviados += nuevos.length;
  });
  return { ok: true, enviados: enviados };
}

/**
 * Recalcula EN VIVO (sin depender de si ya se mandó correo hoy) el stock de materia prima por
 * debajo del mínimo, para mostrar en inicio.html. `sede` ya viene resuelta por
 * sedeConsultaPermitida_ en el router: una sede concreta para un usuario limitado a su sede, o
 * null/'Ambas' para Administrador — en ese caso se muestran las 3 sedes, cada fila con su propia
 * sede, para no tapar un faltante real de una sede con el sobrante de otra.
 */
function alertasStockBajoListar_(fecha, sede) {
  fecha = fecha ? formatearFecha_(fecha) : formatearFecha_(new Date());
  return conCacheDeTablas_(function () {
    const indice = indiceCatalogo_();
    const sedes = sede && sede !== 'Ambas' ? [sede] : ALERTAS_SEDES_STOCK_MINIMO_;
    const bajos = [];
    sedes.forEach(function (s) { bajos.push.apply(bajos, stockBajoMinimoPorSede_(fecha, s, indice)); });
    return { ok: true, fecha: fecha, bajos: bajos };
  });
}

/**
 * `sede` vacío/omitido es el caso de la alerta de platos (agregada, sin sede). Filas históricas de
 * antes de que existieran las columnas `tipo`/`sede` son todas de alertas de plato sin sede.
 */
function alertasEnviadasHoy_(fecha, tipo, sede) {
  return leerTabla_(SHEET_NAMES.ALERTAS_ENVIADAS)
    .filter(function (r) {
      return formatearFecha_(r.fecha) === fecha && (r.tipo || 'plato') === tipo && (r.sede || '') === (sede || '');
    })
    .map(function (r) { return r.plato; });
}

function enviarCorreoAlerta_(fecha, platos) {
  const destinatarios = destinatariosAlerta_();
  if (!destinatarios.length) return;
  const cuerpo = 'Estos platos están por debajo de su umbral de preparaciones posibles (' + fecha + '):\n\n' +
    platos.map(function (p) {
      return '- ' + p.producto + ': ' + p.preparaciones_posibles + ' preparaciones posibles (limitante: ' + (p.ingrediente_limitante || '—') + ')';
    }).join('\n');

  MailApp.sendEmail({
    to: destinatarios.join(','),
    subject: 'Dilana OS — Stock bajo en ' + platos.length + ' plato(s)',
    body: cuerpo
  });
}

function enviarCorreoAlertaStockMinimo_(fecha, sede, ingredientes) {
  const destinatarios = destinatariosAlertaSede_(sede);
  if (!destinatarios.length) return;
  const cuerpo = 'Esta materia prima de ' + sede + ' está por debajo del mínimo configurado (' + fecha + '):\n\n' +
    ingredientes.map(function (i) {
      return '- ' + i.producto + ': ' + i.actual + ' ' + i.unidad + ' (mínimo ' + i.minimo + ' ' + i.unidad + ')';
    }).join('\n');

  MailApp.sendEmail({
    to: destinatarios.join(','),
    subject: 'Dilana OS — Stock mínimo en ' + ingredientes.length + ' insumo(s) — ' + sede,
    body: cuerpo
  });
}

function destinatariosAlerta_() {
  return leerTabla_(SHEET_NAMES.USUARIOS)
    .filter(function (u) { return u.activo === true && (u.rol === 'Administrador' || u.rol === 'Encargado') && u.email; })
    .map(function (u) { return u.email; });
}

/** Solo la gente de ESA sede (o con sede:'Ambas', ej. Administrador) — "que cada uno sepa". */
function destinatariosAlertaSede_(sede) {
  return leerTabla_(SHEET_NAMES.USUARIOS)
    .filter(function (u) {
      return u.activo === true && (u.rol === 'Administrador' || u.rol === 'Encargado') && u.email &&
        (u.sede === sede || u.sede === 'Ambas');
    })
    .map(function (u) { return u.email; });
}
