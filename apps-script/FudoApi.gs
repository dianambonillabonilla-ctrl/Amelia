/**
 * INTEGRACIÓN CON LA API GENERAL DE FUDO (dev.fu.do/api)
 * Habilitada en la cuenta de Amelia Café/La Wafflería en jul 2026 — objetivo: reemplazar la subida
 * manual de reportes .xls (ver Fudo.gs/importar.html) por una sincronización automática.
 *
 * Las credenciales (apiKey/apiSecret) las entrega soporte@fu.do para un usuario dedicado
 * (ej. api@mirestaurante). NUNCA se escriben en este archivo ni en ninguna hoja: se guardan una
 * sola vez como Propiedades del Script, corriendo fudoApiConfigurarCredenciales_(apiKey, apiSecret)
 * a mano desde el editor de Apps Script (mismo patrón que crearAdministradorInicial_ en Code.gs).
 *
 * Estado actual: autenticación, paginación, consulta genérica y la sincronización real de ventas
 * (fudoApiSincronizarVentas_) ya están listas y probadas — conexión confirmada contra la cuenta real
 * (jul 2026). /sales y /items responden en formato JSON:API: { data: [...], included: [...] } — cada
 * venta trae en "attributes" sus datos propios (createdAt, total, saleState...) y en "relationships"
 * solo punteros {type,id} a sus ítems/pagos/mesa/caja — el detalle real de esos punteros (incluido
 * el nombre del producto) llega en el arreglo "included" de la MISMA respuesta cuando se pide con
 * ?include=items.product,cashRegister (ver dev.fu.do/api, secciones "Get sales" y "Get items").
 * fudoApiSincronizarVentas_ arma con eso las mismas columnas que produce el export CSV "detallado"
 * y reutiliza toda la validación/dedupe/diagnóstico de importarFudo_ (Fudo.gs) sin duplicarla.
 */

const FUDO_API_PROP_KEY_ = 'FUDO_API_KEY';
const FUDO_API_PROP_SECRET_ = 'FUDO_API_SECRET';
const FUDO_API_PROP_BASE_URL_ = 'FUDO_API_BASE_URL';
const FUDO_API_PROP_TOKEN_ = 'FUDO_API_TOKEN';
const FUDO_API_PROP_TOKEN_EXP_ = 'FUDO_API_TOKEN_EXP';
const FUDO_API_AUTH_URL_ = 'https://auth.fu.do/api';
// Confirmado contra la documentación real de dev.fu.do/api (sección "Get sales" > "API Server"):
// no es el mismo host de autenticación (auth.fu.do), lleva el prefijo de versión /v1alpha1.
const FUDO_API_BASE_URL_POR_DEFECTO_ = 'https://api.fu.do/v1alpha1';

/** Correr UNA vez desde el editor de Apps Script (Extensiones > Apps Script) — nunca desde la app web. */
function fudoApiConfigurarCredenciales_(apiKey, apiSecret, baseUrl) {
  if (!apiKey || !apiSecret) {
    throw new Error('Faltan apiKey/apiSecret — pídelos a soporte@fu.do para un usuario dedicado (ej. api@mirestaurante).');
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty(FUDO_API_PROP_KEY_, apiKey);
  props.setProperty(FUDO_API_PROP_SECRET_, apiSecret);
  if (baseUrl) props.setProperty(FUDO_API_PROP_BASE_URL_, baseUrl);
  // Cualquier token cacheado quedó emitido con la credencial anterior (o no existe aún) — se limpia
  // para forzar pedir uno nuevo en la próxima llamada, en vez de arrastrar uno vencido o inválido.
  props.deleteProperty(FUDO_API_PROP_TOKEN_);
  props.deleteProperty(FUDO_API_PROP_TOKEN_EXP_);
  return 'Credenciales de la API de FUDO guardadas. Corre fudoApiProbarConexion_() para confirmar que funcionan.';
}

function fudoApiBaseUrl_() {
  return PropertiesService.getScriptProperties().getProperty(FUDO_API_PROP_BASE_URL_) || FUDO_API_BASE_URL_POR_DEFECTO_;
}

/**
 * Registra el detalle completo (incluido el cuerpo crudo de la respuesta remota de FUDO) en el
 * registro de ejecución bajo un código corto, y devuelve un Error con SOLO ese código — así lo que
 * FUDO responda nunca llega tal cual al navegador de quien esté usando la app (auditoría de
 * seguridad, jul 2026: antes el texto crudo de la respuesta remota se incluía directo en el mensaje
 * de error que veía el Administrador). El código no depende de Utilities (no todos los archivos que
 * cargan FudoApi.gs en pruebas la mockean) — timestamp + un componente aleatorio basta para no
 * chocar entre dos errores casi simultáneos.
 */
function fudoApiErrorConIncidente_(resumen, detalle) {
  const incidente = 'FUDO-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 1000);
  Logger.log('[' + incidente + '] ' + resumen + ': ' + detalle);
  return new Error(resumen + ' (código ' + incidente + ' — revisa el registro de ejecución de Apps Script para el detalle completo).');
}

/**
 * Pide un token nuevo solo si no hay uno guardado o le quedan menos de 5 minutos de vida — según la
 * documentación oficial el token dura 24h (campo "exp", segundos unix). Se cachea en Propiedades del
 * Script (no en CacheService, que se puede vaciar sin aviso) para que sobreviva entre ejecuciones
 * aunque pasen días sin llamadas a la API.
 */
function fudoApiObtenerToken_() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty(FUDO_API_PROP_KEY_);
  const apiSecret = props.getProperty(FUDO_API_PROP_SECRET_);
  if (!apiKey || !apiSecret) {
    throw new Error('No hay credenciales de la API de FUDO configuradas — corre fudoApiConfigurarCredenciales_(apiKey, apiSecret) desde el editor de Apps Script.');
  }

  const tokenGuardado = props.getProperty(FUDO_API_PROP_TOKEN_);
  const expGuardado = Number(props.getProperty(FUDO_API_PROP_TOKEN_EXP_) || 0);
  const margenSegundos = 300;
  if (tokenGuardado && expGuardado > (Date.now() / 1000) + margenSegundos) {
    return tokenGuardado;
  }

  const resp = UrlFetchApp.fetch(FUDO_API_AUTH_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: { Accept: 'application/json' },
    payload: JSON.stringify({ apiKey: apiKey, apiSecret: apiSecret }),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw fudoApiErrorConIncidente_('Autenticación con la API de FUDO falló (' + resp.getResponseCode() + ')', resp.getContentText());
  }
  const data = JSON.parse(resp.getContentText());
  if (!data.token) throw fudoApiErrorConIncidente_('La API de FUDO no devolvió token', resp.getContentText());

  props.setProperty(FUDO_API_PROP_TOKEN_, data.token);
  props.setProperty(FUDO_API_PROP_TOKEN_EXP_, String(data.exp || (Date.now() / 1000 + 24 * 3600)));
  return data.token;
}

/**
 * Una sola página, sin desenvolver — devuelve el JSON tal cual (con .data y, si se pidió con
 * `include`, también .included) para que cada llamador decida qué necesita. filtros = { columna:
 * 'operador.valor' } (ej. { createdAt: 'gte.2026-07-01T00:00:00' }), orden = 'col,-col2', include =
 * 'items.product,cashRegister' (comas, según la documentación oficial).
 */
function fudoApiPeticionPagina_(recurso, opciones) {
  opciones = opciones || {};
  const token = fudoApiObtenerToken_();
  const params = [];
  params.push('page[size]=' + encodeURIComponent(opciones.pageSize || 500));
  params.push('page[number]=' + encodeURIComponent(opciones.pagina || 1));
  Object.keys(opciones.filtros || {}).forEach(function (col) {
    params.push('filter[' + encodeURIComponent(col) + ']=' + encodeURIComponent(opciones.filtros[col]));
  });
  if (opciones.orden) params.push('sort=' + encodeURIComponent(opciones.orden));
  if (opciones.include) params.push('include=' + encodeURIComponent(opciones.include));

  const url = fudoApiBaseUrl_().replace(/\/$/, '') + '/' + String(recurso).replace(/^\//, '') + '?' + params.join('&');
  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw fudoApiErrorConIncidente_('GET ' + recurso + ' falló (' + resp.getResponseCode() + ')', resp.getContentText());
  }
  return JSON.parse(resp.getContentText());
}

/** Una sola página, ya desenvuelta a solo el arreglo de registros (sin .included). */
function fudoApiObtenerPagina_(recurso, opciones) {
  const data = fudoApiPeticionPagina_(recurso, opciones);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.data)) return data.data;
  throw fudoApiErrorConIncidente_('La respuesta de ' + recurso + ' no fue un arreglo ni trajo .data', JSON.stringify(data));
}

/**
 * Todas las páginas de un recurso, ya desenvuelto. Sin total de páginas en la respuesta (según la
 * documentación): se avanza hasta que una página trae menos filas que pageSize (máximo 500 por la doc).
 */
function fudoApiObtenerTodo_(recurso, opciones) {
  opciones = opciones || {};
  const pageSize = opciones.pageSize || 500;
  const resultados = [];
  let pagina = 1;
  while (true) {
    const pageResult = fudoApiObtenerPagina_(recurso, Object.assign({}, opciones, { pageSize: pageSize, pagina: pagina }));
    resultados.push.apply(resultados, pageResult);
    if (pageResult.length < pageSize) break;
    pagina++;
    if (pagina > 200) {
      throw new Error('fudoApiObtenerTodo_(' + recurso + '): más de 200 páginas sin terminar — revisa los filtros antes de seguir.');
    }
  }
  return resultados;
}

/**
 * Todas las páginas de un recurso, CONSERVANDO también los "incluidos" (.included) de cada página —
 * necesario para /sales?include=items.product,cashRegister, donde el detalle real (nombre del
 * producto, nombre de la caja) no viene en .data sino en .included, indexado por "type:id" para
 * resolverlo desde cualquier puntero {type,id} de una relationship.
 */
function fudoApiObtenerTodoCompleto_(recurso, opciones) {
  opciones = opciones || {};
  const pageSize = opciones.pageSize || 500;
  const registros = [];
  const incluidosPorClave = {};
  let pagina = 1;
  while (true) {
    const cruda = fudoApiPeticionPagina_(recurso, Object.assign({}, opciones, { pageSize: pageSize, pagina: pagina }));
    const pageData = Array.isArray(cruda) ? cruda : (Array.isArray(cruda.data) ? cruda.data : null);
    if (!pageData) {
      throw fudoApiErrorConIncidente_('La respuesta de ' + recurso + ' no fue un arreglo ni trajo .data', JSON.stringify(cruda));
    }
    registros.push.apply(registros, pageData);
    (cruda.included || []).forEach(function (inc) {
      incluidosPorClave[inc.type + ':' + inc.id] = inc;
    });
    if (pageData.length < pageSize) break;
    pagina++;
    if (pagina > 200) {
      throw new Error('fudoApiObtenerTodoCompleto_(' + recurso + '): más de 200 páginas sin terminar — revisa los filtros antes de seguir.');
    }
  }
  return { registros: registros, incluidos: incluidosPorClave };
}

/**
 * Una venta (con sus relationships.items ya resueltos vía "incluidos") → una fila por ítem vendido,
 * con las MISMAS columnas que trae el export CSV "detallado" de FUDO (ver importarFudoConLock_ en
 * Fudo.gs) — así el resto de la importación (validación, dedupe, diagnóstico) no necesita saber si
 * el dato vino de un archivo o de la API. Ítems sin producto resuelto en "incluidos" (no debería
 * pasar si se pidió con include=items.product, pero por seguridad) se omiten en vez de guardarse
 * con el nombre vacío.
 */
function fudoApiFilasVentaDesdeSale_(sale, incluidos) {
  const itemsPtr = (sale.relationships && sale.relationships.items && sale.relationships.items.data) || [];
  const cashRegisterPtr = sale.relationships && sale.relationships.cashRegister && sale.relationships.cashRegister.data;
  const cashRegister = cashRegisterPtr ? incluidos[cashRegisterPtr.type + ':' + cashRegisterPtr.id] : null;
  const creadaPor = (cashRegister && cashRegister.attributes && cashRegister.attributes.name) || '';

  const filas = [];
  itemsPtr.forEach(function (ptr) {
    const item = incluidos[ptr.type + ':' + ptr.id];
    if (!item || !item.attributes) return;
    const productoPtr = item.relationships && item.relationships.product && item.relationships.product.data;
    const producto = productoPtr ? incluidos[productoPtr.type + ':' + productoPtr.id] : null;
    if (!producto || !producto.attributes || !producto.attributes.name) return;
    const creacion = item.attributes.createdAt || (sale.attributes && sale.attributes.createdAt);
    filas.push({
      'Id. Venta': String(sale.id),
      'Creación': creacion ? new Date(creacion) : '',
      'Producto': producto.attributes.name,
      'Categoría': '',
      'Cantidad': item.attributes.quantity,
      'Precio': item.attributes.price,
      'Cancelada': !!item.attributes.canceled,
      'Creada por': creadaPor
    });
  });
  return filas;
}

/**
 * Sincroniza ventas CERRADAS de FUDO (filter[saleState]=eq.CLOSED — no interesan pendientes ni
 * canceladas) para un rango de fechas hacia Ventas_FUDO, reutilizando importarFudo_ (Fudo.gs) para
 * la validación/dedupe/diagnóstico — mismo destino y mismas reglas que la subida manual del CSV
 * "detallado", solo que la fuente es la API. fechaDesde/fechaHasta en formato 'yyyy-MM-dd'.
 * Acción admin desde la app: 'fudo_api_sincronizar_ventas' (ver Code.gs, importar.html).
 */
function fudoApiSincronizarVentas_(fechaDesde, fechaHasta, usuario, opciones) {
  opciones = opciones || {};
  if (!fechaDesde || !fechaHasta) return { ok: false, error: 'Faltan fecha_desde/fecha_hasta' };

  const resultado = fudoApiObtenerTodoCompleto_('sales', {
    filtros: {
      createdAt: 'and(gte.' + fechaDesde + 'T00:00:00,lte.' + fechaHasta + 'T23:59:59)',
      // saleState no acepta eq. — su patrón real (según la documentación) solo permite in.(...).
      saleState: 'in.(CLOSED)'
    },
    include: 'items.product,cashRegister',
    orden: 'createdAt'
  });

  const filas = [];
  resultado.registros.forEach(function (sale) {
    filas.push.apply(filas, fudoApiFilasVentaDesdeSale_(sale, resultado.incluidos));
  });

  if (!filas.length) {
    return { ok: true, importados: 0, omitidos_duplicados: 0, tipo: 'ventas', ventas_encontradas: resultado.registros.length };
  }

  return importarFudo_('ventas', filas, usuario, Object.assign({ archivo: 'API FUDO ' + fechaDesde + ' a ' + fechaHasta }, opciones));
}

/**
 * Trae una muestra cruda de /sales (3 registros, sin transformar) para confirmar contra la cuenta
 * real los nombres de campo exactos antes de conectar la sincronización automática a Ventas_FUDO.
 * Acción admin desde la app: 'fudo_api_probar_conexion' (ver Code.gs, botón en importar.html).
 *
 * jul 2026: una muestra real mostró que sale.relationships NO trae `cashRegister` (solo customer,
 * discounts, items, payments, tips, shippingCosts, table, waiter, saleIdentifier) — el supuesto
 * original (caja registradora → sede) no aplica a esta cuenta. Se pide incluido table/waiter/payments
 * además de items.product para buscar ahí un dato de sede real, sin gastar otro ciclo de despliegue.
 */
function fudoApiProbarConexion_() {
  const cruda = fudoApiPeticionPagina_('sales', { pageSize: 3, pagina: 1, include: 'items.product,table,waiter,payments' });
  const muestra = Array.isArray(cruda) ? cruda : (cruda.data || []);
  return {
    ok: true,
    registros_recibidos: muestra.length,
    campos_detectados: muestra.length ? Object.keys(muestra[0]) : [],
    tipos_incluidos: (cruda.included || []).reduce(function (acc, inc) {
      acc[inc.type] = acc[inc.type] || Object.keys(inc.attributes || {});
      return acc;
    }, {}),
    muestra: muestra,
    incluidos: cruda.included || []
  };
}
