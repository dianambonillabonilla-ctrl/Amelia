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

// --- fudoApiObtenerTodoCompleto_ ------------------------------------------------------------------

(function () {
  reiniciarProps_();
  props.FUDO_API_KEY = 'key123';
  props.FUDO_API_SECRET = 'secret456';
  props.FUDO_API_TOKEN = 'tok-vigente';
  props.FUDO_API_TOKEN_EXP = String(Math.floor(Date.now() / 1000) + 3600);
  llamadas = [];
  let i = 0;
  const paginas = [
    { data: [{ type: 'Sale', id: '1' }, { type: 'Sale', id: '2' }], included: [{ type: 'Item', id: '1' }] },
    { data: [{ type: 'Sale', id: '3' }], included: [{ type: 'Product', id: '9' }] }
  ];
  fetchImpl = () => { const body = paginas[Math.min(i, paginas.length - 1)]; i++; return respuesta_(200, body); };
  const ctx = cargarFudoApi_();
  const resultado = ctx.fudoApiObtenerTodoCompleto_('sales', { pageSize: 2, include: 'items.product' });
  assert.deepEqual(resultado.registros.map((r) => r.id), ['1', '2', '3']);
  assert.deepEqual(Object.keys(resultado.incluidos).sort(), ['Item:1', 'Product:9']);
  assert.ok(llamadas[0].url.includes('include=' + encodeURIComponent('items.product')));
  console.log('fudoApiObtenerTodoCompleto_ acumula incluidos entre páginas: OK');
})();

// --- fudoApiFilasVentaDesdeSale_ ------------------------------------------------------------------

(function () {
  const ctx = cargarFudoApi_();
  const incluidos = {
    'Item:1': { type: 'Item', id: '1', attributes: { createdAt: '2026-07-20T12:00:00Z', quantity: 2, price: 15000, canceled: false }, relationships: { product: { data: { type: 'Product', id: '10' } } } },
    'Item:2': { type: 'Item', id: '2', attributes: { createdAt: '2026-07-20T12:01:00Z', quantity: 1, price: 8000, canceled: true }, relationships: { product: { data: { type: 'Product', id: '11' } } } },
    'Product:10': { type: 'Product', id: '10', attributes: { name: 'Waffle Bonitos' } },
    'Product:11': { type: 'Product', id: '11', attributes: { name: 'Limonada' } },
    'CashRegister:5': { type: 'CashRegister', id: '5', attributes: { name: 'Caja Capri' } }
  };
  const sale = {
    id: '100',
    attributes: { createdAt: '2026-07-20T11:55:00Z' },
    relationships: {
      items: { data: [{ type: 'Item', id: '1' }, { type: 'Item', id: '2' }] },
      cashRegister: { data: { type: 'CashRegister', id: '5' } }
    }
  };
  const filas = ctx.fudoApiFilasVentaDesdeSale_(sale, incluidos);
  assert.equal(filas.length, 2);
  assert.equal(filas[0]['Id. Venta'], '100');
  assert.equal(filas[0]['Producto'], 'Waffle Bonitos');
  assert.equal(filas[0]['Cantidad'], 2);
  assert.equal(filas[0]['Precio'], 15000);
  assert.equal(filas[0]['Cancelada'], false);
  assert.equal(filas[0]['Creada por'], 'Caja Capri');
  // instanceof Date falla entre contextos de vm distintos (el Date de FudoApi.gs no es el mismo
  // constructor que el de este archivo de test) — se verifica por forma en vez de por instancia.
  assert.equal(Object.prototype.toString.call(filas[0]['Creación']), '[object Date]');
  assert.equal(filas[1]['Producto'], 'Limonada');
  assert.equal(filas[1]['Cancelada'], true);
  console.log('fudoApiFilasVentaDesdeSale_ mapea ítems con producto/caja resueltos: OK');
})();

(function () {
  // Ítem sin producto resuelto en "incluidos" (no debería pasar con include=items.product, pero por
  // seguridad no debe colarse con el nombre vacío) se omite en vez de generar una fila inválida.
  const ctx = cargarFudoApi_();
  const incluidos = {
    'Item:1': { type: 'Item', id: '1', attributes: { createdAt: '2026-07-20T12:00:00Z', quantity: 1, price: 5000, canceled: false }, relationships: { product: { data: { type: 'Product', id: '99' } } } }
  };
  const sale = { id: '200', attributes: {}, relationships: { items: { data: [{ type: 'Item', id: '1' }] } } };
  const filas = ctx.fudoApiFilasVentaDesdeSale_(sale, incluidos);
  assert.equal(filas.length, 0);
  console.log('fudoApiFilasVentaDesdeSale_ omite ítems sin producto resuelto: OK');
})();

// --- fudoApiSincronizarVentas_ --------------------------------------------------------------------

(function () {
  reiniciarProps_();
  props.FUDO_API_KEY = 'key123';
  props.FUDO_API_SECRET = 'secret456';
  props.FUDO_API_TOKEN = 'tok-vigente';
  props.FUDO_API_TOKEN_EXP = String(Math.floor(Date.now() / 1000) + 3600);
  llamadas = [];
  fetchImpl = () => respuesta_(200, {
    data: [{
      id: '1',
      attributes: { createdAt: '2026-07-20T11:55:00Z' },
      relationships: { items: { data: [{ type: 'Item', id: '1' }] } }
    }],
    included: [
      { type: 'Item', id: '1', attributes: { createdAt: '2026-07-20T12:00:00Z', quantity: 2, price: 15000, canceled: false }, relationships: { product: { data: { type: 'Product', id: '10' } } } },
      { type: 'Product', id: '10', attributes: { name: 'Waffle Bonitos' } }
    ]
  });

  let llamadaImportarFudo = null;
  const importarFudoMock_ = (tipo, filas, usuario, opciones) => {
    llamadaImportarFudo = { tipo, filas, usuario, opciones };
    return { ok: true, importados: filas.length, omitidos_duplicados: 0, tipo: tipo };
  };

  const ctx = cargar('apps-script/FudoApi.gs', {
    PropertiesService: fakePropertiesService,
    UrlFetchApp: fakeUrlFetchApp,
    importarFudo_: importarFudoMock_
  });

  const usuario = { nombre: 'Admin' };
  const resultado = ctx.fudoApiSincronizarVentas_('2026-07-20', '2026-07-20', usuario, {});
  assert.equal(resultado.ok, true);
  assert.equal(resultado.importados, 1);
  assert.ok(llamadaImportarFudo);
  assert.equal(llamadaImportarFudo.tipo, 'ventas');
  assert.equal(llamadaImportarFudo.filas.length, 1);
  assert.equal(llamadaImportarFudo.filas[0]['Producto'], 'Waffle Bonitos');
  assert.equal(llamadaImportarFudo.usuario, usuario);
  assert.ok(/API FUDO 2026-07-20 a 2026-07-20/.test(llamadaImportarFudo.opciones.archivo));

  const url = llamadas[0].url;
  assert.ok(url.includes('filter[createdAt]=' + encodeURIComponent('and(gte.2026-07-20T00:00:00,lte.2026-07-20T23:59:59)')));
  assert.ok(url.includes('filter[saleState]=' + encodeURIComponent('eq.CLOSED')));
  console.log('fudoApiSincronizarVentas_ arma filtros y delega en importarFudo_: OK');
})();

(function () {
  reiniciarProps_();
  props.FUDO_API_KEY = 'key123';
  props.FUDO_API_SECRET = 'secret456';
  props.FUDO_API_TOKEN = 'tok-vigente';
  props.FUDO_API_TOKEN_EXP = String(Math.floor(Date.now() / 1000) + 3600);
  llamadas = [];
  fetchImpl = () => respuesta_(200, { data: [], included: [] });

  let seLlamoImportarFudo = false;
  const ctx = cargar('apps-script/FudoApi.gs', {
    PropertiesService: fakePropertiesService,
    UrlFetchApp: fakeUrlFetchApp,
    importarFudo_: () => { seLlamoImportarFudo = true; }
  });

  const resultado = ctx.fudoApiSincronizarVentas_('2026-07-20', '2026-07-20', { nombre: 'Admin' }, {});
  assert.equal(resultado.ok, true);
  assert.equal(resultado.importados, 0);
  assert.equal(resultado.ventas_encontradas, 0);
  assert.equal(seLlamoImportarFudo, false);
  console.log('fudoApiSincronizarVentas_ sin ventas no llama a importarFudo_: OK');
})();

(function () {
  const ctx = cargarFudoApi_();
  const resultado = ctx.fudoApiSincronizarVentas_('', '2026-07-20', { nombre: 'Admin' }, {});
  assert.equal(resultado.ok, false);
  console.log('fudoApiSincronizarVentas_ exige fecha_desde/fecha_hasta: OK');
})();

console.log('fudo-api: OK');
