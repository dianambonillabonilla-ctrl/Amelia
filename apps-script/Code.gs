/**
 * DILANA OS — Backend (Google Apps Script)
 * Amelia Café / La Wafflería — Control de inventario, conciliación FUDO y disponibilidad
 *
 * ARQUITECTURA
 * - Este script se vincula a UN Google Sheet que actúa como base de datos (ver README para las hojas requeridas).
 * - Se despliega como "Web App" (Implementar > Nueva implementación > Aplicación web).
 * - El frontend (GitHub Pages) llama a la URL /exec de este script vía fetch(), enviando `token` en cada solicitud.
 *
 * HOJAS QUE ESTE SCRIPT ESPERA ENCONTRAR (se crean solas la primera vez que corres `configurarHojas()`):
 *   Usuarios            | Catalogo_Maestro | Recetas | Conteos_Manuales
 *   Movimientos_FUDO     | Ventas_FUDO      | Sesiones
 */

const SHEET_NAMES = {
  USUARIOS: 'Usuarios',
  CATALOGO: 'Catalogo_Maestro',
  RECETAS: 'Recetas',
  CONTEOS: 'Conteos_Manuales',
  MOVIMIENTOS_FUDO: 'Movimientos_FUDO',
  VENTAS_FUDO: 'Ventas_FUDO',
  SESIONES: 'Sesiones'
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
// SETUP — correr esta función UNA vez manualmente desde el editor de Apps Script
// ---------------------------------------------------------------------------
function configurarHojas() {
  const spec = {
    Usuarios: ['id', 'nombre', 'usuario', 'password_hash', 'rol', 'sede', 'activo'],
    Catalogo_Maestro: ['id', 'nombre_estandar', 'nombre_fudo', 'categoria', 'unidad_base', 'tipo', 'notas'],
    Recetas: ['producto', 'ingrediente', 'cantidad', 'unidad', 'fuente'],
    Conteos_Manuales: ['id', 'fecha', 'sede', 'punto_conteo', 'turno', 'producto', 'unidad', 'cantidad', 'usuario', 'timestamp'],
    Movimientos_FUDO: ['fecha', 'tipo', 'evento', 'nombre', 'stock_anterior', 'stock_actual', 'diferencia', 'usuario', 'costo', 'importado_por', 'importado_en'],
    Ventas_FUDO: ['id_venta', 'creacion', 'producto', 'categoria', 'cantidad', 'precio', 'cancelada', 'creada_por', 'sede', 'importado_en'],
    Sesiones: ['token', 'usuario_id', 'creado_en', 'expira_en']
  };
  const spreadsheet = ss_();
  Object.keys(spec).forEach(function (name) {
    let sh = spreadsheet.getSheetByName(name);
    if (!sh) sh = spreadsheet.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, spec[name].length).setValues([spec[name]]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, spec[name].length).setFontWeight('bold').setBackground('#0B1F3A').setFontColor('#FFFFFF');
    }
  });

  // Usuario administrador por defecto (cambia la contraseña en la hoja Usuarios luego de crearla)
  const usuarios = sheet_(SHEET_NAMES.USUARIOS);
  if (usuarios.getLastRow() === 1) {
    usuarios.appendRow([Utilities.getUuid(), 'Diana Bonilla', 'diana', hashPassword_('cambiar123'), 'Administrador', 'Ambas', true]);
  }
  SpreadsheetApp.flush();
  Logger.log('Hojas configuradas. Usuario inicial: diana / cambiar123 (cámbialo).');
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
    // Login no requiere token
    if (action === 'login') {
      return jsonOut_(login_(params.usuario, params.password));
    }

    // Todo lo demás requiere sesión válida
    const sesion = validarToken_(params.token);
    if (!sesion.ok) return jsonOut_(sesion);

    switch (action) {
      case 'whoami':
        return jsonOut_({ ok: true, usuario: sesion.usuario });
      case 'catalogo_listar':
        return jsonOut_({ ok: true, data: leerTabla_(SHEET_NAMES.CATALOGO) });
      case 'catalogo_guardar':
        return jsonOut_(catalogoGuardar_(params.item, sesion.usuario));
      case 'recetas_listar':
        return jsonOut_({ ok: true, data: leerTabla_(SHEET_NAMES.RECETAS) });
      case 'conteo_registrar':
        return jsonOut_(conteoRegistrar_(params.items, sesion.usuario));
      case 'conteo_listar':
        return jsonOut_({ ok: true, data: conteoListar_(params.fecha, params.sede) });
      case 'importar_fudo':
        return jsonOut_(importarFudo_(params.tipo, params.filas, sesion.usuario));
      case 'disponible_hoy':
        return jsonOut_({ ok: true, data: calcularDisponibleHoy_(params.fecha) });
      case 'conciliacion':
        return jsonOut_({ ok: true, data: calcularConciliacion_(params.fecha) });
      case 'usuarios_listar':
        return jsonOut_(usuariosListar_(sesion.usuario));
      case 'usuarios_guardar':
        return jsonOut_(usuarioGuardar_(params.item, sesion.usuario));
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
// AUTENTICACIÓN (token simple en hoja Sesiones, igual patrón que CTTG Medicina)
// ---------------------------------------------------------------------------
function hashPassword_(pw) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pw));
}

function login_(usuario, password) {
  if (!usuario || !password) return { ok: false, error: 'Usuario y contraseña son obligatorios' };
  const rows = leerTabla_(SHEET_NAMES.USUARIOS);
  const match = rows.find(function (r) {
    return r.usuario === usuario && r.activo === true && r.password_hash === hashPassword_(password);
  });
  if (!match) return { ok: false, error: 'Usuario o contraseña incorrectos' };

  const token = Utilities.getUuid();
  const ahora = new Date();
  const expira = new Date(ahora.getTime() + 12 * 60 * 60 * 1000); // 12 horas
  sheet_(SHEET_NAMES.SESIONES).appendRow([token, match.id, ahora, expira]);

  return {
    ok: true,
    token: token,
    usuario: { id: match.id, nombre: match.nombre, rol: match.rol, sede: match.sede }
  };
}

function validarToken_(token) {
  if (!token) return { ok: false, error: 'Falta token de sesión' };
  const sesiones = leerTabla_(SHEET_NAMES.SESIONES);
  const s = sesiones.find(function (r) { return r.token === token; });
  if (!s) return { ok: false, error: 'Sesión no encontrada, vuelve a iniciar sesión' };
  if (new Date(s.expira_en) < new Date()) return { ok: false, error: 'Sesión expirada, vuelve a iniciar sesión' };

  const usuarios = leerTabla_(SHEET_NAMES.USUARIOS);
  const u = usuarios.find(function (r) { return r.id === s.usuario_id; });
  if (!u || !u.activo) return { ok: false, error: 'Usuario inactivo' };

  return { ok: true, usuario: { id: u.id, nombre: u.nombre, rol: u.rol, sede: u.sede } };
}

function requiereAdmin_(usuario) {
  if (usuario.rol !== 'Administrador') throw new Error('Esta acción requiere rol Administrador');
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

module_ = this; // no-op, mantiene referencia global consistente entre archivos .gs
