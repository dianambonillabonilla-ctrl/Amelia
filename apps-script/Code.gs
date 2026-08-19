/**
 * DILANA OS — Backend (Google Apps Script)
 * Amelia Café / La Wafflería — Control de inventario, conciliación FUDO y disponibilidad
 *
 * ARQUITECTURA
 * - Este script se vincula a UN Google Sheet que actúa como base de datos (ver README para las hojas requeridas).
 * - Se despliega como "Web App" (Implementar > Nueva implementación > Aplicación web).
 * - El frontend (GitHub Pages) llama a la URL /exec de este script vía fetch(), enviando `token` en cada solicitud.
 *
 * HOJAS QUE ESTE SCRIPT ESPERA ENCONTRAR (se crean/actualizan solas al correr `configurarHojas()`):
 *   Usuarios | Catalogo_Maestro | Recetas | Conteos_Manuales | Movimientos_FUDO
 *   Ventas_FUDO | Sesiones | Producciones | AlertasEnviadas
 *
 * Después de correr configurarHojas() por primera vez (o tras actualizar este script), corre
 * también configurarTriggers() una vez para activar la limpieza diaria de sesiones y las alertas.
 */

// REACTIVACIÓN POR MÓDULOS — Usuarios + Sincronización FUDO
// El backend solo acepta autenticación, Usuarios y las cuatro acciones manuales aprobadas de FUDO.
// No basta ocultar pantallas: este es el candado autoritativo del Web App /exec.
const MODO_REACTIVACION_BACKEND = true;
const ACCIONES_PERMITIDAS_REACTIVACION_BACKEND = [
  'login',
  'logout',
  'whoami',
  'cambiar_password',
  'usuarios_listar',
  'usuarios_guardar',
  'usuario_resetear_password',
  'fudo_panel_estado',
  'fudo_api_probar_conexion',
  'fudo_api_sincronizar_ventas',
  'fudo_api_sincronizar_pagos'
];

function reactivacionBackendActiva_() {
  // Exclusivamente para el VM de las pruebas offline de Node. Esta variable no existe en el
  // runtime real de Apps Script ni puede enviarse por HTTP, por lo que no abre ningún bypass en
  // producción. Permite seguir probando la lógica de módulos todavía inactivos.
  if (typeof DILANA_TEST_DESACTIVAR_REACTIVACION !== 'undefined' && DILANA_TEST_DESACTIVAR_REACTIVACION === true) {
    return false;
  }
  return MODO_REACTIVACION_BACKEND;
}

function accionPermitidaEnReactivacion_(action) {
  return !reactivacionBackendActiva_() || ACCIONES_PERMITIDAS_REACTIVACION_BACKEND.indexOf(action) !== -1;
}

function automatizacionesPermitidasEnReactivacion_() {
  return !reactivacionBackendActiva_();
}

const SHEET_NAMES = {
  USUARIOS: 'Usuarios',
  CATALOGO: 'Catalogo_Maestro',
  RECETAS: 'Recetas',
  CONTEOS: 'Conteos_Manuales',
  MOVIMIENTOS_FUDO: 'Movimientos_FUDO',
  VENTAS_FUDO: 'Ventas_FUDO',
  FUDO_VENTAS: 'Fudo_Ventas',
  FUDO_ITEMS: 'Fudo_Items',
  FUDO_PAGOS: 'Fudo_Pagos',
  FUDO_DESCUENTOS: 'Fudo_Descuentos',
  FUDO_PROPINAS: 'Fudo_Propinas',
  FUDO_SUBITEMS: 'Fudo_Subitems',
  SESIONES: 'Sesiones',
  PRODUCCIONES: 'Producciones',
  ALERTAS_ENVIADAS: 'AlertasEnviadas',
  TRASLADOS: 'Traslados',
  AJUSTES_INVENTARIO: 'Ajustes_Inventario',
  TURNOS_SECTOR: 'Turnos_Sector',
  CIERRES_TURNO: 'Cierres_Turno',
  GESTIONES: 'Gestiones',
  AUDITORIA: 'Auditoria_Eventos',
  STOCK_FUDO_BASE: 'Stock_FUDO_Base',
  CATALOGO_ALIAS: 'Catalogo_Alias',
  FUDO_MAPEO_SEDES: 'Fudo_Mapeo_Sedes',
  MOVIMIENTOS_INVENTARIO: 'Movimientos_Inventario',
  PAGOS_FUDO: 'Pagos_FUDO',
  BASE_CAJA: 'Base_Caja',
  CAJA_TURNO: 'Caja_Turno',
  CAJA_MOVIMIENTOS: 'Caja_Movimientos'
};

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  if (!name) {
    throw new Error(
      'Nombre de hoja inválido (undefined). El Code.gs desplegado está incompleto o desactualizado — ' +
      'haz clasp push de todo el proyecto, corre configurarHojas() en el editor de Apps Script y vuelve a desplegar la Web App.'
    );
  }
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('No existe la hoja "' + name + '". Corre configurarHojas() primero.');
  return sh;
}

// ---------------------------------------------------------------------------
// SETUP — correr manualmente desde el editor de Apps Script
// ---------------------------------------------------------------------------

/**
 * Crea las hojas que falten y, en las que ya existen con datos, agrega al final las
 * columnas nuevas que falten (sin tocar las existentes) — así se puede correr de nuevo
 * de forma segura cada vez que este script gana una hoja o columna nueva.
 */
function configurarHojas() {
  const spec = {
    Usuarios: ['id', 'nombre', 'usuario', 'password_hash', 'salt', 'rol', 'sede', 'activo', 'email', 'sectores_permitidos'],
    Catalogo_Maestro: ['id', 'nombre_estandar', 'nombre_fudo', 'id_fudo', 'tipo_fudo', 'categoria', 'unidad_base', 'tipo', 'notas', 'stock_minimo', 'frecuencia_conteo', 'obligatorio_produccion', 'sector', 'sede'],
    Recetas: ['id', 'producto', 'ingrediente', 'cantidad', 'unidad', 'rendimiento_producto', 'unidad_rendimiento',
      'tipo', 'fuente', 'umbral_alerta', 'version', 'sede', 'vigente_desde', 'vigente_hasta', 'estado',
      'controla_disponibilidad', 'notas'],
    Conteos_Manuales: ['id', 'fecha', 'sede', 'punto_conteo', 'turno', 'producto', 'unidad', 'cantidad', 'usuario', 'timestamp'],
    Movimientos_FUDO: ['fecha', 'tipo', 'evento', 'nombre', 'stock_anterior', 'stock_actual', 'diferencia', 'usuario',
      'sede', 'objeto_tipo', 'costo', 'archivo_origen', 'importado_por', 'importado_en'],
    Ventas_FUDO: ['id_venta', 'creacion', 'producto', 'categoria', 'cantidad', 'precio', 'cancelada', 'creada_por',
      'sede', 'formato_origen', 'archivo_origen', 'importado_en'],
    Fudo_Ventas: ['id_venta', 'creacion', 'sede', 'creada_por', 'formato_origen', 'archivo_origen', 'importado_en',
      'items_count', 'monto_total', 'lineas_canceladas'],
    Fudo_Items: ['id', 'clave_item', 'id_venta', 'creacion', 'producto', 'categoria', 'cantidad', 'precio', 'cancelada',
      'sede', 'creada_por', 'formato_origen', 'archivo_origen', 'importado_en'],
    Fudo_Pagos: ['id_pago', 'id_venta', 'fecha', 'creacion', 'monto', 'cancelado', 'metodo_pago', 'metodo_tipo', 'sede',
      'es_efectivo', 'archivo_origen', 'importado_por', 'importado_en'],
    Fudo_Descuentos: ['id_descuento', 'id_venta', 'creacion', 'monto', 'porcentaje', 'monto_max', 'cancelado',
      'plantilla_nombre', 'sede', 'archivo_origen', 'importado_en'],
    Fudo_Propinas: ['id_propina', 'id_venta', 'creacion', 'monto', 'cancelado', 'sede', 'archivo_origen', 'importado_en'],
    Fudo_Subitems: ['id_subitem', 'clave_subitem', 'id_item', 'id_venta', 'creacion', 'producto', 'cantidad', 'precio',
      'cancelado', 'sede', 'archivo_origen', 'importado_en'],
    Sesiones: ['token', 'usuario_id', 'creado_en', 'expira_en'],
    Producciones: ['id', 'fecha', 'sede', 'item', 'cantidad', 'unidad', 'usuario', 'timestamp', 'request_id',
      'insumo_producto', 'insumo_cantidad', 'insumo_unidad', 'merma_cantidad', 'merma_unidad',
      'rendimiento_porcentaje', 'receta_referencia', 'hora_inicio', 'hora_fin', 'observacion', 'evidencia_url'],
    AlertasEnviadas: ['fecha', 'plato', 'tipo', 'sede'],
    Traslados: ['id', 'fecha', 'producto', 'unidad', 'cantidad_enviada', 'sede_origen', 'punto_origen',
      'sede_destino', 'punto_destino', 'usuario_envia', 'timestamp_envio', 'estado', 'usuario_recibe',
      'timestamp_recibe', 'cantidad_recibida', 'observacion', 'resuelto_por', 'timestamp_resuelto', 'nota_resolucion'],
    Ajustes_Inventario: ['id', 'fecha', 'sede', 'punto', 'tipo', 'producto', 'unidad', 'cantidad', 'motivo', 'usuario', 'timestamp',
      'proveedor', 'numero_factura', 'costo', 'factura_id', 'avalado', 'avalado_por', 'timestamp_avalado', 'evidencia_url'],
    Turnos_Sector: ['id', 'fecha', 'usuario_id', 'usuario_nombre', 'sector', 'timestamp'],
    Cierres_Turno: ['id', 'fecha', 'sede', 'usuario', 'timestamp',
      'ventas_fudo_total', 'traslados_pendientes', 'producciones_registradas', 'efectivo_contado', 'observaciones',
      'pagos_fudo_total', 'pagos_efectivo_esperado', 'diferencia_caja',
      'inventario_contado', 'diferencia_inventario', 'diferencias_inventario_json',
      'fuente_ventas', 'fuente_pagos', 'descuentos_total', 'propinas_total', 'sync_ventas_en', 'sync_pagos_en'],
    Gestiones: ['id', 'fecha', 'producto', 'sede', 'estado', 'nota', 'creado_por', 'timestamp_creado',
      'actualizado_por', 'timestamp_actualizado', 'factura_id'],
    Auditoria_Eventos: ['id', 'timestamp', 'usuario_id', 'usuario_nombre', 'accion', 'entidad_tipo',
      'entidad_id', 'valor_anterior', 'valor_nuevo', 'sede', 'motivo'],
    Stock_FUDO_Base: ['nombre_fudo', 'tipo', 'stock', 'unidad', 'fecha_base', 'importado_por', 'importado_en'],
    Catalogo_Alias: ['id', 'catalogo_id', 'alias', 'origen', 'creado_por', 'timestamp'],
    Fudo_Mapeo_Sedes: ['id', 'tipo_referencia', 'id_fudo', 'nombre', 'sede', 'creado_por', 'timestamp'],
    Movimientos_Inventario: ['id', 'fecha', 'timestamp', 'catalogo_id', 'producto', 'cantidad', 'unidad', 'signo',
      'tipo_movimiento', 'ubicacion_origen', 'ubicacion_destino', 'sede_origen', 'sede_destino', 'sede', 'fuente',
      'entidad_tipo', 'entidad_id', 'clave_idempotencia', 'estado', 'usuario_id', 'usuario_nombre', 'observacion',
      'evidencia_url', 'requiere_aprobacion', 'aprobado_por', 'aprobado_en', 'reversa_movimiento_id', 'creado_en'],
    Pagos_FUDO: ['id_pago', 'id_venta', 'fecha', 'creacion', 'monto', 'cancelado', 'metodo_pago', 'metodo_tipo',
      'sede', 'archivo_origen', 'importado_por', 'importado_en'],
    Base_Caja: ['id', 'fecha', 'sede', 'efectivo_fudo', 'caja_fuerte', 'efectivo_caja_menor', 'pendiente',
      'gastos', 'cuadre', 'usuario', 'timestamp', 'observacion'],
    Caja_Turno: ['id', 'fecha', 'sede', 'estado', 'base_inicial', 'hora_apertura', 'usuario_apertura_id',
      'usuario_apertura', 'rappi_encendido', 'efectivo_contado', 'efectivo_esperado', 'diferencia',
      'entrega_cierre', 'base_siguiente', 'usuario_cierre', 'hora_cierre', 'observacion_cierre', 'timestamp_cierre'],
    Caja_Movimientos: ['id', 'fecha', 'sede', 'tipo', 'valor', 'persona_entrega', 'persona_recibe', 'hora',
      'motivo', 'evidencia_url', 'usuario_id', 'usuario', 'timestamp']
  };
  const spreadsheet = ss_();
  Object.keys(spec).forEach(function (name) {
    let sh = spreadsheet.getSheetByName(name);
    const esNueva = !sh;
    if (!sh) sh = spreadsheet.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, spec[name].length).setValues([spec[name]]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, spec[name].length).setFontWeight('bold').setBackground('#0B1F3A').setFontColor('#FFFFFF');
      if (name === 'Fudo_Mapeo_Sedes' && esNueva) {
        const ahoraSemilla = new Date();
        const semillas = [
          ['Salón SA', 'San Antonio'], ['Terraza SA', 'San Antonio'],
          ['Terraza Capri', 'Capri'], ['La Waffleria - Capri', 'Capri']
        ];
        sh.getRange(2, 1, semillas.length, spec[name].length).setValues(semillas.map(function (s) {
          return [Utilities.getUuid(), 'Sala', '', s[0], s[1], 'sistema', ahoraSemilla];
        }));
      }
    } else {
      asegurarColumnas_(sh, spec[name]);
    }
  });
  const usuarios = sheet_(SHEET_NAMES.USUARIOS);
  SpreadsheetApp.flush();
  Logger.log(usuarios.getLastRow() === 1
    ? 'Hojas configuradas. No hay usuarios: ejecuta crearAdministradorInicial_(nombre, usuario, password, email).'
    : 'Hojas configuradas. Corre configurarTriggers() si no lo has hecho.');
}

function crearAdministradorInicial_(nombre, usuario, password, email) {
  const sh = sheet_(SHEET_NAMES.USUARIOS);
  if (sh.getLastRow() > 1) throw new Error('Ya existen usuarios; administra las cuentas desde DILANA OS.');
  if (!nombre || !usuario || !password || String(password).length < 10) {
    throw new Error('Nombre, usuario y una contraseña propia de al menos 10 caracteres son obligatorios.');
  }
  const salt = generarSalt_();
  appendRowFromObj_(SHEET_NAMES.USUARIOS, {
    id: Utilities.getUuid(), nombre: nombre, usuario: usuario,
    password_hash: hashPasswordSalted_(password, salt), salt: salt,
    rol: 'Administrador', sede: 'Ambas', activo: true, email: email || ''
  });
  return 'Administrador inicial creado. La contraseña no se guardó en texto plano.';
}

function asegurarColumnas_(sh, columnas) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  columnas.forEach(function (col) {
    if (headers.indexOf(col) === -1) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(col);
    }
  });
}

function configurarTriggers() {
  const eliminados = desactivarTriggersReactivacion_();
  if (MODO_REACTIVACION_BACKEND) {
    Logger.log('Fase 0 activa: automatizaciones desactivadas. Triggers eliminados: ' + eliminados);
    return { reactivacion: true, creados: 0, eliminados: eliminados };
  }
  ScriptApp.newTrigger('tareaDiaria_').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('fudoSincronizacionAutomatica_').timeBased().everyMinutes(15).create();
  Logger.log('Triggers configurados: tareaDiaria_ (diario ~6am) y fudoSincronizacionAutomatica_ (cada 15 min).');
  return { reactivacion: false, creados: 2, eliminados: eliminados };
}

function desactivarTriggersReactivacion_() {
  let eliminados = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'tareaDiaria_' || fn === 'fudoSincronizacionAutomatica_') {
      ScriptApp.deleteTrigger(t);
      eliminados++;
    }
  });
  Logger.log('Fase 0: ' + eliminados + ' trigger(s) operativo(s) eliminado(s).');
  return eliminados;
}

function tareaDiaria_() {
  if (!automatizacionesPermitidasEnReactivacion_()) {
    Logger.log('Fase 0 activa: tareaDiaria_ omitida.');
    return;
  }
  limpiarSesionesVencidas_();
  try { revisarAlertas_(); } catch (err) { Logger.log('revisarAlertas_ falló en la tarea diaria: ' + err.message); }
  try {
    if (typeof fudoSincronizacionStockDiaria_ === 'function') fudoSincronizacionStockDiaria_();
  } catch (err) {
    Logger.log('fudoSincronizacionStockDiaria_ falló en la tarea diaria: ' + err.message);
  }
}

function doGet(e) { return handleRequest_(e, 'GET'); }
function doPost(e) { return handleRequest_(e, 'POST'); }

function apiErrorConIncidente_(resumen, detalle) {
  const incidente = 'API-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 1000);
  Logger.log('[' + incidente + '] ' + resumen + ': ' + detalle);
  return new Error(resumen + ' (código ' + incidente + ' — revisa el registro de ejecución de Apps Script para el detalle completo).');
}

function handleRequest_(e, method) {
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
  if (!accionPermitidaEnReactivacion_(action)) {
    return jsonOut_({ ok: false, codigo: 'MODULO_INACTIVO', error: 'Este módulo está temporalmente inactivo mientras se valida la aplicación por etapas.' });
  }
  try {
    if (action === 'login') return jsonOut_(login_(params.usuario, params.password));
    if (action === 'logout') return jsonOut_(logout_(params.token));
    const sesion = validarToken_(params.token);
    if (!sesion.ok) return jsonOut_(sesion);
    switch (action) {
      case 'whoami': return jsonOut_({ ok: true, usuario: sesion.usuario });
      case 'cambiar_password': return jsonOut_(cambiarPassword_(sesion.usuario, params.password_actual, params.password_nueva));
      case 'fudo_api_probar_conexion': requiereAdmin_(sesion.usuario); return jsonOut_(fudoApiProbarConexion_());
      case 'fudo_api_sincronizar_ventas': requiereAdmin_(sesion.usuario); return jsonOut_(fudoApiSincronizarVentas_(params.fecha_desde, params.fecha_hasta, sesion.usuario, params.opciones));
      case 'fudo_api_sincronizar_pagos': requiereAdmin_(sesion.usuario); return jsonOut_(fudoApiSincronizarPagos_(params.fecha_desde, params.fecha_hasta, sesion.usuario, params.opciones));
      case 'fudo_panel_estado': requiereAdmin_(sesion.usuario); return jsonOut_(fudoApiEstadoPanel_());
      case 'usuarios_listar': requiereAdmin_(sesion.usuario); return jsonOut_(usuariosListar_(sesion.usuario));
      case 'usuarios_guardar': requiereAdmin_(sesion.usuario); return jsonOut_(usuarioGuardar_(params.item, sesion.usuario));
      case 'usuario_resetear_password': requiereAdmin_(sesion.usuario); return jsonOut_(usuarioResetearPassword_(params.id, params.password_nueva, sesion.usuario));
      default: return jsonOut_({ ok: false, error: 'Acción desconocida: ' + action });
    }
  } catch (err) {
    const detalle = err && err.message ? err.message : String(err);
    if (/código (API|FUDO)-/.test(detalle)) return jsonOut_({ ok: false, error: detalle });
    return jsonOut_({ ok: false, error: apiErrorConIncidente_('Error de servidor', detalle).message });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

const HASH_ITERACIONES = 1000;
const PASSWORD_LARGO_MINIMO = 8;
const LOGIN_INTENTOS_MAXIMOS = 8;
const LOGIN_BLOQUEO_BASE_SEGUNDOS = 15 * 60;
const LOGIN_BLOQUEO_MAXIMO_SEGUNDOS = 6 * 60 * 60;

function loginIntentosClave_(usuario) { return 'login_intentos_' + normalizar_(usuario); }
function loginBloqueosClave_(usuario) { return 'login_bloqueos_' + normalizar_(usuario); }
function loginBloqueado_(usuario) {
  const intentos = Number(CacheService.getScriptCache().get(loginIntentosClave_(usuario))) || 0;
  return intentos >= LOGIN_INTENTOS_MAXIMOS;
}
function loginRegistrarIntentoFallido_(usuario) {
  const cache = CacheService.getScriptCache();
  const claveIntentos = loginIntentosClave_(usuario);
  const intentos = (Number(cache.get(claveIntentos)) || 0) + 1;
  if (intentos < LOGIN_INTENTOS_MAXIMOS) {
    cache.put(claveIntentos, String(intentos), LOGIN_BLOQUEO_BASE_SEGUNDOS);
    return;
  }
  const claveBloqueos = loginBloqueosClave_(usuario);
  const bloqueosPrevios = Number(cache.get(claveBloqueos)) || 0;
  const segundos = Math.min(LOGIN_BLOQUEO_BASE_SEGUNDOS * Math.pow(2, bloqueosPrevios), LOGIN_BLOQUEO_MAXIMO_SEGUNDOS);
  cache.put(claveIntentos, String(intentos), segundos);
  cache.put(claveBloqueos, String(bloqueosPrevios + 1), Math.min(segundos * 2, LOGIN_BLOQUEO_MAXIMO_SEGUNDOS));
}
function loginLimpiarIntentos_(usuario) {
  const cache = CacheService.getScriptCache();
  cache.remove(loginIntentosClave_(usuario));
  cache.remove(loginBloqueosClave_(usuario));
}
function generarSalt_() { return Utilities.base64Encode(Utilities.getUuid() + Utilities.getUuid()); }
function hashPassword_(pw) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pw)); }
function hashPasswordSalted_(pw, salt) {
  let valor = salt + ':' + pw;
  for (let i = 0; i < HASH_ITERACIONES; i++) valor = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, valor + salt));
  return valor;
}
function verificarPassword_(passwordPlano, filaUsuario) {
  if (filaUsuario.salt) return { valido: hashPasswordSalted_(passwordPlano, filaUsuario.salt) === filaUsuario.password_hash, necesitaMigracion: false };
  const valido = hashPassword_(passwordPlano) === filaUsuario.password_hash;
  return { valido: valido, necesitaMigracion: valido };
}
function establecerPassword_(usuarioId, passwordPlano) {
  const sh = sheet_(SHEET_NAMES.USUARIOS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const saltCol = headers.indexOf('salt');
  const hashCol = headers.indexOf('password_hash');
  for (let r = 1; r < data.length; r++) {
    if (data[r][idCol] === usuarioId) {
      const salt = generarSalt_();
      sh.getRange(r + 1, saltCol + 1).setValue(salt);
      sh.getRange(r + 1, hashCol + 1).setValue(hashPasswordSalted_(passwordPlano, salt));
      return true;
    }
  }
  return false;
}
function login_(usuario, password) {
  if (!usuario || !password) return { ok: false, error: 'Usuario y contraseña son obligatorios' };
  if (loginBloqueado_(usuario)) return { ok: false, error: 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.' };
  const rows = leerTabla_(SHEET_NAMES.USUARIOS);
  const match = rows.find(function (r) { return r.usuario === usuario && r.activo === true; });
  if (!match) { loginRegistrarIntentoFallido_(usuario); return { ok: false, error: 'Usuario o contraseña incorrectos' }; }
  const resultado = verificarPassword_(password, match);
  if (!resultado.valido) { loginRegistrarIntentoFallido_(usuario); return { ok: false, error: 'Usuario o contraseña incorrectos' }; }
  loginLimpiarIntentos_(usuario);
  if (resultado.necesitaMigracion) establecerPassword_(match.id, password);
  const token = Utilities.getUuid();
  const ahora = new Date();
  const expira = new Date(ahora.getTime() + 12 * 60 * 60 * 1000);
  appendRowFromObj_(SHEET_NAMES.SESIONES, { token: token, usuario_id: match.id, creado_en: ahora, expira_en: expira });
  return { ok: true, token: token, usuario: { id: match.id, nombre: match.nombre, rol: match.rol, sede: match.sede, sectores_permitidos: match.sectores_permitidos || '' } };
}
function logout_(token) { if (token) eliminarSesion_(token); return { ok: true }; }
function eliminarSesion_(token) {
  const sh = sheet_(SHEET_NAMES.SESIONES);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const tokenCol = headers.indexOf('token');
  for (let r = data.length - 1; r >= 1; r--) if (data[r][tokenCol] === token) { sh.deleteRow(r + 1); return; }
}
function eliminarSesionesDeUsuario_(usuarioId) {
  const sh = sheet_(SHEET_NAMES.SESIONES);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const usuarioCol = headers.indexOf('usuario_id');
  for (let r = data.length - 1; r >= 1; r--) if (data[r][usuarioCol] === usuarioId) sh.deleteRow(r + 1);
}
function limpiarSesionesVencidas_() {
  const sh = sheet_(SHEET_NAMES.SESIONES);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const expiraCol = headers.indexOf('expira_en');
  const ahora = new Date();
  for (let r = data.length - 1; r >= 1; r--) if (new Date(data[r][expiraCol]) < ahora) sh.deleteRow(r + 1);
}
function validarToken_(token) {
  if (!token) return { ok: false, error: 'Falta token de sesión', codigo: 'SESION_INVALIDA' };
  const sesiones = leerTabla_(SHEET_NAMES.SESIONES);
  const s = sesiones.find(function (r) { return r.token === token; });
  if (!s) return { ok: false, error: 'Sesión no encontrada, vuelve a iniciar sesión', codigo: 'SESION_INVALIDA' };
  if (new Date(s.expira_en) < new Date()) { eliminarSesion_(token); return { ok: false, error: 'Sesión expirada, vuelve a iniciar sesión', codigo: 'SESION_INVALIDA' }; }
  const usuarios = leerTabla_(SHEET_NAMES.USUARIOS);
  const u = usuarios.find(function (r) { return r.id === s.usuario_id; });
  if (!u || !u.activo) return { ok: false, error: 'Usuario inactivo', codigo: 'SESION_INVALIDA' };
  return { ok: true, usuario: { id: u.id, nombre: u.nombre, rol: u.rol, sede: u.sede, sectores_permitidos: u.sectores_permitidos || '' } };
}
function requiereRol_(usuario, rolesPermitidos) {
  if (rolesPermitidos.indexOf(usuario.rol) === -1) throw new Error('Esta acción requiere uno de estos roles: ' + rolesPermitidos.join(', '));
}
function requiereAdmin_(usuario) { requiereRol_(usuario, ['Administrador']); }
function sedeConsultaPermitida_(usuario, sedeSolicitada) {
  if (usuario.rol === 'Administrador' || usuario.sede === 'Ambas') return sedeSolicitada || null;
  if (sedeSolicitada && sedeSolicitada !== usuario.sede && sedeSolicitada !== 'Centro de Producción') throw new Error('No puedes consultar datos de una sede distinta a la tuya (' + usuario.sede + ')');
  return sedeSolicitada || usuario.sede;
}
function sedeEscrituraPermitida_(usuario, sede) {
  return usuario.rol === 'Administrador' || usuario.sede === 'Ambas' || sede === usuario.sede || sede === 'Centro de Producción';
}

var TABLAS_CACHE_ = null;
var TABLAS_CACHE_NIVEL_ = 0;
function conCacheDeTablas_(fn) {
  TABLAS_CACHE_NIVEL_++;
  if (TABLAS_CACHE_NIVEL_ === 1) TABLAS_CACHE_ = {};
  try { return fn(); }
  finally {
    TABLAS_CACHE_NIVEL_--;
    if (TABLAS_CACHE_NIVEL_ <= 0) { TABLAS_CACHE_NIVEL_ = 0; TABLAS_CACHE_ = null; }
  }
}
function memoEnCacheDeTablas_(clave, fn) {
  if (!TABLAS_CACHE_) return fn();
  const claveMemo = '__memo__' + clave;
  if (!Object.prototype.hasOwnProperty.call(TABLAS_CACHE_, claveMemo)) TABLAS_CACHE_[claveMemo] = fn();
  return TABLAS_CACHE_[claveMemo];
}
function leerTabla_(nombreHoja) {
  if (TABLAS_CACHE_ && Object.prototype.hasOwnProperty.call(TABLAS_CACHE_, nombreHoja)) return TABLAS_CACHE_[nombreHoja].slice();
  const sh = sheet_(nombreHoja);
  const values = sh.getDataRange().getValues();
  let filas = [];
  if (values.length >= 2) {
    const headers = values[0];
    filas = values.slice(1).filter(function (row) { return row.some(function (v) { return v !== '' && v !== null; }); }).map(function (row) {
      const obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });
  }
  if (TABLAS_CACHE_) { TABLAS_CACHE_[nombreHoja] = filas; return filas.slice(); }
  return filas;
}
function neutralizarFormula_(valor) {
  if (typeof valor !== 'string') return valor;
  return /^[=+\-@]/.test(valor) ? "'" + valor : valor;
}
function neutralizarObjetoFormulas_(obj) {
  const limpio = {};
  Object.keys(obj || {}).forEach(function (k) { limpio[k] = neutralizarFormula_(obj[k]); });
  return limpio;
}
function appendRowFromObj_(nombreHoja, obj) {
  const sh = sheet_(nombreHoja);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = headers.map(function (h) { return neutralizarFormula_(obj[h] !== undefined ? obj[h] : ''); });
  sh.appendRow(row);
}
function appendRowsFromObjs_(nombreHoja, objs) {
  if (!objs || !objs.length) return;
  const sh = sheet_(nombreHoja);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const filas = objs.map(function (obj) { return headers.map(function (h) { return neutralizarFormula_(obj[h] !== undefined ? obj[h] : ''); }); });
  sh.getRange(sh.getLastRow() + 1, 1, filas.length, headers.length).setValues(filas);
}
