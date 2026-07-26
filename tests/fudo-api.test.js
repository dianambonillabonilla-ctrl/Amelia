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

// fudoApiErrorConIncidente_ registra el detalle completo con Logger.log antes de lanzar un error
// "limpio" (auditoría de seguridad, jul 2026: ya no se manda el cuerpo crudo de la respuesta remota
// de FUDO directo al navegador) — se guarda lo logueado para poder comprobar que el detalle SÍ
// quedó registrado en alguna parte, aunque no viaje al cliente.
let logueado = [];
const fakeLogger = { log: (msg) => { logueado.push(msg); } };

function cargarFudoApi_(extras = {}) {
  const lockMock = {
    tryLock: () => true,
    releaseLock: () => {}
  };
  const base = {
    SHEET_NAMES: { FUDO_MAPEO_SEDES: 'mapeo', VENTAS_FUDO: 'ventas', PAGOS_FUDO: 'pagos' },
    normalizar_: (s) => String(s || '').trim().toLowerCase(),
    formatearFecha_: (v) => {
      if (v && typeof v === 'object' && typeof v.toISOString === 'function') return v.toISOString().slice(0, 10);
      return String(v || '').slice(0, 10);
    },
    leerTabla_: (h) => h === 'mapeo' ? (extras.mapeos || []) : [],
    neutralizarObjetoFormulas_: (o) => o,
    appendRowsFromObjs_: () => {},
    sheet_: () => ({ getDataRange: () => ({ getValues: () => [['id_pago']] }) }),
    LockService: { getScriptLock: () => lockMock },
    PropertiesService: fakePropertiesService,
    UrlFetchApp: fakeUrlFetchApp,
    Logger: fakeLogger
  };
  const ctx = Object.assign(base, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('apps-script/FudoMapeoSedes.gs', 'utf8'), ctx, { filename: 'FudoMapeoSedes.gs' });
  vm.runInContext(fs.readFileSync('apps-script/PagosFudo.gs', 'utf8'), ctx, { filename: 'PagosFudo.gs' });
  vm.runInContext(fs.readFileSync('apps-script/FudoApi.gs', 'utf8'), ctx, { filename: 'FudoApi.gs' });
  return ctx;
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
  fetchImpl = () => respuesta_(401, { error: 'credenciales inválidas', pista_secreta_del_proveedor: 'no debe llegar al navegador' });
  const ctx = cargarFudoApi_();
  assert.throws(() => ctx.fudoApiObtenerToken_(), /Autenticación con la API de FUDO falló \(401\)/);
  console.log('fudoApiObtenerToken_ error de auth: OK');
})();

// --- fudoApiErrorConIncidente_: el cuerpo crudo de la respuesta de FUDO nunca debe llegar al mensaje
// que ve el usuario — solo un código de incidente, con el detalle completo en el registro (Logger).
(function () {
  reiniciarProps_();
  props.FUDO_API_KEY = 'key123';
  props.FUDO_API_SECRET = 'secret456';
  llamadas = [];
  logueado = [];
  fetchImpl = () => respuesta_(401, { error: 'credenciales inválidas', pista_secreta_del_proveedor: 'no debe llegar al navegador' });
  const ctx = cargarFudoApi_();
  let mensaje = '';
  try {
    ctx.fudoApiObtenerToken_();
  } catch (err) {
    mensaje = err.message;
  }
  assert.ok(!mensaje.includes('pista_secreta_del_proveedor'), 'el mensaje visible NO debe incluir el cuerpo crudo de la respuesta de FUDO');
  assert.match(mensaje, /código FUDO-/, 'el mensaje visible debe traer un código de incidente');
  assert.ok(logueado.some((l) => l.includes('pista_secreta_del_proveedor')), 'el detalle completo SÍ debe quedar en el registro de ejecución');
  console.log('fudoApiErrorConIncidente_ oculta el cuerpo crudo y deja código de incidente: OK');
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
  const mapeos = [{ tipo_referencia: 'Sala', nombre: 'Terraza Capri', sede: 'Capri' }];
  const ctx = cargarFudoApi_({ mapeos: mapeos });
  const incluidos = {
    'Item:1': { type: 'Item', id: '1', attributes: { createdAt: '2026-07-20T12:00:00Z', quantity: 2, price: 15000, canceled: false }, relationships: { product: { data: { type: 'Product', id: '10' } } } },
    'Item:2': { type: 'Item', id: '2', attributes: { createdAt: '2026-07-20T12:01:00Z', quantity: 1, price: 8000, canceled: true }, relationships: { product: { data: { type: 'Product', id: '11' } } } },
    'Product:10': { type: 'Product', id: '10', attributes: { name: 'Waffle Bonitos' } },
    'Product:11': { type: 'Product', id: '11', attributes: { name: 'Limonada' } },
    'Table:13': { type: 'Table', id: '13', relationships: { room: { data: { type: 'Room', id: '3' } } } },
    'Room:3': { type: 'Room', id: '3', attributes: { name: 'Terraza Capri' } }
  };
  const sale = {
    id: '100',
    attributes: { createdAt: '2026-07-20T11:55:00Z' },
    relationships: {
      items: { data: [{ type: 'Item', id: '1' }, { type: 'Item', id: '2' }] },
      table: { data: { type: 'Table', id: '13' } }
    }
  };
  const filas = ctx.fudoApiFilasVentaDesdeSale_(sale, incluidos);
  assert.equal(filas.length, 2);
  assert.equal(filas[0]['Id. Venta'], '100');
  assert.equal(filas[0]['Producto'], 'Waffle Bonitos');
  assert.equal(filas[0]['Cantidad'], 2);
  assert.equal(filas[0]['Precio'], 15000);
  assert.equal(filas[0]['Cancelada'], false);
  assert.equal(filas[0]['Creada por'], 'Terraza Capri');
  assert.ok('Sede' in filas[0], 'debe traer una columna Sede además de Creada por');
  // instanceof Date falla entre contextos de vm distintos (el Date de FudoApi.gs no es el mismo
  // constructor que el de este archivo de test) — se verifica por forma en vez de por instancia.
  assert.equal(Object.prototype.toString.call(filas[0]['Creación']), '[object Date]');
  assert.equal(filas[1]['Producto'], 'Limonada');
  assert.equal(filas[1]['Cancelada'], true);
  console.log('fudoApiFilasVentaDesdeSale_ mapea ítems con producto/sala resueltos: OK');
})();

(function () {
  const mapeos = [{ tipo_referencia: 'Caja', nombre: 'Caja Capri', sede: 'Capri' }];
  const ctx = cargarFudoApi_({ mapeos: mapeos });
  const incluidos = {
    'Item:1': { type: 'Item', id: '1', attributes: { createdAt: '2026-07-20T12:00:00Z', quantity: 1, price: 5000, canceled: false }, relationships: { product: { data: { type: 'Product', id: '10' } } } },
    'Product:10': { type: 'Product', id: '10', attributes: { name: 'Delivery' } },
    'CashRegister:5': { type: 'CashRegister', id: '5', attributes: { name: 'Caja Capri' } }
  };
  const sale = {
    id: '300',
    attributes: { createdAt: '2026-07-20T11:55:00Z' },
    relationships: {
      items: { data: [{ type: 'Item', id: '1' }] },
      cashRegister: { data: { type: 'CashRegister', id: '5' } }
    }
  };
  const filas = ctx.fudoApiFilasVentaDesdeSale_(sale, incluidos);
  assert.equal(filas.length, 1);
  assert.equal(filas[0]['Creada por'], 'Caja Capri');
  assert.equal(filas[0]['Sede'], 'Capri');
  console.log('fudoApiFilasVentaDesdeSale_ resuelve sede por caja sin mesa: OK');
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

(function () {
  // Venta SIN mesa (delivery/take away) pero CON mesero e identificador de venta incluidos (piden
  // include=waiter,saleIdentifier en fudoApiSincronizarVentas_) — debe extraer ambas referencias y
  // pasárselas a fudoResolverSedeVenta_ (no solo la sala, que acá ni existe). NO debe intentar
  // extraer "caja registradora": /sales no tiene esa relación en la especificación oficial.
  let referenciasRecibidas = null;
  const ctx = cargar('apps-script/FudoApi.gs', {
    PropertiesService: fakePropertiesService,
    UrlFetchApp: fakeUrlFetchApp,
    Logger: fakeLogger,
    fudoResolverSedeVenta_: (referencias) => {
      referenciasRecibidas = referencias;
      return { sede: 'Capri', resuelto_por: 'Usuario' };
    }
  });
  const incluidos = {
    'Item:1': { type: 'Item', id: '1', attributes: { createdAt: '2026-07-21T12:00:00Z', quantity: 1, price: 20000, canceled: false }, relationships: { product: { data: { type: 'Product', id: '1' } } } },
    'Product:1': { type: 'Product', id: '1', attributes: { name: 'Domicilio Chanchostilla' } },
    'User:7': { type: 'User', id: '7', attributes: { name: 'Ana Mesera' } },
    'SaleIdentifier:9': { type: 'SaleIdentifier', id: '9', attributes: { name: 'Domicilios Capri' } }
  };
  const sale = {
    id: '300',
    attributes: {},
    relationships: {
      items: { data: [{ type: 'Item', id: '1' }] },
      waiter: { data: { type: 'User', id: '7' } },
      saleIdentifier: { data: { type: 'SaleIdentifier', id: '9' } }
    }
  };
  const filas = ctx.fudoApiFilasVentaDesdeSale_(sale, incluidos);
  assert.deepEqual(referenciasRecibidas, { sala: null, identificador: 'Domicilios Capri', usuario: 'Ana Mesera' });
  assert.equal(filas[0]['Sede'], 'Capri', 'debe usar la sede que devuelva fudoResolverSedeVenta_');
  assert.equal(filas[0]['Creada por'], '', 'sin mesa, "Creada por" (sala) sigue vacío como siempre');
  console.log('fudoApiFilasVentaDesdeSale_ extrae mesero/identificador de venta para fudoResolverSedeVenta_: OK');
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
    Logger: fakeLogger,
    importarFudo_: importarFudoMock_,
    fudoResolverSedeVenta_: fudoResolverSedeVentaMock_
  });

  const usuario = { nombre: 'Admin' };
  const resultado = ctx.fudoApiSincronizarVentas_('2026-07-20', '2026-07-20', usuario, {});
  assert.equal(resultado.ok, true);
  assert.equal(resultado.importados, 1);
  assert.ok(llamadaImportarFudo);
  assert.equal(llamadaImportarFudo.tipo, 'ventas');
  assert.equal(llamadaImportarFudo.filas.length, 1);
  assert.equal(llamadaImportarFudo.filas[0]['Producto'], 'Waffle Bonitos');
  assert.equal(llamadaImportarFudo.filas[0]['Sede'], 'Sin identificar', 'sin mapeos configurados (mock por defecto), debe quedar Sin identificar');
  assert.equal(llamadaImportarFudo.usuario, usuario);
  assert.ok(/API FUDO 2026-07-20 a 2026-07-20/.test(llamadaImportarFudo.opciones.archivo));

  const url = llamadas[0].url;
  assert.ok(url.includes('filter[createdAt]=' + encodeURIComponent('and(gte.2026-07-20T00:00:00,lte.2026-07-20T23:59:59)')));
  assert.ok(url.includes('filter[saleState]=' + encodeURIComponent('in.(CLOSED)')));
  assert.ok(url.includes('include=' + encodeURIComponent('items.product,table.room,waiter,saleIdentifier')), 'debe pedir waiter y saleIdentifier además de table.room, para tener más oportunidades de resolver la sede');
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
    Logger: fakeLogger,
    SHEET_NAMES: { FUDO_MAPEO_SEDES: 'mapeo' },
    normalizar_: (s) => String(s || '').trim().toLowerCase(),
    leerTabla_: () => [],
    fudoResolverSedeVenta_: () => ({ sede: 'Sin identificar', resuelto_por: null }),
    fudoMapeoSedeIndice_: () => ({}),
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

// --- fudoApiTomarSnapshotStock_ --------------------------------------------------------------------
// Trae /products + /ingredients y los manda a stockFudoBaseImportar_ (StockFudoBase.gs) con el
// mismo upsert que ya usaba la carga manual del Excel — no se crea una hoja/lógica paralela para
// lo mismo (ver docs/modelo-inventario.md, sección "Cómo se usa el stock de Fudo").

(function () {
  reiniciarProps_();
  props.FUDO_API_KEY = 'key123';
  props.FUDO_API_SECRET = 'secret456';
  props.FUDO_API_TOKEN = 'tok-vigente';
  props.FUDO_API_TOKEN_EXP = String(Math.floor(Date.now() / 1000) + 3600);
  llamadas = [];
  fetchImpl = (url) => {
    if (url.indexOf('/products') !== -1) {
      return respuesta_(200, {
        data: [{ id: '1', attributes: { name: 'Costilla Preparada', stock: 12.5 }, relationships: { unit: { data: { type: 'Unit', id: '5' } } } }],
        included: [{ type: 'Unit', id: '5', attributes: { name: 'kg' } }]
      });
    }
    if (url.indexOf('/ingredients') !== -1) {
      // Ingrediente sin unidad resuelta en "incluidos" (no debería pasar con include=unit, pero por
      // seguridad no debe reventar) — debe quedar en '', no inventarse una unidad.
      return respuesta_(200, { data: [{ id: '2', attributes: { name: 'Costilla cruda', stock: 40 } }], included: [] });
    }
    return respuesta_(200, { data: [] });
  };

  let llamadaStockFudoBase = null;
  const ctx = cargarFudoApi_({
    stockFudoBaseImportar_: (filas, usuario) => {
      llamadaStockFudoBase = { filas, usuario };
      return { ok: true, actualizados: 0, creados: filas.length, sin_nombre: 0, sin_stock: 0 };
    }
  });

  const resultado = ctx.fudoApiTomarSnapshotStock_({ nombre: 'Admin' });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.creados, 2, 'debe pasar 1 producto + 1 ingrediente a stockFudoBaseImportar_');
  assert.ok(llamadaStockFudoBase, 'debe delegar en stockFudoBaseImportar_, no reimplementar el upsert');
  assert.equal(llamadaStockFudoBase.usuario.nombre, 'Admin');
  const porTipo = {};
  llamadaStockFudoBase.filas.forEach((f) => { porTipo[f.tipo] = f; });
  assert.equal(porTipo['Producto'].nombre_fudo, 'Costilla Preparada');
  assert.equal(porTipo['Producto'].stock, 12.5);
  assert.equal(porTipo['Producto'].unidad, 'kg', 'debe resolver la unidad real vía relationships.unit + included, no dejarla en blanco');
  assert.equal(porTipo['Ingrediente'].nombre_fudo, 'Costilla cruda');
  assert.equal(porTipo['Ingrediente'].stock, 40);
  assert.equal(porTipo['Ingrediente'].unidad, '', 'sin unidad resuelta en "incluidos", debe quedar en blanco, no inventar una');
  console.log('fudoApiTomarSnapshotStock_ arma filas de /products e /ingredients (con unidad real) y delega en stockFudoBaseImportar_: OK');
})();

(function () {
  // Sin ningún producto/ingrediente con nombre, no debe llamar a stockFudoBaseImportar_ con un
  // arreglo vacío (evita una escritura sin sentido a Sheets).
  reiniciarProps_();
  props.FUDO_API_KEY = 'key123';
  props.FUDO_API_SECRET = 'secret456';
  props.FUDO_API_TOKEN = 'tok-vigente';
  props.FUDO_API_TOKEN_EXP = String(Math.floor(Date.now() / 1000) + 3600);
  llamadas = [];
  fetchImpl = () => respuesta_(200, { data: [] });

  let seLlamo = false;
  const ctx = cargarFudoApi_({
    stockFudoBaseImportar_: () => { seLlamo = true; return { ok: true }; }
  });
  const resultado = ctx.fudoApiTomarSnapshotStock_({ nombre: 'Admin' });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.creados, 0);
  assert.equal(seLlamo, false, 'sin filas no debe llamar a stockFudoBaseImportar_');
  console.log('fudoApiTomarSnapshotStock_ sin productos/ingredientes no llama a stockFudoBaseImportar_: OK');
})();

// --- fudoApiFilaPagoDesdePayment_ / fudoApiSincronizarPagos_ -------------------------------------

(function () {
  const ctx = cargarFudoApi_();
  const incluidos = {
    'PaymentMethod:1': { type: 'PaymentMethod', id: '1', attributes: { name: 'Efectivo', kind: 'CASH' } },
    'PaymentMethod:2': { type: 'PaymentMethod', id: '2', attributes: { name: 'Tarjeta débito', kind: 'DEBIT-CARD' } }
  };
  const sedePorVenta = { '500': 'Capri' };
  const pagoEfectivo = {
    id: '77',
    attributes: { amount: 25000, canceled: false, createdAt: '2026-07-20T18:00:00Z' },
    relationships: {
      sale: { data: { type: 'Sale', id: '500' } },
      paymentMethod: { data: { type: 'PaymentMethod', id: '1' } }
    }
  };
  const fila = ctx.fudoApiFilaPagoDesdePayment_(pagoEfectivo, incluidos, sedePorVenta);
  assert.equal(fila.id_pago, '77');
  assert.equal(fila.id_venta, '500');
  assert.equal(fila.monto, 25000);
  assert.equal(fila.metodo_pago, 'Efectivo');
  assert.equal(fila.metodo_tipo, 'CASH');
  assert.equal(fila.sede, 'Capri');
  assert.equal(fila.fecha, '2026-07-20');

  const pagoSinVenta = ctx.fudoApiFilaPagoDesdePayment_({
    id: '88',
    attributes: { amount: 1000, canceled: false, createdAt: '2026-07-20T19:00:00Z' },
    relationships: { paymentMethod: { data: { type: 'PaymentMethod', id: '2' } } }
  }, incluidos, {});
  assert.equal(pagoSinVenta.sede, 'Sin identificar');
  console.log('fudoApiFilaPagoDesdePayment_ resuelve sede y método: OK');
})();

(function () {
  reiniciarProps_();
  props.FUDO_API_KEY = 'key123';
  props.FUDO_API_SECRET = 'secret456';
  props.FUDO_API_TOKEN = 'tok-vigente';
  props.FUDO_API_TOKEN_EXP = String(Math.floor(Date.now() / 1000) + 3600);
  llamadas = [];
  fetchImpl = () => respuesta_(200, {
    data: [{
      id: '77',
      type: 'Payment',
      attributes: { amount: 25000, canceled: false, createdAt: '2026-07-20T18:00:00Z' },
      relationships: {
        sale: { data: { type: 'Sale', id: '500' } },
        paymentMethod: { data: { type: 'PaymentMethod', id: '1' } }
      }
    }],
    included: [{ type: 'PaymentMethod', id: '1', attributes: { name: 'Efectivo', kind: 'CASH' } }]
  });

  let llamadaImportar = null;
  const ctx = cargarFudoApi_({
    leerTabla_: (h) => {
      if (h === 'mapeo') return [];
      if (h === 'ventas') return [{ id_venta: '500', sede: 'Capri' }];
      return [];
    }
  });
  ctx.pagosFudoImportar_ = (filas, usuario, opciones) => {
    llamadaImportar = { filas, usuario, opciones };
    return { ok: true, importados: filas.length, actualizados: 0, omitidos: 0, tipo: 'pagos' };
  };

  const resultado = ctx.fudoApiSincronizarPagos_('2026-07-20', '2026-07-20', { nombre: 'Admin' }, {});
  assert.equal(resultado.ok, true);
  assert.equal(resultado.importados, 1);
  assert.ok(llamadaImportar);
  assert.equal(llamadaImportar.filas[0].sede, 'Capri');
  const url = llamadas[0].url;
  assert.ok(url.includes('/payments?'));
  assert.ok(url.includes('filter[canceled]=' + encodeURIComponent('neq.true')));
  assert.ok(url.includes('filter[sales.saleState]=' + encodeURIComponent('in.(CLOSED)')));
  console.log('fudoApiSincronizarPagos_ arma filtros y delega en pagosFudoImportar_: OK');
})();

console.log('fudo-api: OK');
