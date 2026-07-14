/**
 * ALERTAS DE STOCK BAJO
 * Cuando un plato queda por debajo de su umbral de preparaciones posibles (columna
 * `umbral_alerta` en Recetas, o UMBRAL_ALERTA_DEFAULT si está vacía), se manda un correo a los
 * usuarios activos con rol Administrador o Encargado y con `email` configurado.
 *
 * Se dispara desde dos lugares: el trigger diario (tareaDiaria_, ver Code.gs) y justo después
 * de conteoRegistrar_ (Conteos.gs) — un import de FUDO no cambia preparaciones_posibles, así
 * que no hace falta revisar tras importar. AlertasEnviadas evita mandar el mismo aviso más de
 * una vez por plato por día, sin importar cuántas veces se dispare el chequeo.
 */

const UMBRAL_ALERTA_DEFAULT = 5;

function revisarAlertas_(fecha) {
  fecha = fecha || formatearFecha_(new Date());
  const disponible = calcularDisponibleHoy_(fecha);
  const umbrales = {};
  leerTabla_(SHEET_NAMES.RECETAS).forEach(function (r) {
    if (r.umbral_alerta !== '' && r.umbral_alerta !== null && r.umbral_alerta !== undefined) {
      umbrales[r.producto] = Number(r.umbral_alerta);
    }
  });

  const bajos = disponible.platos.filter(function (p) {
    if (p.preparaciones_posibles === null) return false;
    const umbral = umbrales[p.producto] !== undefined ? umbrales[p.producto] : UMBRAL_ALERTA_DEFAULT;
    return p.preparaciones_posibles < umbral;
  });
  if (!bajos.length) return { ok: true, enviados: 0 };

  const yaEnviados = platosYaAlertadosHoy_(fecha);
  const nuevos = bajos.filter(function (p) { return yaEnviados.indexOf(p.producto) === -1; });
  if (!nuevos.length) return { ok: true, enviados: 0 };

  enviarCorreoAlerta_(fecha, nuevos);
  nuevos.forEach(function (p) {
    appendRowFromObj_(SHEET_NAMES.ALERTAS_ENVIADAS, { fecha: fecha, plato: p.producto });
  });
  return { ok: true, enviados: nuevos.length };
}

function platosYaAlertadosHoy_(fecha) {
  return leerTabla_(SHEET_NAMES.ALERTAS_ENVIADAS)
    .filter(function (r) { return formatearFecha_(r.fecha) === fecha; })
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

function destinatariosAlerta_() {
  return leerTabla_(SHEET_NAMES.USUARIOS)
    .filter(function (u) { return u.activo === true && (u.rol === 'Administrador' || u.rol === 'Encargado') && u.email; })
    .map(function (u) { return u.email; });
}
