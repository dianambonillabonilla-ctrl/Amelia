/**
 * USUARIOS Y ROLES
 * Roles esperados:
 *  - Administrador: todo, incluyendo importar de FUDO, gestionar el catálogo y crear usuarios.
 *  - Encargado: registra conteos y producción, ve Disponible Hoy y Conciliación — NO puede
 *    importar de FUDO ni gestionar catálogo/usuarios (ver requiereAdmin_ en Code.gs).
 *  - Cocina: igual que Encargado pero sin necesidad de ver conciliación (solo registra).
 *  - Lectura: solo ve dashboards (disponible_hoy, conciliación), no puede registrar nada
 *    (conteo_registrar/produccion_registrar exigen Administrador/Encargado/Cocina).
 *
 * La sede del usuario (columna `sede`: "Ambas", o una sede específica) limita para qué sede
 * puede registrar conteos/producción — ver la validación en Conteos.gs/Produccion.gs. Un usuario
 * que necesite registrar traslados entre sedes (ej. mover algo de Centro de Producción a una
 * sede) debe tener sede = "Ambas"; si su sede es una sola, el backend rechaza registrar para
 * cualquier otra.
 */

function usuariosListar_(usuario) {
  requiereAdmin_(usuario);
  const rows = leerTabla_(SHEET_NAMES.USUARIOS);
  return { ok: true, data: rows.map(function (r) { return { id: r.id, nombre: r.nombre, usuario: r.usuario, rol: r.rol, sede: r.sede, activo: r.activo, email: r.email }; }) };
}

function usuarioGuardar_(item, usuarioSesion) {
  requiereAdmin_(usuarioSesion);
  if (!item || !item.nombre || !item.usuario || !item.rol) {
    return { ok: false, error: 'Faltan campos obligatorios (nombre, usuario, rol)' };
  }
  if (ROLES_DISPONIBLES.indexOf(item.rol) === -1) {
    return { ok: false, error: 'Rol no válido: ' + item.rol };
  }
  const sh = sheet_(SHEET_NAMES.USUARIOS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const usuarioCol = headers.indexOf('usuario');

  if (item.id) {
    for (let r = 1; r < data.length; r++) {
      if (data[r][idCol] === item.id) {
        if (item.usuario !== undefined && item.usuario !== data[r][usuarioCol]) {
          const enUsoPorOtro = data.slice(1).some(function (row, i) {
            return (i + 1) !== r && row[usuarioCol] === item.usuario;
          });
          if (enUsoPorOtro) return { ok: false, error: 'Ya existe un usuario con ese nombre de acceso' };
        }
        headers.forEach(function (h, c) {
          if (h === 'password_hash' || h === 'salt') return; // la contraseña se cambia con cambiarPassword_
          if (item[h] !== undefined) sh.getRange(r + 1, c + 1).setValue(sanitizarCelda_(item[h]));
        });
        return { ok: true, actualizado: true };
      }
    }
    return { ok: false, error: 'No se encontró el usuario con id ' + item.id };
  }

  const yaExiste = data.slice(1).some(function (row) { return row[usuarioCol] === item.usuario; });
  if (yaExiste) return { ok: false, error: 'Ya existe un usuario con ese nombre de acceso' };
  if (!item.password || String(item.password).length < PASSWORD_LARGO_MINIMO) {
    return { ok: false, error: 'La contraseña inicial debe tener al menos ' + PASSWORD_LARGO_MINIMO + ' caracteres' };
  }

  const salt = generarSalt_();
  appendRowFromObj_(SHEET_NAMES.USUARIOS, {
    id: Utilities.getUuid(),
    nombre: item.nombre,
    usuario: item.usuario,
    password_hash: hashPasswordSalted_(item.password, salt),
    salt: salt,
    rol: item.rol,
    sede: item.sede || 'Ambas',
    activo: true,
    email: item.email || ''
  });
  return { ok: true, creado: true };
}

/** Cambio de contraseña propio: requiere conocer la actual. Usado por la pantalla "Cambiar contraseña". */
function cambiarPassword_(usuarioSesion, passwordActual, passwordNueva) {
  if (!passwordActual || !passwordNueva) return { ok: false, error: 'Falta la contraseña actual o la nueva' };
  if (String(passwordNueva).length < PASSWORD_LARGO_MINIMO) {
    return { ok: false, error: 'La nueva contraseña debe tener al menos ' + PASSWORD_LARGO_MINIMO + ' caracteres' };
  }

  const fila = leerTabla_(SHEET_NAMES.USUARIOS).find(function (r) { return r.id === usuarioSesion.id; });
  if (!fila) return { ok: false, error: 'Usuario no encontrado' };

  const resultado = verificarPassword_(passwordActual, fila);
  if (!resultado.valido) return { ok: false, error: 'La contraseña actual no es correcta' };

  establecerPassword_(fila.id, passwordNueva);
  return { ok: true };
}

/**
 * Restablecimiento de contraseña por un Administrador — NO requiere conocer la contraseña
 * anterior. Existe para poder reaccionar rápido si una contraseña quedó expuesta (ej. guardada
 * en texto plano en la hoja por error): el Administrador le pone una nueva de una vez, sin
 * depender de que el usuario afectado la recuerde o la comparta por otro medio inseguro.
 */
function usuarioResetearPassword_(id, passwordNueva, usuarioSesion) {
  requiereAdmin_(usuarioSesion);
  if (!id) return { ok: false, error: 'Falta el id del usuario' };
  if (!passwordNueva || String(passwordNueva).length < PASSWORD_LARGO_MINIMO) {
    return { ok: false, error: 'La nueva contraseña debe tener al menos ' + PASSWORD_LARGO_MINIMO + ' caracteres' };
  }
  const existe = leerTabla_(SHEET_NAMES.USUARIOS).some(function (r) { return r.id === id; });
  if (!existe) return { ok: false, error: 'No se encontró el usuario' };

  establecerPassword_(id, passwordNueva);
  return { ok: true };
}

const ROLES_DISPONIBLES = ['Administrador', 'Encargado', 'Cocina', 'Lectura'];
