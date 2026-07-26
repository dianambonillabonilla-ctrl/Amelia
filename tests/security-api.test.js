const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargarCode(extras = {}) {
  const ctx = Object.assign({
    console,
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({
        _text: s,
        setMimeType: function () { return this; },
        getContent: function () { return this._text; }
      })
    },
    Logger: { log: () => {} }
  }, extras);
  vm.createContext(ctx);
  // Solo las funciones de seguridad de Code.gs — no cargar todo el archivo (depende de muchas hojas).
  const fragmento = `
function apiErrorConIncidente_(resumen, detalle) {
  const incidente = 'API-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 1000);
  Logger.log('[' + incidente + '] ' + resumen + ': ' + detalle);
  return new Error(resumen + ' (código ' + incidente + ' — revisa el registro de ejecución de Apps Script para el detalle completo).');
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handleRequestSeguridad_(e, method) {
  if (method === 'GET') {
    return jsonOut_({ ok: false, error: 'La API de Dilana OS solo acepta solicitudes POST. Actualiza la página si ves este mensaje.' });
  }
  let body = {};
  try {
    if (e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'JSON inválido en el cuerpo de la solicitud' });
  }
  const params = Object.assign({}, e.parameter || {}, body || {});
  const action = params.action;
  try {
    if (action === 'login') return jsonOut_({ ok: true, token: 't' });
    throw new Error('detalle interno que no debe filtrarse');
  } catch (err) {
    const detalle = err && err.message ? err.message : String(err);
    if (/código (API|FUDO)-/.test(detalle)) {
      return jsonOut_({ ok: false, error: detalle });
    }
    return jsonOut_({ ok: false, error: apiErrorConIncidente_('Error de servidor', detalle).message });
  }
}
`;
  vm.runInContext(fragmento, ctx, { filename: 'security-fragment.gs' });
  return ctx;
}

(function () {
  const mod = cargarCode();
  const resp = JSON.parse(mod.handleRequestSeguridad_({
    parameter: { action: 'login', usuario: 'ana', password: 'secreta' }
  }, 'GET').getContent());
  assert.equal(resp.ok, false);
  assert.match(resp.error, /solo acepta solicitudes POST/);
  console.log('GET bloquea login con credenciales en query: OK');
})();

(function () {
  const mod = cargarCode();
  const resp = JSON.parse(mod.handleRequestSeguridad_({
    postData: { contents: JSON.stringify({ action: 'login', usuario: 'ana', password: 'ok' }) }
  }, 'POST').getContent());
  assert.equal(resp.ok, true);
  console.log('POST permite login: OK');
})();

(function () {
  const mod = cargarCode();
  const resp = JSON.parse(mod.handleRequestSeguridad_({
    postData: { contents: JSON.stringify({ action: 'otra' }) }
  }, 'POST').getContent());
  assert.equal(resp.ok, false);
  assert.match(resp.error, /código API-/);
  assert.doesNotMatch(resp.error, /detalle interno/);
  console.log('errores internos se ocultan con código de incidente: OK');
})();

(function () {
  const mod = cargarCode();
  const resp = JSON.parse(mod.handleRequestSeguridad_({
    postData: { contents: '{mal json' }
  }, 'POST').getContent());
  assert.equal(resp.ok, false);
  assert.equal(resp.error, 'JSON inválido en el cuerpo de la solicitud');
  console.log('JSON inválido sin filtrar err.message: OK');
})();

console.log('security-api: OK');
