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
 * solo punteros {type,id} a sus ítems/pagos/mesa/mesero (NO trae "cashRegister" — confirmado con una
 * muestra real, jul 2026) — el detalle real de esos punteros (incluido el nombre del producto) llega
 * en el arreglo "included" de la MISMA respuesta cuando se pide con ?include=items.product,table.room.
 * fudoApiSincronizarVentas_ arma con eso las mismas columnas que produce el export CSV "detallado"
 * y reutiliza toda la validación/dedupe/diagnóstico de importarFudo_ (Fudo.gs) sin duplicarla.
 *
 * Sede: FUDO no tiene ningún campo de sede/sucursal en ningún recurso (confirmado contra la
 * especificación OpenAPI oficial completa, jul 2026) — se infiere por venta → mesa (table) → sala
 * (room), porque en esta cuenta las salas están nombradas por sede ("Salón SA", "Terraza SA",
 * "Terraza Capri", "La Waffleria - Capri" — confirmado con /rooms real, jul 2026). Ventas sin mesa
 * (delivery/take away/menú online) quedan "Sin identificar" — no hay otro dato de sede disponible
 * para esos casos.
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
// Incluidos válidos para GET /sales según apps-script/fudo-openapi.yml (jul 2026).
const FUDO_API_SALES_INCLUDE_ = 'items.product,items.subitems.product,table.room,waiter,saleIdentifier,payments.paymentMethod,discounts.discountTemplate,tips';

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
 * 'items.product,table.room' (comas, según la documentación oficial).
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
 * necesario para /sales?include=items.product,table.room, donde el detalle real (nombre del
 * producto, nombre de la sala) no viene en .data sino en .included, indexado por "type:id" para
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

function fudoApiIncluidoPorPtr_(ptr, incluidos) {
  return ptr ? incluidos[ptr.type + ':' + ptr.id] : null;
}

function fudoApiNombreIncluido_(recurso) {
  return recurso && recurso.attributes && recurso.attributes.name ? recurso.attributes.name : '';
}

/**
 * Extrae de una venta las referencias que Fudo_Mapeo_Sedes puede usar para inferir sede: sala (mesa
 * → room), caja registradora, identificador de venta y mesero/usuario. Cualquiera puede venir vacía
 * si la venta no trae ese dato (ej. delivery sin mesa no tiene sala).
 */
function fudoApiReferenciasSedeDesdeSale_(sale, incluidos) {
  const rel = sale.relationships || {};
  const table = fudoApiIncluidoPorPtr_(rel.table && rel.table.data, incluidos);
  const room = fudoApiIncluidoPorPtr_(
    table && table.relationships && table.relationships.room && table.relationships.room.data,
    incluidos
  );
  const sala = fudoApiNombreIncluido_(room);

  const cashRegister = fudoApiIncluidoPorPtr_(rel.cashRegister && rel.cashRegister.data, incluidos);
  let caja = fudoApiNombreIncluido_(cashRegister);
  if (!caja && rel.payments && rel.payments.data) {
    const paymentsPtr = Array.isArray(rel.payments.data) ? rel.payments.data : [rel.payments.data];
    for (let i = 0; i < paymentsPtr.length && !caja; i++) {
      const payment = fudoApiIncluidoPorPtr_(paymentsPtr[i], incluidos);
      const payCrPtr = payment && payment.relationships && payment.relationships.cashRegister &&
        payment.relationships.cashRegister.data;
      caja = fudoApiNombreIncluido_(fudoApiIncluidoPorPtr_(payCrPtr, incluidos));
    }
  }

  const saleIdentifier = fudoApiIncluidoPorPtr_(rel.saleIdentifier && rel.saleIdentifier.data, incluidos);
  const identificador = fudoApiNombreIncluido_(saleIdentifier);

  const waiter = fudoApiIncluidoPorPtr_(rel.waiter && rel.waiter.data, incluidos);
  const usuario = fudoApiNombreIncluido_(waiter);

  return { sala: sala, caja: caja, identificador: identificador, usuario: usuario };
}

/** Mejor referencia disponible para "Creada por" / bandeja de ventas sin sede (mismo orden que el mapeo). */
function fudoApiCreadaPorDesdeReferencias_(referencias) {
  return referencias.sala || referencias.caja || referencias.identificador || referencias.usuario || '';
}

/**
 * Una venta (con sus relationships.items ya resueltos vía "incluidos") → una fila por ítem vendido,
 * con las MISMAS columnas que trae el export CSV "detallado" de FUDO (ver importarFudoConLock_ en
 * Fudo.gs) — así el resto de la importación (validación, dedupe, diagnóstico) no necesita saber si
 * el dato vino de un archivo o de la API. Ítems sin producto resuelto en "incluidos" (no debería
 * pasar si se pidió con include=items.product, pero por seguridad) se omiten en vez de guardarse
 * con el nombre vacío.
 *
 * Además de la sala (mesa→sala), se intenta resolver la sede también por mesero (waiter) e
 * identificador de venta (saleIdentifier) vía fudoResolverSedeVenta_ (FudoMapeoSedes.gs) — para eso
 * fudoApiSincronizarVentas_ debe pedir include=waiter,saleIdentifier además de table.room. NO se
 * intenta con "caja registradora": la especificación OpenAPI oficial completa confirma que /sales
 * no tiene ninguna relación cashRegister (solo la tienen los Usuarios — deliveryCashRegister/
 * tablesCashRegister/takeAwayCashRegister —, no las ventas; ver apps-script/fudo-openapi.yml, jul
 * 2026). Se manda una columna 'Sede' adicional con lo resuelto; importarFudoConLock_ (Fudo.gs) la
 * usa si vino algo Y sigue intentando su propia lógica (sedeDesdeCreadaPor_) si no — nunca se
 * pierde cobertura, solo se suma una oportunidad más de identificar la sede antes de "Sin
 * identificar". El atributo exacto de SaleIdentifier no está confirmado contra una cuenta real
 * (no tiene endpoint propio en el spec) — se intenta `attributes.name` a falta de algo mejor.
 */
function fudoApiFilasVentaDesdeSale_(sale, incluidos, indiceMapeoOpcional) {
  const referencias = fudoApiReferenciasSedeDesdeSale_(sale, incluidos);
  const sedeResuelta = fudoResolverSedeVenta_(referencias, indiceMapeoOpcional);
  const creadaPor = fudoApiCreadaPorDesdeReferencias_(referencias);
  const itemsPtr = (sale.relationships && sale.relationships.items && sale.relationships.items.data) || [];

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
      'Creada por': creadaPor,
      'Sede': sedeResuelta.sede
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

  const indiceMapeo = fudoMapeoSedeIndice_();
  const resultado = fudoApiObtenerTodoCompleto_('sales', {
    filtros: {
      createdAt: 'and(gte.' + fechaDesde + 'T00:00:00,lte.' + fechaHasta + 'T23:59:59)',
      // saleState no acepta eq. — su patrón real (según la documentación) solo permite in.(...).
      saleState: 'in.(CLOSED)'
    },
    include: FUDO_API_SALES_INCLUDE_,
    orden: 'createdAt'
  });

  const filas = [];
  resultado.registros.forEach(function (sale) {
    filas.push.apply(filas, fudoApiFilasVentaDesdeSale_(sale, resultado.incluidos, indiceMapeo));
  });

  const archivoSync = 'API FUDO ' + fechaDesde + ' a ' + fechaHasta;
  if (typeof fudoDescuentosPropinasEscribirDesdeSales_ === 'function' && resultado.registros.length) {
    fudoDescuentosPropinasEscribirDesdeSales_(resultado.registros, resultado.incluidos, indiceMapeo, {
      archivo_origen: archivoSync
    });
  }

  if (!filas.length) {
    const vacio = { ok: true, importados: 0, omitidos_duplicados: 0, tipo: 'ventas', ventas_encontradas: resultado.registros.length };
    if (typeof fudoApiSyncRegistrar_ === 'function') {
      fudoApiSyncRegistrar_('ventas', {
        ok: true, fecha_desde: fechaDesde, fecha_hasta: fechaHasta, usuario: usuario && usuario.nombre,
        importados: 0, omitidos_duplicados: 0, ventas_encontradas: resultado.registros.length, error: ''
      });
    }
    return vacio;
  }

  const importado = importarFudo_('ventas', filas, usuario, Object.assign({ archivo: archivoSync }, opciones));
  if (typeof fudoApiSyncRegistrar_ === 'function') {
    fudoApiSyncRegistrar_('ventas', {
      ok: importado.ok !== false,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      usuario: usuario && usuario.nombre,
      importados: importado.importados || 0,
      omitidos_duplicados: importado.omitidos_duplicados || 0,
      ventas_encontradas: resultado.registros.length,
      error: importado.error || ''
    });
  }
  return importado;
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
 *
 * jul 2026 (2): la especificación OpenAPI oficial confirma que NINGÚN recurso de FUDO tiene un campo
 * de sede/sucursal — las dos pistas reales son 1) las cajas propias de cada User (tablesCashRegister/
 * deliveryCashRegister/takeAwayCashRegister) y 2) el Room al que pertenece la Table de la venta. Se
 * agrega una muestra de 'rooms' y 'users' (con sus cajas incluidas) para confirmar cuál de las dos
 * trae el nombre real de sede — cada intento va en su propio try/catch porque el nombre exacto del
 * recurso ('rooms') es un supuesto, no algo ya confirmado contra la cuenta real.
 */
function fudoApiProbarConexionRecursoSeguro_(recurso, opciones) {
  try {
    return fudoApiPeticionPagina_(recurso, opciones);
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Snapshot automático del stock consolidado de la cuenta (/products + /ingredients) hacia
 * Stock_FUDO_Base, reutilizando el mismo UPSERT por nombre normalizado que ya usaba la carga
 * manual del export Excel "Control de Stock" (ver stockFudoBaseImportar_ en StockFudoBase.gs) —
 * no se crea una hoja/lógica paralela para lo mismo. Este stock sigue siendo una REFERENCIA
 * SECUNDARIA (comparación contra el consolidado de Amelia, detectar productos nuevos o sin control
 * de stock), nunca el inventario oficial por sede: ni /products ni /ingredients traen ninguna
 * relación de sede/sucursal (confirmado contra la especificación OpenAPI oficial completa, ver
 * apps-script/fudo-openapi.yml — modelo acordado jul 2026, ver docs/modelo-inventario.md).
 * Acción admin desde la app: 'fudo_api_tomar_snapshot_stock'.
 *
 * Usa fudoApiObtenerTodoCompleto_ (no fudoApiObtenerTodo_) a propósito: la unidad real no viene en
 * los atributos propios del producto/ingrediente, sino en el recurso Unit referenciado por
 * relationships.unit, que solo llega en el arreglo "included" de la respuesta — fudoApiObtenerTodo_
 * lo descarta. Antes de este cambio se pedía include=unit pero nunca se leía, y unidad quedaba
 * siempre en blanco (auditoría jul 2026).
 */
function fudoApiUnidadDesdeItem_(item, incluidos) {
  const unitPtr = item.relationships && item.relationships.unit && item.relationships.unit.data;
  const desdeIncluido = fudoApiNombreIncluido_(fudoApiIncluidoPorPtr_(unitPtr, incluidos));
  if (desdeIncluido) return desdeIncluido;
  const attrs = item.attributes || {};
  return typeof attrs.unit === 'string' ? attrs.unit : '';
}

function fudoApiTomarSnapshotStock_(usuario) {
  const productos = fudoApiObtenerTodoCompleto_('products', { include: 'unit' });
  const ingredientes = fudoApiObtenerTodoCompleto_('ingredients', { include: 'unit' });
  const filas = [];
  function agregar(resultado, tipo) {
    resultado.registros.forEach(function (item) {
      const attrs = item.attributes || {};
      if (!attrs.name) return;
      filas.push({
        nombre_fudo: attrs.name,
        tipo: tipo,
        stock: attrs.stock,
        unidad: fudoApiUnidadDesdeItem_(item, resultado.incluidos),
        fecha_base: ''
      });
    });
  }
  agregar(productos, 'Producto');
  agregar(ingredientes, 'Ingrediente');
  if (!filas.length) {
    const vacio = { ok: true, actualizados: 0, creados: 0, sin_nombre: 0, sin_stock: 0 };
    if (typeof fudoApiSyncRegistrar_ === 'function') {
      fudoApiSyncRegistrar_('stock', {
        ok: true, usuario: usuario && usuario.nombre, creados: 0, actualizados: 0, productos_api: 0, error: ''
      });
    }
    return vacio;
  }
  const importado = stockFudoBaseImportar_(filas, usuario);
  if (typeof fudoApiSyncRegistrar_ === 'function') {
    fudoApiSyncRegistrar_('stock', {
      ok: importado.ok !== false,
      usuario: usuario && usuario.nombre,
      creados: importado.creados || 0,
      actualizados: importado.actualizados || 0,
      productos_api: filas.length,
      error: importado.error || ''
    });
  }
  return importado;
}

const FUDO_API_PAYMENTS_INCLUDE_ = 'paymentMethod';

/**
 * Un pago de FUDO (con paymentMethod incluido) → fila para Pagos_FUDO. La sede se toma del índice
 * id_venta → sede armado desde Ventas_FUDO (sincronizar ventas antes en el mismo rango ayuda).
 */
function fudoApiFilaPagoDesdePayment_(payment, incluidos, sedePorVenta) {
  const attrs = payment.attributes || {};
  const salePtr = payment.relationships && payment.relationships.sale && payment.relationships.sale.data;
  const idVenta = salePtr ? String(salePtr.id) : '';
  const pmPtr = payment.relationships && payment.relationships.paymentMethod && payment.relationships.paymentMethod.data;
  const pm = pmPtr ? incluidos[pmPtr.type + ':' + pmPtr.id] : null;
  const creacion = attrs.paidAt || attrs.createdAt;
  return {
    id_pago: String(payment.id),
    id_venta: idVenta,
    fecha: creacion ? formatearFecha_(new Date(creacion)) : '',
    creacion: creacion ? new Date(creacion) : '',
    monto: attrs.amount,
    cancelado: !!attrs.canceled,
    metodo_pago: fudoApiNombreIncluido_(pm),
    metodo_tipo: pm && pm.attributes && pm.attributes.kind ? pm.attributes.kind : '',
    sede: (idVenta && sedePorVenta[idVenta]) || FUDO_SEDE_SIN_IDENTIFICAR_
  };
}

/**
 * Sincroniza pagos no cancelados de ventas cerradas hacia Pagos_FUDO para un rango de fechas.
 * Acción admin: 'fudo_api_sincronizar_pagos' (ver Code.gs, importar.html).
 */
function fudoApiSincronizarPagos_(fechaDesde, fechaHasta, usuario, opciones) {
  opciones = opciones || {};
  if (!fechaDesde || !fechaHasta) return { ok: false, error: 'Faltan fecha_desde/fecha_hasta' };

  const sedePorVenta = pagosFudoIndiceSedePorVenta_();
  const resultado = fudoApiObtenerTodoCompleto_('payments', {
    filtros: {
      createdAt: 'and(gte.' + fechaDesde + 'T00:00:00,lte.' + fechaHasta + 'T23:59:59)',
      canceled: 'neq.true',
      'sales.saleState': 'in.(CLOSED)'
    },
    include: FUDO_API_PAYMENTS_INCLUDE_
  });

  const filas = resultado.registros.map(function (payment) {
    return fudoApiFilaPagoDesdePayment_(payment, resultado.incluidos, sedePorVenta);
  });

  if (!filas.length) {
    const vacio = { ok: true, importados: 0, actualizados: 0, omitidos: 0, tipo: 'pagos', pagos_encontrados: 0 };
    if (typeof fudoApiSyncRegistrar_ === 'function') {
      fudoApiSyncRegistrar_('pagos', {
        ok: true, fecha_desde: fechaDesde, fecha_hasta: fechaHasta, usuario: usuario && usuario.nombre,
        importados: 0, actualizados: 0, omitidos: 0, pagos_encontrados: 0, error: ''
      });
    }
    return vacio;
  }

  const importado = pagosFudoImportar_(filas, usuario, Object.assign({
    archivo: 'API FUDO pagos ' + fechaDesde + ' a ' + fechaHasta
  }, opciones));
  if (typeof fudoApiSyncRegistrar_ === 'function') {
    fudoApiSyncRegistrar_('pagos', {
      ok: importado.ok !== false,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      usuario: usuario && usuario.nombre,
      importados: importado.importados || 0,
      actualizados: importado.actualizados || 0,
      omitidos: importado.omitidos || 0,
      pagos_encontrados: filas.length,
      error: importado.error || ''
    });
  }
  return importado;
}

function fudoApiProbarConexion_() {
  const cruda = fudoApiPeticionPagina_('sales', { pageSize: 3, pagina: 1, include: FUDO_API_SALES_INCLUDE_ });
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
    incluidos: cruda.included || [],
    salas: fudoApiProbarConexionRecursoSeguro_('rooms', { pageSize: 10 }),
    usuarios: fudoApiProbarConexionRecursoSeguro_('users', {
      pageSize: 10,
      include: 'role,tablesCashRegister,deliveryCashRegister,takeAwayCashRegister'
    })
  };
}
