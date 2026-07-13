function hashSecret_(value) {
  const props = PropertiesService.getScriptProperties();
  let salt = props.getProperty(AMELIA.AUTH_SALT_PROPERTY);
  if (!salt) {
    salt = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(AMELIA.AUTH_SALT_PROPERTY, salt);
  }
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + String(value), Utilities.Charset.UTF_8);
  return bytes.map(function(b) { const v = b < 0 ? b + 256 : b; return ('0' + v.toString(16)).slice(-2); }).join('');
}

function issueSession_(user) {
  const token = Utilities.getUuid() + Utilities.getUuid();
  const expires = new Date(Date.now() + AMELIA.SESSION_HOURS * 60 * 60 * 1000);
  appendRow_('Sessions', {
    sessionId: makeId_('ses'), tokenHash: hashSecret_(token), userId: user.userId,
    expiresAt: expires.toISOString(), createdAt: nowIso_()
  });
  return token;
}

function login_(email, pin) {
  const normalizedEmail = normalizeText_(email);
  const user = findRow_('Users', function(row) { return normalizeText_(row.email) === normalizedEmail && String(row.active) !== 'false'; });
  if (!user || user.pinHash !== hashSecret_(pin)) throw new Error('Correo o PIN incorrecto.');
  const token = issueSession_(user);
  audit_(user.userId, 'LOGIN', 'USER', user.userId, { email: user.email });
  return { token: token, user: publicUser_(user) };
}

function autoLogin_() {
  const email = Session.getActiveUser().getEmail();
  if (!email) return null;
  const user = findRow_('Users', function(row) { return normalizeText_(row.email) === normalizeText_(email) && String(row.active) !== 'false'; });
  if (!user) return null;
  return { token: issueSession_(user), user: publicUser_(user) };
}

function requireUser_(token, roles) {
  if (!token) throw new Error('Sesión requerida.');
  const tokenHash = hashSecret_(token);
  const session = findRow_('Sessions', function(row) { return row.tokenHash === tokenHash; });
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) throw new Error('La sesión venció. Ingresa nuevamente.');
  const user = findRow_('Users', function(row) { return row.userId === session.userId && String(row.active) !== 'false'; });
  if (!user) throw new Error('Usuario inactivo o inexistente.');
  if (roles && roles.length && roles.indexOf(user.role) < 0) throw new Error('No tienes permiso para realizar esta acción.');
  return user;
}

function canAccessLocation_(user, locationId) {
  const allowed = String(user.locations || '').split(',').map(function(x) { return x.trim(); });
  return user.role === AMELIA.ROLES.ADMIN || allowed.indexOf(AMELIA.LOCATION_ALL) >= 0 || allowed.indexOf(locationId) >= 0;
}

function requireLocation_(user, locationId) {
  if (!canAccessLocation_(user, locationId)) throw new Error('No tienes acceso a esta sede.');
}

function publicUser_(user) {
  return { userId: user.userId, email: user.email, name: user.name, role: user.role, locations: String(user.locations || '').split(',').filter(String) };
}

function listUsers_(token) {
  requireUser_(token, [AMELIA.ROLES.ADMIN]);
  return getRows_('Users').map(publicUser_);
}

function saveUser_(token, data) {
  const actor = requireUser_(token, [AMELIA.ROLES.ADMIN]);
  if (!data.email || !data.name || !data.role) throw new Error('Nombre, correo y rol son obligatorios.');
  const allowedRoles = Object.keys(AMELIA.ROLES).map(function(k) { return AMELIA.ROLES[k]; });
  if (allowedRoles.indexOf(data.role) < 0) throw new Error('Rol inválido.');
  const existing = data.userId ? findRow_('Users', function(r) { return r.userId === data.userId; }) : null;
  const id = existing ? existing.userId : makeId_('usr');
  const row = {
    userId: id, email: String(data.email).trim(), name: String(data.name).trim(), role: data.role,
    locations: Array.isArray(data.locations) ? data.locations.join(',') : String(data.locations || ''),
    active: data.active === false ? false : true,
    pinHash: data.pin ? hashSecret_(data.pin) : (existing ? existing.pinHash : ''),
    createdAt: existing ? existing.createdAt : nowIso_(), updatedAt: nowIso_()
  };
  if (!row.pinHash) throw new Error('Debes asignar un PIN al usuario nuevo.');
  upsertRow_('Users', 'userId', row);
  audit_(actor.userId, existing ? 'UPDATE_USER' : 'CREATE_USER', 'USER', id, publicUser_(row));
  return publicUser_(row);
}

function logout_(token) {
  const user = requireUser_(token);
  const hash = hashSecret_(token);
  const sheet = getTable_('Sessions');
  const rows = sheet.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) if (rows[i][1] === hash) sheet.deleteRow(i + 1);
  audit_(user.userId, 'LOGOUT', 'USER', user.userId, {});
  return true;
}

