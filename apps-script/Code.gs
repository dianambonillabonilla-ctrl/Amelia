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

const SHEET_NAMES = {
  USUARIOS: 'Usuarios',
  CATALOGO: 'Catalogo_Maestro',
  RECETAS: 'Recetas',
  CONTEOS: 'Conteos_Manuales',
  MOVIMIENTOS_FUDO: 'Movimientos_FUDO',
  VENTAS_FUDO: 'Ventas_FUDO',
  SESIONES: 'Sesiones',
  PRODUCCIONES: 'Producciones',
  ALERTAS_ENVIADAS: 'AlertasEnviadas',
  TRASLADOS: 'Traslados'
};

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
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
    Usuarios: ['id', 'nombre', 'usuario', 'password_hash', 'salt', 'rol', 'sede', 'activo', 'email'],
    Catalogo_Maestro: ['id', 'nombre_estandar', 'nombre_fudo', 'categoria', 'unidad_base', 'tipo', 'notas', 'stock_minimo'],
    Recetas: ['producto', 'ingrediente', 'cantidad', 'unidad', 'rendimiento_producto', 'unidad_rendimiento', 'tipo', 'fuente', 'umbral_alerta'],
    Conteos_Manuales: ['id', 'fecha', 'sede', 'punto_conteo', 'turno', 'producto', 'unidad', 'cantidad', 'usuario', 'timestamp'],
    Movimientos_FUDO: ['fecha', 'tipo', 'evento', 'nombre', 'stock_anterior', 'stock_actual', 'diferencia', 'usuario', 'costo', 'importado_por', 'importado_en'],
    Ventas_FUDO: ['id_venta', 'creacion', 'producto', 'categoria', 'cantidad', 'precio', 'cancelada', 'creada_por', 'sede', 'importado_en'],
    Sesiones: ['token', 'usuario_id', 'creado_en', 'expira_en'],
    Producciones: ['id', 'fecha', 'sede', 'item', 'cantidad', 'unidad', 'usuario', 'timestamp'],
    AlertasEnviadas: ['fecha', 'plato'],
    Traslados: ['id', 'fecha', 'producto', 'unidad', 'cantidad_enviada', 'sede_origen', 'punto_origen',
      'sede_destino', 'punto_destino', 'usuario_envia', 'timestamp_envio', 'estado', 'usuario_recibe',
      'timestamp_recibe', 'cantidad_recibida', 'observacion', 'resuelto_por', 'timestamp_resuelto', 'nota_resolucion']
  };
  const spreadsheet = ss_();
  Object.keys(spec).forEach(function (name) {
    let sh = spreadsheet.getSheetByName(name);
    if (!sh) sh = spreadsheet.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, spec[name].length).setValues([spec[name]]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, spec[name].length).setFontWeight('bold').setBackground('#0B1F3A').setFontColor('#FFFFFF');
    } else {
      asegurarColumnas_(sh, spec[name]);
    }
  });

  // Usuario administrador por defecto (cambia la contraseña luego de crearla)
  const usuarios = sheet_(SHEET_NAMES.USUARIOS);
  if (usuarios.getLastRow() === 1) {
    const saltInicial = generarSalt_();
    usuarios.appendRow([Utilities.getUuid(), 'Diana Bonilla', 'diana', hashPasswordSalted_('cambiar123', saltInicial), saltInicial, 'Administrador', 'Ambas', true, '']);
  }
  SpreadsheetApp.flush();
  Logger.log('Hojas configuradas. Usuario inicial: diana / cambiar123 (cámbialo). Corre configurarTriggers() si no lo has hecho.');
}

function asegurarColumnas_(sh, columnas) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  columnas.forEach(function (col) {
    if (headers.indexOf(col) === -1) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(col);
    }
  });
}

/**
 * Corre UNA vez (o de nuevo si cambian los triggers) para activar la tarea diaria:
 * limpia sesiones vencidas y revisa alertas de stock bajo.
 */
function configurarTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tareaDiaria_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tareaDiaria_').timeBased().everyDays(1).atHour(6).create();
  Logger.log('Trigger diario configurado (tareaDiaria_, ~6am hora del script).');
}

function tareaDiaria_() {
  limpiarSesionesVencidas_();
  try {
    revisarAlertas_();
  } catch (err) {
    Logger.log('revisarAlertas_ falló en la tarea diaria: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// WEB APP ENTRY POINTS
// ---------------------------------------------------------------------------
function doGet(e) {
  return handleRequest_(e, 'GET');
}

function doPost(e) {
  return handleRequest_(e, 'POST');
}

function handleRequest_(e, method) {
  let body = {};
  try {
    if (e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'JSON inválido: ' + err.message });
  }
  const params = Object.assign({}, e.parameter || {}, body || {});
  const action = params.action;

  try {
    // Login y logout no requieren sesión previa válida (logout debe funcionar incluso con token vencido)
    if (action === 'login') {
      return jsonOut_(login_(params.usuario, params.password));
    }
    if (action === 'logout') {
      return jsonOut_(logout_(params.token));
    }

    // Todo lo demás requiere sesión válida
    const sesion = validarToken_(params.token);
    if (!sesion.ok) return jsonOut_(sesion);

    switch (action) {
      case 'whoami':
        return jsonOut_({ ok: true, usuario: sesion.usuario });
      case 'cambiar_password':
        return jsonOut_(cambiarPassword_(sesion.usuario, params.password_actual, params.password_nueva));
      case 'catalogo_listar':
        return jsonOut_({ ok: true, data: leerTabla_(SHEET_NAMES.CATALOGO) });
      case 'catalogo_guardar':
        requiereAdmin_(sesion.usuario);
        return jsonOut_(catalogoGuardar_(params.item, sesion.usuario));
      case 'recetas_listar':
        return jsonOut_({ ok: true, data: leerTabla_(SHEET_NAMES.RECETAS) });
      case 'conteo_registrar':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_(conteoRegistrar_(params.items, sesion.usuario));
      case 'conteo_listar':
        return jsonOut_({ ok: true, data: conteoListar_(params.fecha, params.sede) });
      case 'importar_fudo':
        requiereAdmin_(sesion.usuario);
        return jsonOut_(importarFudo_(params.tipo, params.filas, sesion.usuario));
      case 'disponible_hoy':
        return jsonOut_({ ok: true, data: calcularDisponibleHoy_(params.fecha) });
      case 'tendencia_ingrediente':
        return jsonOut_({ ok: true, data: calcularTendenciaIngrediente_(params.ingrediente, params.dias) });
      case 'conciliacion':
        return jsonOut_({ ok: true, data: calcularConciliacion_(params.fecha) });
      case 'produccion_registrar':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_(produccionRegistrar_(params.items, sesion.usuario));
      case 'produccion_listar':
        return jsonOut_({ ok: true, data: produccionListar_(params.fecha, params.sede) });
      case 'usuarios_listar':
        return jsonOut_(usuariosListar_(sesion.usuario));
      case 'usuarios_guardar':
        return jsonOut_(usuarioGuardar_(params.item, sesion.usuario));
      case 'usuario_resetear_password':
        return jsonOut_(usuarioResetearPassword_(params.id, params.password_nueva, sesion.usuario));
      case 'traslado_crear':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_(trasladoCrear_(params.item, sesion.usuario));
      case 'traslados_listar':
        return jsonOut_({ ok: true, data: trasladosListar_(params.filtro) });
      case 'traslado_confirmar':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_(trasladoConfirmar_(params.id, params.cantidad_recibida, sesion.usuario));
      case 'traslado_observar':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_(trasladoObservar_(params.id, params.observacion, sesion.usuario));
      case 'traslado_resolver':
        return jsonOut_(trasladoResolver_(params.id, params.nota_resolucion, sesion.usuario));
      case 'diagnostico_recetas':
        requiereAdmin_(sesion.usuario);
        return jsonOut_({ ok: true, data: diagnosticarRecetas_(params.umbral) });
      case 'diagnostico_conteos_duplicados':
        requiereAdmin_(sesion.usuario);
        return jsonOut_({ ok: true, data: diagnosticarConteosDuplicados_() });
      case 'diagnostico_ventas_fudo':
        requiereAdmin_(sesion.usuario);
        return jsonOut_({ ok: true, data: diagnosticarVentasFudo_() });
      case 'migrar_recetas_produccion':
        requiereAdmin_(sesion.usuario);
        return jsonOut_(migrarRecetasProduccion_());
      default:
        return jsonOut_({ ok: false, error: 'Acción desconocida: ' + action });
    }
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Error de servidor: ' + err.message });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// AUTENTICACIÓN
// ---------------------------------------------------------------------------

// Apps Script no ofrece bcrypt/scrypt/argon2. Se emula un KDF lento con SHA-256 salteado
// e iterado; el número de iteraciones está acotado por el overhead de cada llamada nativa
// de Utilities dentro de Apps Script (demasiadas iteraciones vuelven el login perceptiblemente lento).
const HASH_ITERACIONES = 1000;

function generarSalt_() {
  return Utilities.base64Encode(Utilities.getUuid() + Utilities.getUuid());
}

// Esquema viejo (sin sal) — se conserva solo para poder verificar y migrar hashes ya guardados.
function hashPassword_(pw) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pw));
}

function hashPasswordSalted_(pw, salt) {
  let valor = salt + ':' + pw;
  for (let i = 0; i < HASH_ITERACIONES; i++) {
    valor = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, valor + salt));
  }
  return valor;
}

/**
 * Verifica la contraseña contra el esquema que tenga guardado esa fila (con sal si ya migró,
 * sin sal si es una cuenta vieja). `necesitaMigracion` avisa a login_ que debe recalcular el
 * hash con sal ahora que se confirmó la contraseña correcta.
 */
function verificarPassword_(passwordPlano, filaUsuario) {
  if (filaUsuario.salt) {
    return { valido: hashPasswordSalted_(passwordPlano, filaUsuario.salt) === filaUsuario.password_hash, necesitaMigracion: false };
  }
  const valido = hashPassword_(passwordPlano) === filaUsuario.password_hash;
  return { valido: valido, necesitaMigracion: valido };
}

/** Genera sal nueva y sobreescribe password_hash/salt de un usuario existente por id. */
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
  const rows = leerTabla_(SHEET_NAMES.USUARIOS);
  const match = rows.find(function (r) { return r.usuario === usuario && r.activo === true; });
  if (!match) return { ok: false, error: 'Usuario o contraseña incorrectos' };

  const resultado = verificarPassword_(password, match);
  if (!resultado.valido) return { ok: false, error: 'Usuario o contraseña incorrectos' };
  if (resultado.necesitaMigracion) establecerPassword_(match.id, password);

  const token = Utilities.getUuid();
  const ahora = new Date();
  const expira = new Date(ahora.getTime() + 12 * 60 * 60 * 1000); // 12 horas
  appendRowFromObj_(SHEET_NAMES.SESIONES, { token: token, usuario_id: match.id, creado_en: ahora, expira_en: expira });

  return {
    ok: true,
    token: token,
    usuario: { id: match.id, nombre: match.nombre, rol: match.rol, sede: match.sede }
  };
}

function logout_(token) {
  if (token) eliminarSesion_(token);
  return { ok: true };
}

function eliminarSesion_(token) {
  const sh = sheet_(SHEET_NAMES.SESIONES);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const tokenCol = headers.indexOf('token');
  for (let r = data.length - 1; r >= 1; r--) {
    if (data[r][tokenCol] === token) {
      sh.deleteRow(r + 1);
      return;
    }
  }
}

function limpiarSesionesVencidas_() {
  const sh = sheet_(SHEET_NAMES.SESIONES);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const expiraCol = headers.indexOf('expira_en');
  const ahora = new Date();
  for (let r = data.length - 1; r >= 1; r--) {
    if (new Date(data[r][expiraCol]) < ahora) sh.deleteRow(r + 1);
  }
}

function validarToken_(token) {
  if (!token) return { ok: false, error: 'Falta token de sesión', codigo: 'SESION_INVALIDA' };
  const sesiones = leerTabla_(SHEET_NAMES.SESIONES);
  const s = sesiones.find(function (r) { return r.token === token; });
  if (!s) return { ok: false, error: 'Sesión no encontrada, vuelve a iniciar sesión', codigo: 'SESION_INVALIDA' };
  if (new Date(s.expira_en) < new Date()) {
    eliminarSesion_(token);
    return { ok: false, error: 'Sesión expirada, vuelve a iniciar sesión', codigo: 'SESION_INVALIDA' };
  }

  const usuarios = leerTabla_(SHEET_NAMES.USUARIOS);
  const u = usuarios.find(function (r) { return r.id === s.usuario_id; });
  if (!u || !u.activo) return { ok: false, error: 'Usuario inactivo', codigo: 'SESION_INVALIDA' };

  return { ok: true, usuario: { id: u.id, nombre: u.nombre, rol: u.rol, sede: u.sede } };
}

function requiereRol_(usuario, rolesPermitidos) {
  if (rolesPermitidos.indexOf(usuario.rol) === -1) {
    throw new Error('Esta acción requiere uno de estos roles: ' + rolesPermitidos.join(', '));
  }
}

function requiereAdmin_(usuario) {
  requiereRol_(usuario, ['Administrador']);
}

// ---------------------------------------------------------------------------
// HELPERS DE LECTURA/ESCRITURA GENÉRICOS
// ---------------------------------------------------------------------------
function leerTabla_(nombreHoja) {
  const sh = sheet_(nombreHoja);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(function (row) { return row.some(function (v) { return v !== '' && v !== null; }); })
    .map(function (row) {
      const obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });
}

function appendRowFromObj_(nombreHoja, obj) {
  const sh = sheet_(nombreHoja);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sh.appendRow(row);
}
