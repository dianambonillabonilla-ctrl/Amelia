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
 * Estado actual: autenticación, paginación y el helper genérico de consulta ya están listos y
 * probados. El mapeo de /sales hacia Ventas_FUDO todavía NO está conectado — antes de escribir esa
 * parte hace falta confirmar los nombres de campo reales que devuelve la cuenta (la documentación
 * pegada por Diana cubre auth/paginación/filtros/orden, no el detalle del cuerpo de cada recurso).
 * Para eso existe fudoApiProbarConexion_ (acción 'fudo_api_probar_conexion', ver Code.gs e
 * importar.html): trae una muestra cruda de /sales tal cual la devuelve FUDO, sin transformar nada.
 */

const FUDO_API_PROP_KEY_ = 'FUDO_API_KEY';
const FUDO_API_PROP_SECRET_ = 'FUDO_API_SECRET';
const FUDO_API_PROP_BASE_URL_ = 'FUDO_API_BASE_URL';
const FUDO_API_PROP_TOKEN_ = 'FUDO_API_TOKEN';
const FUDO_API_PROP_TOKEN_EXP_ = 'FUDO_API_TOKEN_EXP';
const FUDO_API_AUTH_URL_ = 'https://auth.fu.do/api';
// La documentación de Diana solo confirma el host de autenticación (auth.fu.do). Este es el mejor
// supuesto para el host de los recursos (sibling subdomain) — si fudoApiProbarConexion_ devuelve
// 404/otro error de host, corregirlo con fudoApiConfigurarCredenciales_(apiKey, apiSecret, baseUrl)
// pasando el baseUrl correcto, sin tocar código.
const FUDO_API_BASE_URL_POR_DEFECTO_ = 'https://api.fu.do';

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
    throw new Error('Autenticación con la API de FUDO falló (' + resp.getResponseCode() + '): ' + resp.getContentText());
  }
  const data = JSON.parse(resp.getContentText());
  if (!data.token) throw new Error('La API de FUDO no devolvió token: ' + resp.getContentText());

  props.setProperty(FUDO_API_PROP_TOKEN_, data.token);
  props.setProperty(FUDO_API_PROP_TOKEN_EXP_, String(data.exp || (Date.now() / 1000 + 24 * 3600)));
  return data.token;
}

/**
 * Una sola página de un recurso, según la documentación oficial: filtros = { columna: 'operador.valor' }
 * (ej. { fecha: 'gte.2026-07-01' }), orden = 'col,-col2'. Sin transformar la respuesta más allá de
 * desenvolver .data si el recurso viene envuelto así.
 */
function fudoApiObtenerPagina_(recurso, opciones) {
  opciones = opciones || {};
  const token = fudoApiObtenerToken_();
  const params = [];
  params.push('page[size]=' + encodeURIComponent(opciones.pageSize || 500));
  params.push('page[number]=' + encodeURIComponent(opciones.pagina || 1));
  Object.keys(opciones.filtros || {}).forEach(function (col) {
    params.push('filter[' + encodeURIComponent(col) + ']=' + encodeURIComponent(opciones.filtros[col]));
  });
  if (opciones.orden) params.push('sort=' + encodeURIComponent(opciones.orden));

  const url = fudoApiBaseUrl_().replace(/\/$/, '') + '/' + String(recurso).replace(/^\//, '') + '?' + params.join('&');
  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('GET ' + recurso + ' falló (' + resp.getResponseCode() + '): ' + resp.getContentText());
  }
  const data = JSON.parse(resp.getContentText());
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.data)) return data.data;
  throw new Error('La respuesta de ' + recurso + ' no fue un arreglo ni trajo .data — revisa el formato real: ' + resp.getContentText().slice(0, 300));
}

/**
 * Todas las páginas de un recurso. Sin total de páginas en la respuesta (según la documentación):
 * se avanza hasta que una página trae menos filas que pageSize (máximo 500 por la doc).
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
 * Trae una muestra cruda de /sales (3 registros, sin transformar) para confirmar contra la cuenta
 * real los nombres de campo exactos antes de conectar la sincronización automática a Ventas_FUDO.
 * Acción admin desde la app: 'fudo_api_probar_conexion' (ver Code.gs, botón en importar.html).
 */
function fudoApiProbarConexion_() {
  const muestra = fudoApiObtenerPagina_('sales', { pageSize: 3, pagina: 1 });
  return {
    ok: true,
    registros_recibidos: muestra.length,
    campos_detectados: muestra.length ? Object.keys(muestra[0]) : [],
    muestra: muestra
  };
}
