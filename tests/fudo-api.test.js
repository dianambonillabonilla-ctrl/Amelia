const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

// PropertiesService falso en memoria — mismo contrato mínimo que usa FudoApi.gs
// (getProperty/setProperty/deleteProperty), reiniciado entre bloques de prueba.
let props;
function reiniciarProps_() {
  props = {};
}
reiniciarProps_();
const fakePropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => (props[k] !== undefined ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
    deleteProperty: (k) => { delete props[k]; }
  })
};

// UrlFetchApp falso — cada prueba define fetchImpl según lo que necesite simular.
let fetchImpl;
let llamadas;
const fakeUrlFetchApp = {
  fetch: (url, opts) => {
    llamadas.push({ url, opts });
    return fetchImpl(url, opts);
  }
};

function respuesta_(code, bodyObj) {
  return { getResponseCode: () => code, getContentText: () => JSON.stringify(bodyObj) };
}

function cargarFudoApi_() {
  return cargar('apps-script/FudoApi.gs', {
    PropertiesService: fakePropertiesService,
    UrlFetchApp: fakeUrlFetchApp
  });
}

// --- fudoApiConfigurarCredenciales_ ------------------------------------------------------------

(function () {
  reiniciarProps_();
  const ctx = cargarFudoApi_();
  assert.throws(() => ctx.fudoApiConfigurarCredenciales_('', ''), /Faltan apiKey\/apiSecret/);

  props.FUDO_API_TOKEN = 'viejo';
  props.FUDO_API_TOKEN_EXP = '99999999999';
  const msg = ctx.fudoApiConfigurarCredenciales_('key123', 'secret456');
  assert.equal(props.FUDO_API_KEY, 'key123');
  assert.equal(props.FUDO_API_SECRET, 'secret456');
  // Guardar credenciales nuevas limpia el token cacheado de la credencial anterior.
  assert.equal(props.FUDO_API_TOKEN, undefined);
  assert.equal(props.FUDO_API_TOKEN_EXP, undefined);
  assert.ok(/Credenciales de la API de FUDO guardadas/.test(msg));

  ctx.fudoApiConfigurarCredenciales_('key123', 'secret456', 'https://otra-base.fu.do');
  assert.equal(props.FUDO_API_BASE_URL, 'https://otra-base.fu.do');
  console.log('fudoApiConfigurarCredenciales_: OK');
})();

// --- fudoApiObtenerToken_ -----------------------------------------------------------------------

(function () {
  reiniciarProps_();
  llamadas = [];
  const ctx = cargarFudoApi_();
  assert.throws(() => ctx.fudoApiObtenerToken_(), /No hay credenciales/);
  console.log('fudoApiObtenerToken_ sin credenciales: OK');
})();

(function () {
  reiniciarProps_();
  props.FUDO_API_KEY = 'key123';
  props.FUDO_API_SECRET = 'secret456';
  llamadas = [];
  fetchImpl = () => respuesta_(200, { token: 'tok-nuevo', exp: Math.floor(Date.now() / 1000) + 3600 });
  const ctx = cargarFudoApi_();

  const token = ctx.fudoApiObtenerToken_();
  assert.equal(token, 'tok-nuevo');
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, 'https://auth.fu.do/api');
  assert.equal(JSON.parse(llamadas[0].opts.payload).apiKey, 'key123');
  assert.equal(JSON.parse(llamadas[0].opts.payload).apiSecret, 'secret456');
  assert.equal(props.FUDO_API_TOKEN, 'tok-nuevo');

  // Con token vigente en caché (expira en más de 5 minutos), no debe volver a llamar a auth.fu.do.
  const token2 = ctx.fudoApiObtenerToken_();
  assert.equal(token2, 'tok-nuevo');
  assert.equal(llamadas.length, 1);
  console.log('fudoApiObtenerToken_ pide y cachea token nuevo: OK');
})();

(function () {
  reiniciarProps_();
  props.FUDO_API_KEY = 'key123';
  props.FUDO_API_SECRET = 'secret456';
  props.FUDO_API_TOKEN = 'tok-por-vencer';
  // Vence en 60s — dentro del margen de 5 minutos, debe renovar.
  props.FUDO_API_TOKEN_EXP = String(Math.floor(Date.now() / 1000) + 60);
  llamadas = [];
  fetchImpl = () => respuesta_(200, { token: 'tok-renovado', exp: Math.floor(Date.now() / 1000) + 3600 });
  const ctx = cargarFudoApi_();

  const token = ctx.fudoApiObtenerToken_();
  assert.equal(token, 'tok-renovado');
  assert.equal(llamadas.length, 1);
  console.log('fudoApiObtenerToken_ renueva token por vencer: OK');
})();

(function () {
  reiniciarProps_();
  props.FUDO_API_KEY = 'key123';
  props.FUDO_API_SECRET = 'secret456';
  llamadas = [];
  fetchImpl = () => respuesta_(401, { error: 'credenciales inválidas' });
  const ctx = cargarFudoApi_();
  assert.throws(() => ctx.fudoApiObtenerToken_(), /Autenticación con la API de FUDO falló \(401\)/);
  console.log('fudoApiObtenerToken_ error de auth: OK');
})();

// --- fudoApiObtenerPagina_ / fudoApiObtenerTodo_ -------------------------------------------------

function ctxAutenticadoConDatos_(paginas) {
  reiniciarProps_();
  props.FUDO_API_KEY = 'key123';
  props.FUDO_API_SECRET = 'secret456';
  props.FUDO_API_TOKEN = 'tok-vigente';
  props.FUDO_API_TOKEN_EXP = String(Math.floor(Date.now() / 1000) + 3600);
  llamadas = [];
  let i = 0;
  fetchImpl = () => {
    const body = paginas[Math.min(i, paginas.length - 1)];
    i++;
    return respuesta_(200, body);
  };
  return cargarFudoApi_();
}

(function () {
  const ctx = ctxAutenticadoConDatos_([[{ id: 1 }, { id: 2 }]]);
  const pagina = ctx.fudoApiObtenerPagina_('sales', { pageSize: 5, pagina: 1, filtros: { estado: 'eq.abierta' }, orden: '-fecha' });
  assert.deepEqual(pagina, [{ id: 1 }, { id: 2 }]);
  const url = llamadas[0].url;
  assert.ok(url.startsWith('https://api.fu.do/v1alpha1/sales?'));
  assert.ok(url.includes('page[size]=5'));
  assert.ok(url.includes('page[number]=1'));
  assert.ok(url.includes('filter[estado]=' + encodeURIComponent('eq.abierta')));
  assert.ok(url.includes('sort=' + encodeURIComponent('-fecha')));
  assert.equal(llamadas[0].opts.headers.Authorization, 'Bearer tok-vigente');
  console.log('fudoApiObtenerPagina_ arma la URL con page/filter/sort: OK');
})();

(function () {
  // Respuesta envuelta en { data: [...] } (estilo JSON:API) también debe desenvolverse.
  const ctx = ctxAutenticadoConDatos_([{ data: [{ id: 9 }] }]);
  const pagina = ctx.fudoApiObtenerPagina_('sales', {});
  assert.deepEqual(pagina, [{ id: 9 }]);
  console.log('fudoApiObtenerPagina_ desenvuelve .data: OK');
})();

(function () {
  reiniciarProps_();
  props.FUDO_API_KEY = 'key123';
  props.FUDO_API_SECRET = 'secret456';
  props.FUDO_API_TOKEN = 'tok-vigente';
  props.FUDO_API_TOKEN_EXP = String(Math.floor(Date.now() / 1000) + 3600);
  llamadas = [];
  fetchImpl = () => respuesta_(200, { noEsUnArreglo: true });
  const ctx = cargarFudoApi_();
  assert.throws(() => ctx.fudoApiObtenerPagina_('sales', {}), /no fue un arreglo/);
  console.log('fudoApiObtenerPagina_ respuesta inesperada: OK');
})();

(function () {
  // 2 páginas completas de tamaño 2 + una última incompleta de 1 -> debe parar ahí, 3 llamadas.
  const ctx = ctxAutenticadoConDatos_([
    [{ id: 1 }, { id: 2 }],
    [{ id: 3 }, { id: 4 }],
    [{ id: 5 }]
  ]);
  const todo = ctx.fudoApiObtenerTodo_('sales', { pageSize: 2 });
  assert.deepEqual(todo.map((r) => r.id), [1, 2, 3, 4, 5]);
  assert.equal(llamadas.length, 3);
  console.log('fudoApiObtenerTodo_ pagina hasta la última página incompleta: OK');
})();

// --- fudoApiProbarConexion_ ----------------------------------------------------------------------

(function () {
  const ctx = ctxAutenticadoConDatos_([[{ id: 1, monto: 15000 }, { id: 2, monto: 8000 }]]);
  const resultado = ctx.fudoApiProbarConexion_();
  assert.equal(resultado.ok, true);
  assert.equal(resultado.registros_recibidos, 2);
  assert.deepEqual(resultado.campos_detectados, ['id', 'monto']);
  console.log('fudoApiProbarConexion_: OK');
})();

console.log('fudo-api: OK');
