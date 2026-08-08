/**
 * ALERTAS DE STOCK BAJO
 * Dos chequeos independientes, cada uno con su propio correo:
 *  1) Platos por debajo de su umbral de preparaciones posibles (columna `umbral_alerta` en
 *     Recetas, o UMBRAL_ALERTA_DEFAULT si está vacía) — revisarAlertasPlatos_.
 *  2) Materia prima por debajo del mínimo que Diana configura por producto (columna
 *     `stock_minimo` en Catalogo_Maestro, editable en catalogo.html) — revisarAlertasStockMinimo_.
 *     Diana (ago 2026): quiere enterarse cuando un insumo se está agotando, no solo cuando ya
 *     tumbó las preparaciones posibles de un plato — para poder comprar antes de quedarse sin nada.
 *
 * Ambos se disparan desde revisarAlertas_ (el trigger diario tareaDiaria_ en Code.gs, y justo
 * después de conteoRegistrar_ en Conteos.gs) — un import de FUDO no cambia ninguno de los dos
 * cálculos, así que no hace falta revisar tras importar. AlertasEnviadas evita mandar el mismo
 * aviso más de una vez por producto por día y por tipo, sin importar cuántas veces se dispare el
 * chequeo.
 */

const UMBRAL_ALERTA_DEFAULT = 5;
const ALERTAS_ENVIADAS_COLUMNAS_ = ['fecha', 'plato', 'tipo'];

function alertasAsegurarEstructura_() {
  asegurarColumnas_(sheet_(SHEET_NAMES.ALERTAS_ENVIADAS), ALERTAS_ENVIADAS_COLUMNAS_);
}

function revisarAlertas_(fecha) {
  fecha = fecha || formatearFecha_(new Date());
  alertasAsegurarEstructura_();
  const disponible = calcularDisponibleHoy_(fecha);
  const indice = indiceCatalogo_();
  const resultadoPlatos = revisarAlertasPlatos_(fecha, disponible, indice);
  const resultadoIngredientes = revisarAlertasStockMinimo_(fecha, disponible, indice);
  return { ok: true, enviados: resultadoPlatos.enviados + resultadoIngredientes.enviados };
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

  const yaEnviados = alertasEnviadasHoy_(fecha, 'plato');
  const nuevos = bajos.filter(function (p) { return yaEnviados.indexOf(p.producto) === -1; });
  if (!nuevos.length) return { ok: true, enviados: 0 };

  enviarCorreoAlerta_(fecha, nuevos);
  nuevos.forEach(function (p) {
    appendRowFromObj_(SHEET_NAMES.ALERTAS_ENVIADAS, { fecha: fecha, plato: p.producto, tipo: 'plato' });
  });
  return { ok: true, enviados: nuevos.length };
}

/**
 * Compara el stock agregado (todas las sedes, mismo cálculo que ya usa Disponible Hoy: último
 * conteo + movimientos posteriores) de cada ingrediente contra el mínimo que Diana definió para
 * ese producto. Solo se revisan productos con `stock_minimo` configurado y mayor que cero — sin
 * eso no hay con qué comparar, y cero no sirve como umbral real (nunca se dispararía). Se ignoran
 * valores no numéricos (ej. una nota de texto metida por error en esa celda) en vez de reventar
 * el chequeo diario completo por un solo dato mal cargado.
 *
 * `stock_minimo` se interpreta en la unidad_base del catálogo (puede ser 'kg' o 'l', no siempre ya
 * viene en la unidad base real de g/ml/u) — se convierte con aUnidadBase_, la misma función que usa
 * Disponible Hoy para normalizar cualquier cantidad, antes de comparar contra el stock ya calculado
 * (que siempre queda en g/ml/u). Si aun así las unidades no calzan (dato inconsistente), esa línea
 * se salta en vez de comparar cantidades en unidades distintas.
 */
function revisarAlertasStockMinimo_(fecha, disponible, indice) {
  const bajos = [];
  leerTabla_(SHEET_NAMES.CATALOGO).forEach(function (c) {
    const minimo = Number(c.stock_minimo);
    if (!isFinite(minimo) || minimo <= 0) return;
    if (!c.nombre_estandar) return;
    const minimoBase = aUnidadBase_(minimo, c.unidad_base);
    const clave = claveProducto_(c.nombre_estandar, indice);
    const actual = disponible.stock_ingredientes[clave];
    if (!actual) return; // nunca contado ni movido todavía — no hay con qué comparar
    if (actual.unidad !== minimoBase.unidad) return;
    if (actual.cantidad < minimoBase.cantidad) {
      bajos.push({ producto: c.nombre_estandar, actual: actual.cantidad, minimo: minimoBase.cantidad, unidad: actual.unidad });
    }
  });
  if (!bajos.length) return { ok: true, enviados: 0 };

  const yaEnviados = alertasEnviadasHoy_(fecha, 'ingrediente');
  const nuevos = bajos.filter(function (b) { return yaEnviados.indexOf(b.producto) === -1; });
  if (!nuevos.length) return { ok: true, enviados: 0 };

  enviarCorreoAlertaStockMinimo_(fecha, nuevos);
  nuevos.forEach(function (b) {
    appendRowFromObj_(SHEET_NAMES.ALERTAS_ENVIADAS, { fecha: fecha, plato: b.producto, tipo: 'ingrediente' });
  });
  return { ok: true, enviados: nuevos.length };
}

/** Filas históricas de antes de que existiera la columna `tipo` son todas de alertas de plato. */
function alertasEnviadasHoy_(fecha, tipo) {
  return leerTabla_(SHEET_NAMES.ALERTAS_ENVIADAS)
    .filter(function (r) { return formatearFecha_(r.fecha) === fecha && (r.tipo || 'plato') === tipo; })
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

function enviarCorreoAlertaStockMinimo_(fecha, ingredientes) {
  const destinatarios = destinatariosAlerta_();
  if (!destinatarios.length) return;
  const cuerpo = 'Esta materia prima está por debajo del mínimo configurado (' + fecha + '):\n\n' +
    ingredientes.map(function (i) {
      return '- ' + i.producto + ': ' + i.actual + ' ' + i.unidad + ' (mínimo ' + i.minimo + ' ' + i.unidad + ')';
    }).join('\n');

  MailApp.sendEmail({
    to: destinatarios.join(','),
    subject: 'Dilana OS — Stock mínimo en ' + ingredientes.length + ' insumo(s)',
    body: cuerpo
  });
}

function destinatariosAlerta_() {
  return leerTabla_(SHEET_NAMES.USUARIOS)
    .filter(function (u) { return u.activo === true && (u.rol === 'Administrador' || u.rol === 'Encargado') && u.email; })
    .map(function (u) { return u.email; });
}
