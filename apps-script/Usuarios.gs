/**
 * USUARIOS Y ROLES
 * Roles esperados: Administrador (todo), Encargado (registra conteos e importa FUDO de su sede),
 * Cocina (solo registra conteos), Lectura (solo ve dashboards, ej. para un contador externo).
 */

function usuariosListar_(usuario) {
  requiereAdmin_(usuario);
  const rows = leerTabla_(SHEET_NAMES.USUARIOS);
  return { ok: true, data: rows.map(function (r) { return { id: r.id, nombre: r.nombre, usuario: r.usuario, rol: r.rol, sede: r.sede, activo: r.activo }; }) };
}

function usuarioGuardar_(item, usuarioSesion) {
  requiereAdmin_(usuarioSesion);
  if (!item || !item.nombre || !item.usuario || !item.rol) {
    return { ok: false, error: 'Faltan campos obligatorios (nombre, usuario, rol)' };
  }
  const sh = sheet_(SHEET_NAMES.USUARIOS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const usuarioCol = headers.indexOf('usuario');

  if (item.id) {
    for (let r = 1; r < data.length; r++) {
      if (data[r][idCol] === item.id) {
        headers.forEach(function (h, c) {
          if (h === 'password_hash') return; // la contraseña se cambia con usuarioCambiarPassword_
          if (item[h] !== undefined) sh.getRange(r + 1, c + 1).setValue(item[h]);
        });
        return { ok: true, actualizado: true };
      }
    }
    return { ok: false, error: 'No se encontró el usuario con id ' + item.id };
  }

  const yaExiste = data.slice(1).some(function (row) { return row[usuarioCol] === item.usuario; });
  if (yaExiste) return { ok: false, error: 'Ya existe un usuario con ese nombre de acceso' };

  appendRowFromObj_(SHEET_NAMES.USUARIOS, {
    id: Utilities.getUuid(),
    nombre: item.nombre,
    usuario: item.usuario,
    password_hash: hashPassword_(item.password || 'cambiar123'),
    rol: item.rol,
    sede: item.sede || 'Ambas',
    activo: true
  });
  return { ok: true, creado: true };
}

const ROLES_DISPONIBLES = ['Administrador', 'Encargado', 'Cocina', 'Lectura'];
