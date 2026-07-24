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
  TRASLADOS: 'Traslados',
  AJUSTES_INVENTARIO: 'Ajustes_Inventario',
  TURNOS_SECTOR: 'Turnos_Sector',
  CIERRES_TURNO: 'Cierres_Turno',
  GESTIONES: 'Gestiones'
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
    Usuarios: ['id', 'nombre', 'usuario', 'password_hash', 'salt', 'rol', 'sede', 'activo', 'email', 'sectores_permitidos'],
    Catalogo_Maestro: ['id', 'nombre_estandar', 'nombre_fudo', 'categoria', 'unidad_base', 'tipo', 'notas', 'stock_minimo', 'frecuencia_conteo', 'obligatorio_produccion', 'sector', 'sede'],
    Recetas: ['id', 'producto', 'ingrediente', 'cantidad', 'unidad', 'rendimiento_producto', 'unidad_rendimiento',
      'tipo', 'fuente', 'umbral_alerta', 'version', 'sede', 'vigente_desde', 'vigente_hasta', 'estado',
      'controla_disponibilidad', 'notas'],
    Conteos_Manuales: ['id', 'fecha', 'sede', 'punto_conteo', 'turno', 'producto', 'unidad', 'cantidad', 'usuario', 'timestamp'],
    Movimientos_FUDO: ['fecha', 'tipo', 'evento', 'nombre', 'stock_anterior', 'stock_actual', 'diferencia', 'usuario',
      'sede', 'objeto_tipo', 'costo', 'archivo_origen', 'importado_por', 'importado_en'],
    Ventas_FUDO: ['id_venta', 'creacion', 'producto', 'categoria', 'cantidad', 'precio', 'cancelada', 'creada_por',
      'sede', 'formato_origen', 'archivo_origen', 'importado_en'],
    Sesiones: ['token', 'usuario_id', 'creado_en', 'expira_en'],
    Producciones: ['id', 'fecha', 'sede', 'item', 'cantidad', 'unidad', 'usuario', 'timestamp'],
    AlertasEnviadas: ['fecha', 'plato'],
    Traslados: ['id', 'fecha', 'producto', 'unidad', 'cantidad_enviada', 'sede_origen', 'punto_origen',
      'sede_destino', 'punto_destino', 'usuario_envia', 'timestamp_envio', 'estado', 'usuario_recibe',
      'timestamp_recibe', 'cantidad_recibida', 'observacion', 'resuelto_por', 'timestamp_resuelto', 'nota_resolucion'],
    Ajustes_Inventario: ['id', 'fecha', 'sede', 'punto', 'tipo', 'producto', 'unidad', 'cantidad', 'motivo', 'usuario', 'timestamp',
      'proveedor', 'numero_factura', 'costo', 'factura_id', 'avalado', 'avalado_por', 'timestamp_avalado'],
    Turnos_Sector: ['id', 'fecha', 'usuario_id', 'usuario_nombre', 'sector', 'timestamp'],
    Cierres_Turno: ['id', 'fecha', 'sede', 'usuario', 'timestamp'],
    Gestiones: ['id', 'fecha', 'producto', 'sede', 'estado', 'nota', 'creado_por', 'timestamp_creado',
      'actualizado_por', 'timestamp_actualizado', 'factura_id']
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

  // Nunca se crea una credencial predeterminada. En una instalación nueva, el propietario debe
  // ejecutar crearAdministradorInicial_() desde el editor con una contraseña propia.
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
      case 'catalogo_eliminar':
        requiereAdmin_(sesion.usuario);
        return jsonOut_(catalogoEliminar_(params.id));
      case 'catalogo_reparar_ids':
        requiereAdmin_(sesion.usuario);
        return jsonOut_(catalogoRepararIds_());
      case 'catalogo_fusionar':
        requiereAdmin_(sesion.usuario);
        return jsonOut_(catalogoFusionar_(params.id_conservar, params.id_eliminar));
      case 'fudo_nombres_vistos':
        requiereAdmin_(sesion.usuario);
        return jsonOut_({ ok: true, data: fudoNombresVistos_() });
      case 'recetas_listar':
        requiereAdmin_(sesion.usuario);
        return jsonOut_({ ok: true, data: recetasListar_(params.filtros) });
      case 'receta_guardar':
        requiereAdmin_(sesion.usuario);
        return jsonOut_(recetaGuardar_(params.item, sesion.usuario));
      case 'platos_fudo_sin_receta':
        requiereAdmin_(sesion.usuario);
        return jsonOut_({ ok: true, data: platosFudoSinReceta_() });
      case 'conteo_registrar':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_(conteoRegistrar_(params.items, sesion.usuario, params.opciones));
      case 'conteo_listar':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_({ ok: true, data: conteoListar_(params.fecha, sedeConsultaPermitida_(sesion.usuario, params.sede)) });
      case 'conteos_historial':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Lectura']);
        return jsonOut_({ ok: true, data: conteosHistorial_(Object.assign({}, params.filtros, { sede: sedeConsultaPermitida_(sesion.usuario, params.filtros && params.filtros.sede) })) });
      case 'turno_sector_elegir':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_(turnoSectorElegir_(params.fecha, params.sector, sesion.usuario));
      case 'turno_sector_hoy':
        return jsonOut_(turnoSectorDeHoy_(sesion.usuario, params.fecha));
      case 'turno_faltantes_por_sector':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado']);
        return jsonOut_({ ok: true, data: turnoFaltantesPorSector_(params.fecha, sedeConsultaPermitida_(sesion.usuario, params.sede)) });
      case 'turno_cerrar':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado']);
        return jsonOut_(turnoCerrar_(params.fecha, sedeConsultaPermitida_(sesion.usuario, params.sede), sesion.usuario));
      case 'turno_cierre_estado':
        return jsonOut_(turnoCierreEstado_(params.fecha, sedeConsultaPermitida_(sesion.usuario, params.sede)));
      case 'ajuste_inventario_registrar':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_(ajusteInventarioRegistrar_(params.item, sesion.usuario));
      case 'ajustes_inventario_listar':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_({ ok: true, data: ajustesInventarioListar_(params.fecha, sedeConsultaPermitida_(sesion.usuario, params.sede)) });
      case 'ajustes_inventario_historial':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Lectura']);
        return jsonOut_({ ok: true, data: ajustesInventarioHistorial_(Object.assign({}, params.filtros, { sede: sedeConsultaPermitida_(sesion.usuario, params.filtros && params.filtros.sede) })) });
      case 'ajuste_inventario_avalar':
        requiereAdmin_(sesion.usuario);
        return jsonOut_(ajusteInventarioAvalar_(params.id, sesion.usuario));
      case 'compra_registrar_factura':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_(compraRegistrarFactura_(params.factura, sesion.usuario, params.opciones));
      case 'compras_listar':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_({ ok: true, data: comprasListar_(params.fecha_desde, params.fecha_hasta, sedeConsultaPermitida_(sesion.usuario, params.sede)) });
      case 'compras_resumen_gasto':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado']);
        return jsonOut_({ ok: true, data: comprasResumenGasto_(params.fecha_desde, params.fecha_hasta, sedeConsultaPermitida_(sesion.usuario, params.sede)) });
      case 'gestion_crear':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_(gestionCrear_(params.item, sesion.usuario));
      case 'gestiones_listar':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_({ ok: true, data: gestionesListar_(params.filtro, sesion.usuario) });
      case 'gestion_actualizar_estado':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_(gestionActualizarEstado_(params.id, params.estado, params.nota, sesion.usuario));
      case 'importar_fudo':
        requiereAdmin_(sesion.usuario);
        return jsonOut_(importarFudo_(params.tipo, params.filas, sesion.usuario, params.opciones));
      case 'disponible_hoy':
        return jsonOut_({ ok: true, data: calcularDisponibleHoy_(params.fecha, sedeConsultaPermitida_(sesion.usuario, params.sede)) });
      case 'tendencia_ingrediente':
        return jsonOut_({ ok: true, data: calcularTendenciaIngrediente_(params.ingrediente, params.dias, sedeConsultaPermitida_(sesion.usuario, params.sede)) });
      case 'conciliacion':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Lectura']);
        return jsonOut_({ ok: true, data: calcularConciliacion_(params.fecha, sesion.usuario) });
      case 'produccion_registrar':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_(produccionRegistrar_(params.items, sesion.usuario));
      case 'produccion_listar':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_({ ok: true, data: produccionListar_(params.fecha, sedeConsultaPermitida_(sesion.usuario, params.sede)) });
      case 'produccion_historial':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Lectura']);
        return jsonOut_({ ok: true, data: produccionHistorial_(Object.assign({}, params.filtros, { sede: sedeConsultaPermitida_(sesion.usuario, params.filtros && params.filtros.sede) })) });
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
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        // BUG DE SEGURIDAD REAL: faltaba pasar sesion.usuario aquí. trasladosListar_ necesita ese
        // segundo argumento para filtrar por sede — sin él, `usuario` quedaba undefined dentro de
        // la función y esto explotaba con un error de servidor en TODAS las llamadas (nunca
        // devolvía traslados, sin importar el rol), en vez de limitar correctamente por sede.
        return jsonOut_({ ok: true, data: trasladosListar_(params.filtro, sesion.usuario) });
      case 'traslado_confirmar':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_(trasladoConfirmar_(params.id, params.cantidad_recibida, sesion.usuario));
      case 'traslado_observar':
        requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
        return jsonOut_(trasladoObservar_(params.id, params.cantidad_recibida, params.observacion, sesion.usuario));
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
      case 'diagnostico_compras_no_suman':
        requiereAdmin_(sesion.usuario);
        return jsonOut_({ ok: true, data: diagnosticarComprasNoSuman_() });
      case 'diagnostico_catalogo_duplicados':
        requiereAdmin_(sesion.usuario);
        return jsonOut_({ ok: true, data: diagnosticarCatalogoDuplicados_() });
      case 'migrar_recetas_julio_2026':
        requiereAdmin_(sesion.usuario);
        return jsonOut_(migrarRecetasJulio2026_());
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

// Mínimo único para cualquier contraseña nueva (alta de usuario, cambio propio o restablecimiento
// por un Administrador). El admin inicial (crearAdministradorInicial_) exige 10 por separado, por
// ser la única credencial que además protege la creación de todas las demás.
const PASSWORD_LARGO_MINIMO = 8;

// Protección contra fuerza bruta en login_: tras LOGIN_INTENTOS_MAXIMOS fallos consecutivos
// para un mismo nombre de usuario, se bloquean intentos nuevos durante LOGIN_BLOQUEO_SEGUNDOS,
// sin importar si la contraseña es correcta. Usa CacheService en vez de una hoja porque es un
// contador efímero de alta frecuencia que no necesita persistir ni ser auditado.
const LOGIN_INTENTOS_MAXIMOS = 8;
const LOGIN_BLOQUEO_SEGUNDOS = 15 * 60;

function loginIntentosClave_(usuario) {
  return 'login_intentos_' + normalizar_(usuario);
}

function loginBloqueado_(usuario) {
  const intentos = Number(CacheService.getScriptCache().get(loginIntentosClave_(usuario))) || 0;
  return intentos >= LOGIN_INTENTOS_MAXIMOS;
}

function loginRegistrarIntentoFallido_(usuario) {
  const cache = CacheService.getScriptCache();
  const clave = loginIntentosClave_(usuario);
  const intentos = (Number(cache.get(clave)) || 0) + 1;
  cache.put(clave, String(intentos), LOGIN_BLOQUEO_SEGUNDOS);
}

function loginLimpiarIntentos_(usuario) {
  CacheService.getScriptCache().remove(loginIntentosClave_(usuario));
}

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
  if (loginBloqueado_(usuario)) {
    return { ok: false, error: 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.' };
  }

  const rows = leerTabla_(SHEET_NAMES.USUARIOS);
  const match = rows.find(function (r) { return r.usuario === usuario && r.activo === true; });
  if (!match) {
    loginRegistrarIntentoFallido_(usuario);
    return { ok: false, error: 'Usuario o contraseña incorrectos' };
  }

  const resultado = verificarPassword_(password, match);
  if (!resultado.valido) {
    loginRegistrarIntentoFallido_(usuario);
    return { ok: false, error: 'Usuario o contraseña incorrectos' };
  }
  loginLimpiarIntentos_(usuario);
  if (resultado.necesitaMigracion) establecerPassword_(match.id, password);

  const token = Utilities.getUuid();
  const ahora = new Date();
  const expira = new Date(ahora.getTime() + 12 * 60 * 60 * 1000); // 12 horas
  appendRowFromObj_(SHEET_NAMES.SESIONES, { token: token, usuario_id: match.id, creado_en: ahora, expira_en: expira });

  return {
    ok: true,
    token: token,
    usuario: { id: match.id, nombre: match.nombre, rol: match.rol, sede: match.sede, sectores_permitidos: match.sectores_permitidos || '' }
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

  return { ok: true, usuario: { id: u.id, nombre: u.nombre, rol: u.rol, sede: u.sede, sectores_permitidos: u.sectores_permitidos || '' } };
}

function requiereRol_(usuario, rolesPermitidos) {
  if (rolesPermitidos.indexOf(usuario.rol) === -1) {
    throw new Error('Esta acción requiere uno de estos roles: ' + rolesPermitidos.join(', '));
  }
}

function requiereAdmin_(usuario) {
  requiereRol_(usuario, ['Administrador']);
}

/**
 * Limita las consultas operativas a la sede asignada, salvo Administrador o usuarios "Ambas".
 * Centro de Producción es la excepción: cualquiera (San Antonio, Capri o Ambas) puede consultarlo
 * además de su propia sede — en la práctica ese personal también cubre el Centro de Producción.
 * Ver sedeEscrituraPermitida_ para la misma regla del lado de "guardar".
 */
function sedeConsultaPermitida_(usuario, sedeSolicitada) {
  if (usuario.rol === 'Administrador' || usuario.sede === 'Ambas') return sedeSolicitada || null;
  if (sedeSolicitada && sedeSolicitada !== usuario.sede && sedeSolicitada !== 'Centro de Producción') {
    throw new Error('No puedes consultar datos de una sede distinta a la tuya (' + usuario.sede + ')');
  }
  return sedeSolicitada || usuario.sede;
}

/**
 * Igual que sedeConsultaPermitida_ pero para ESCRIBIR (registrar conteos, ajustes, compras,
 * producción): además de su propia sede, cualquiera puede registrar cosas en Centro de Producción
 * — pedido explícito: "el que sea de san antonio o capri o ambas todos deben de poder guardar
 * cosas del centro de producción".
 */
function sedeEscrituraPermitida_(usuario, sede) {
  return usuario.rol === 'Administrador' || usuario.sede === 'Ambas' ||
    sede === usuario.sede || sede === 'Centro de Producción';
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

/**
 * Igual que appendRowFromObj_ pero para muchas filas de una sola vez: UNA sola escritura a Sheets
 * (getRange().setValues()) en vez de una llamada `appendRow` por fila. Un `appendRow` por fila es
 * lentísimo para importaciones grandes (cada llamada es un viaje a la API de Sheets) — con un
 * archivo de FUDO de un día completo (cientos o miles de filas de ventas) esto podía tardar tanto
 * que la importación se sentía "trabada" sin ningún aviso, y en archivos grandes llegaba a superar
 * el límite de 6 minutos de ejecución de Apps Script y fallaba sin guardar nada. No hace nada si
 * `objs` viene vacío (evita pedirle a Sheets un rango de 0 filas, que revienta).
 */
function appendRowsFromObjs_(nombreHoja, objs) {
  if (!objs || !objs.length) return;
  const sh = sheet_(nombreHoja);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const filas = objs.map(function (obj) {
    return headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, filas.length, headers.length).setValues(filas);
}
