/**
 * ALERTAS DE STOCK BAJO
 * Cuando un plato queda por debajo de su umbral de preparaciones posibles (columna
 * `umbral_alerta` en Recetas, o UMBRAL_ALERTA_DEFAULT si está vacía), se manda un correo a los
 * usuarios activos con rol Administrador o Encargado y con `email` configurado.
 *
 * Se revisa POR SEDE (San Antonio y Capri por separado): antes se calculaba "Disponible Hoy"
 * combinado (Ambas) y se mandaba un solo correo con todo mezclado a cualquier Administrador o
 * Encargado, sin importar su sede asignada — alguien de una sola sede recibía alertas de la otra.
 * Ahora cada correo dice de qué sede es, y solo llega a quien tenga esa sede asignada (o 'Ambas').
 *
 * Se dispara desde dos lugares: el trigger diario (tareaDiaria_, ver Code.gs) y justo después
 * de conteoRegistrar_ (Conteos.gs) — un import de FUDO no cambia preparaciones_posibles, así
 * que no hace falta revisar tras importar. AlertasEnviadas evita mandar el mismo aviso más de
 * una vez por plato por sede por día, sin importar cuántas veces se dispare el chequeo.
 */

const UMBRAL_ALERTA_DEFAULT = 5;
const SEDES_CON_ALERTA_STOCK = ['San Antonio', 'Capri'];

function revisarAlertas_(fecha) {
  fecha = fecha || formatearFecha_(new Date());
  let enviados = 0;
  SEDES_CON_ALERTA_STOCK.forEach(function (sede) {
    enviados += revisarAlertasPorSede_(fecha, sede);
  });
  return { ok: true, enviados: enviados };
}

function revisarAlertasPorSede_(fecha, sede) {
  const disponible = calcularDisponibleHoy_(fecha, sede);
  const indice = indiceCatalogo_();
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
  if (!bajos.length) return 0;

  const yaEnviados = platosYaAlertadosHoy_(fecha, sede);
  const nuevos = bajos.filter(function (p) { return yaEnviados.indexOf(p.producto) === -1; });
  if (!nuevos.length) return 0;

  enviarCorreoAlerta_(fecha, sede, nuevos);
  nuevos.forEach(function (p) {
    appendRowFromObj_(SHEET_NAMES.ALERTAS_ENVIADAS, { fecha: fecha, plato: p.producto, sede: sede });
  });
  return nuevos.length;
}

function platosYaAlertadosHoy_(fecha, sede) {
  return leerTabla_(SHEET_NAMES.ALERTAS_ENVIADAS)
    .filter(function (r) { return formatearFecha_(r.fecha) === fecha && r.sede === sede; })
    .map(function (r) { return r.plato; });
}

function enviarCorreoAlerta_(fecha, sede, platos) {
  const destinatarios = destinatariosAlerta_(sede);
  if (!destinatarios.length) return;
  const cuerpo = 'Estos platos de ' + sede + ' están por debajo de su umbral de preparaciones posibles (' + fecha + '):\n\n' +
    platos.map(function (p) {
      return '- ' + p.producto + ': ' + p.preparaciones_posibles + ' preparaciones posibles (limitante: ' + (p.ingrediente_limitante || '—') + ')';
    }).join('\n');

  MailApp.sendEmail({
    to: destinatarios.join(','),
    subject: 'Dilana OS — Stock bajo en ' + sede + ' (' + platos.length + ' plato(s))',
    body: cuerpo
  });
}

/**
 * Administrador/Encargado activos con correo configurado. Si se pasa `sede`, se filtra a quienes
 * tengan esa sede asignada o 'Ambas' (para no mandar alertas de un punto a alguien de otro). Sin
 * `sede` (uso histórico, ej. observación de traslados) no se filtra: un traslado siempre
 * involucra dos sedes y cualquier Administrador/Encargado puede necesitar ayudar a resolverlo.
 */
function destinatariosAlerta_(sede) {
  return leerTabla_(SHEET_NAMES.USUARIOS)
    .filter(function (u) {
      if (!(u.activo === true && (u.rol === 'Administrador' || u.rol === 'Encargado') && u.email)) return false;
      if (!sede) return true;
      return u.sede === 'Ambas' || u.sede === sede;
    })
    .map(function (u) { return u.email; });
}
