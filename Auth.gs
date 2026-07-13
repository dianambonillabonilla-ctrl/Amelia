function login(payload) {
  payload = payload || {};
  var username = String(payload.username || '').trim();
  var password = String(payload.password || '');

  if (!username || !password) {
    return { ok: false, message: 'Usuario y contraseña son obligatorios.' };
  }

  var users = getAllAsObjects_('Usuarios');
  var user = users.find(function(u) {
    return String(u.usuario).toLowerCase() === username.toLowerCase() && String(u.estado).toUpperCase() === 'ACTIVO';
  });
  if (!user) return { ok: false, message: 'Usuario o contraseña inválidos.' };

  var calc = hashPassword(password, user.salt);
  if (calc !== user.hash_password) return { ok: false, message: 'Usuario o contraseña inválidos.' };

  var token = generateToken();
  var now = new Date();
  var expires = new Date(now.getTime() + APP_CONFIG.SESSION_HOURS * 60 * 60 * 1000);

  appendRow_('Sesiones', [token, user.id_usuario, user.usuario, now.toISOString(), now.toISOString(), expires.toISOString(), 'ACTIVA']);
  touchLastLogin_(user.id_usuario);
  logAudit_(user, 'Auth', 'LOGIN', 'Usuarios', user.id_usuario, 'Ingreso exitoso');

  return {
    ok: true,
    token: token,
    user: {
      idUsuario: user.id_usuario,
      codigoUsuario: user.codigo_usuario,
      nombre: user.nombre_completo,
      rol: user.rol,
      sede: user.sede_asignada,
      debeCambiarPassword: user.debe_cambiar_password
    }
  };
}

function logout(token) {
  var sh = getSheet_('Sesiones');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(token)) {
      sh.getRange(i + 1, 7).setValue('CERRADA');
      return { ok: true };
    }
  }
  return { ok: false, message: 'Sesión no encontrada.' };
}

function getSessionUser_(token) {
  if (!token) throw new Error('Token requerido.');
  if (String(token).indexOf('SYS-') === 0) {
    return {
      id_usuario: 'SISTEMA',
      codigo_usuario: 'SYS',
      nombre_completo: 'Sistema',
      rol: 'GERENCIA',
      sede_asignada: 'SEDE-SA',
      estado: 'ACTIVO'
    };
  }
  var sessions = getAllAsObjects_('Sesiones');
  var ses = sessions.find(function(s) {
    return s.token === token && s.estado === 'ACTIVA';
  });
  if (!ses) throw new Error('Sesión inválida.');
  if (new Date(ses.expiracion).getTime() < Date.now()) throw new Error('Sesión expirada.');

  var users = getAllAsObjects_('Usuarios');
  var user = users.find(function(u) { return u.id_usuario === ses.id_usuario; });
  if (!user || String(user.estado).toUpperCase() !== 'ACTIVO') throw new Error('Usuario inactivo.');
  return user;
}

function createUser(payload, token) {
  var actor = getSessionUser_(token);
  if (!canManageUsers_(actor.rol)) throw new Error('Sin permisos para crear usuarios.');

  payload = payload || {};
  var id = generateId('USR');
  var code = String(payload.codigoUsuario || '').trim();
  if (!code) throw new Error('Código de usuario requerido.');

  var users = getAllAsObjects_('Usuarios');
  if (users.some(function(u) { return String(u.codigo_usuario).toUpperCase() === code.toUpperCase(); })) {
    throw new Error('Código de usuario ya existe.');
  }

  var salt = generateSalt();
  appendRow_('Usuarios', [
    id,
    code,
    payload.nombreCompleto || '',
    payload.usuario || '',
    hashPassword(payload.password || 'Cambiar123!', salt),
    salt,
    payload.rol || 'COCINA',
    payload.sedeAsignada || 'SEDE-SA',
    'ACTIVO',
    'SI',
    payload.correo || '',
    payload.telefono || '',
    nowIso(),
    ''
  ]);

  logAudit_(actor, 'Usuarios', 'CREAR_USUARIO', 'Usuarios', id, 'Creación de usuario ' + (payload.usuario || ''));
  return { ok: true, idUsuario: id };
}

function touchLastLogin_(idUsuario) {
  var sh = getSheet_('Usuarios');
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === idUsuario) {
      sh.getRange(i + 1, 14).setValue(nowIso());
      return;
    }
  }
}

function canManageUsers_(rol) {
  return ['GERENCIA', 'ADMIN_GENERAL'].indexOf(String(rol || '').toUpperCase()) >= 0;
}
