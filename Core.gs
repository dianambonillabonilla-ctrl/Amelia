function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle(APP_CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function healthcheck() {
  return {
    ok: true,
    app: APP_CONFIG.APP_NAME,
    dbConfigured: !!PropertiesService.getScriptProperties().getProperty('DB_ID'),
    timestamp: nowIso()
  };
}

function createAlert_(tipo, nivel, mensaje, sede) {
  appendRow_('Alertas', [
    generateId('ALT'),
    nowIso(),
    tipo,
    nivel,
    mensaje,
    sede || '',
    'ABIERTA',
    ''
  ]);
}

function logAudit_(user, modulo, accion, entidad, idEntidad, detalle) {
  appendRow_('Log_Auditoria', [
    generateId('LOG'),
    nowIso(),
    user.id_usuario || '',
    user.codigo_usuario || '',
    user.rol || '',
    user.sede_asignada || '',
    modulo || '',
    accion || '',
    entidad || '',
    idEntidad || '',
    detalle || ''
  ]);
}

function installTriggers() {
  var handlers = ['sendScheduledDailyReports'];
  var existing = ScriptApp.getProjectTriggers().map(function(t) { return t.getHandlerFunction(); });
  handlers.forEach(function(h) {
    if (existing.indexOf(h) === -1) {
      ScriptApp.newTrigger(h).timeBased().everyDays(1).atHour(7).create();
    }
  });
  return { ok: true, message: 'Triggers instalados' };
}

function sendScheduledDailyReports() {
  var cfg = getAllAsObjects_('Configuracion');
  var emails = cfg
    .filter(function(c) { return c.clave === 'daily_report_recipients'; })
    .map(function(c) { return c.valor; })
    .filter(Boolean);
  if (!emails.length) return;

  var systemUser = {
    id_usuario: 'SISTEMA',
    codigo_usuario: 'SYS',
    rol: 'GERENCIA',
    sede_asignada: 'SEDE-SA'
  };
  sendDailyEmailReport({ recipients: emails, sede: 'SEDE-SA' }, mockTokenForSystem_(systemUser));
}

function mockTokenForSystem_(systemUser) {
  var token = 'SYS-' + Utilities.getUuid();
  appendRow_('Sesiones', [token, systemUser.id_usuario, 'sistema', nowIso(), nowIso(), new Date(Date.now() + 300000).toISOString(), 'ACTIVA']);
  return token;
}
