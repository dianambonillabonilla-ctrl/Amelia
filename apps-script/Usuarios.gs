/**
 * USUARIOS, PERFILES Y ALCANCE
 *
 * Perfiles definitivos:
 *  - Administrador: superusuario. Puede hacer todo, en todas las sedes, incluida configuración,
 *    correcciones, usuarios y acciones administrativas.
 *  - Caja: perfil operativo amplio de su sede. Puede registrar operaciones nuevas como caja,
 *    conteos, producción, recepciones, traslados y las demás que se habiliten módulo por módulo.
 *    NO puede corregir, borrar ni modificar registros ya guardados. Sí podrá ver el estado de la
 *    sincronización con FUDO y consultar inventario de todas las sedes para decidir traslados.
 *  - Cocina: perfil operativo de cocina/producción. Puede registrar las operaciones habilitadas de
 *    su sede y consultar inventario de todas las sedes para detectar necesidades de traslado.
 *    Consultar otra sede NO autoriza a registrar en ella.
 *  - Gerencia: perfil de consulta, control, indicadores e históricos. No registra operación.
 *
 * Perfil, sede y sector son conceptos diferentes:
 *  - perfil = qué puede hacer la persona;
 *  - sede = dónde puede registrar operación;
 *  - sectores_permitidos = responsabilidades que puede asumir en un turno.
 *
 * Durante la reactivación por etapas solo el módulo Usuarios está activo. Los permisos operativos
 * se irán aplicando y probando al reactivar cada módulo; esta pantalla ya deja los perfiles y la
 * sede correctamente definidos para no seguir usando los nombres antiguos Encargado/Lectura.
 */

const ROLES_DISPONIBLES = ['Administrador', 'Caja', 'Cocina', 'Gerencia'];
const SEDES_DISPONIBLES = ['Ambas', 'San Antonio', 'Capri', 'Centro de Producción'];
const ROLES_LEGACY_ = { Encargado: 'Caja', Lectura: 'Gerencia' };

function normalizarRolUsuario_(rol) {
  return ROLES_LEGACY_[rol] || rol;
}

function usuariosListar_(usuario) {
  requiereAdmin_(usuario);
  const rows = leerTabla_(SHEET_NAMES.USUARIOS);
  return {
    ok: true,
    data: rows.map(function (r) {
      return {
        id: r.id,
        nombre: r.nombre,
        usuario: r.usuario,
        rol: normalizarRolUsuario_(r.rol),
        sede: r.sede,
        activo: r.activo,
        email: r.email,
        sectores_permitidos: r.sectores_permitidos || ''
      };
    })
  };
}

function usuarioGuardar_(item, usuarioSesion) {
  requiereAdmin_(usuarioSesion);
  if (!item) return { ok: false, error: 'Faltan datos del usuario' };

  // Acepta temporalmente nombres antiguos al editar cuentas existentes, pero siempre guarda el
  // nombre canónico. Así la pantalla no pierde usuarios creados antes del cambio de perfiles.
  if (item.rol !== undefined) item.rol = normalizarRolUsuario_(item.rol);

  // Crear un usuario nuevo sí exige nombre/usuario/rol. Actualizar uno existente (ej. activar o
  // desactivar) puede enviar solo los campos que cambian.
  if (!item.id && (!item.nombre || !item.usuario || !item.rol)) {
    return { ok: false, error: 'Faltan campos obligatorios (nombre, usuario, perfil)' };
  }
  if (item.rol !== undefined && ROLES_DISPONIBLES.indexOf(item.rol) === -1) {
    return { ok: false, error: 'Perfil no válido: ' + item.rol };
  }
  if (item.sede !== undefined && SEDES_DISPONIBLES.indexOf(item.sede) === -1) {
    return { ok: false, error: 'Sede no válida: ' + item.sede };
  }

  // El Administrador es superusuario: su alcance de sede siempre es Ambas.
  if (item.rol === 'Administrador') item.sede = 'Ambas';

  const sh = sheet_(SHEET_NAMES.USUARIOS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const usuarioCol = headers.indexOf('usuario');

  if (item.id) {
    for (let r = 1; r < data.length; r++) {
      if (data[r][idCol] === item.id) {
        // Evita que el Administrador que está gestionando cuentas se saque a sí mismo del sistema.
        if (item.id === usuarioSesion.id && item.activo === false) {
          return { ok: false, error: 'No puedes desactivar tu propia cuenta mientras la estás usando' };
        }
        if (item.id === usuarioSesion.id && item.rol !== undefined && item.rol !== 'Administrador') {
          return { ok: false, error: 'No puedes quitarte a ti mismo el perfil de Administrador' };
        }

        if (item.usuario !== undefined && item.usuario !== data[r][usuarioCol]) {
          const enUsoPorOtro = data.slice(1).some(function (row, i) {
            return (i + 1) !== r && row[usuarioCol] === item.usuario;
          });
          if (enUsoPorOtro) return { ok: false, error: 'Ya existe un usuario con ese nombre de acceso' };
        }

        const filaAnterior = {};
        headers.forEach(function (h, c) { filaAnterior[h] = data[r][c]; });

        headers.forEach(function (h, c) {
          if (h === 'password_hash' || h === 'salt') return;
          if (item[h] !== undefined) sh.getRange(r + 1, c + 1).setValue(neutralizarFormula_(item[h]));
        });

        // Bitácora de los campos que cambian permisos o alcance.
        const camposAuditados = ['nombre', 'rol', 'sede', 'activo', 'sectores_permitidos'];
        const anterior = {};
        const nuevo = {};
        camposAuditados.forEach(function (h) {
          if (item[h] !== undefined && item[h] !== filaAnterior[h]) {
            anterior[h] = filaAnterior[h];
            nuevo[h] = item[h];
          }
        });
        if (Object.keys(nuevo).length) {
          auditoriaRegistrar_(usuarioSesion, 'usuario_editado', 'Usuario', item.id, anterior, nuevo, filaAnterior.sede);
        }

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
    email: item.email || '',
    sectores_permitidos: item.sectores_permitidos || ''
  });
  return { ok: true, creado: true };
}

/** Cambio de contraseña propio: requiere conocer la actual. */
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
  eliminarSesionesDeUsuario_(fila.id);
  return { ok: true };
}

/** Restablecimiento de contraseña por un Administrador. */
function usuarioResetearPassword_(id, passwordNueva, usuarioSesion) {
  requiereAdmin_(usuarioSesion);
  if (!id) return { ok: false, error: 'Falta el id del usuario' };
  if (!passwordNueva || String(passwordNueva).length < PASSWORD_LARGO_MINIMO) {
    return { ok: false, error: 'La nueva contraseña debe tener al menos ' + PASSWORD_LARGO_MINIMO + ' caracteres' };
  }
  const existe = leerTabla_(SHEET_NAMES.USUARIOS).some(function (r) { return r.id === id; });
  if (!existe) return { ok: false, error: 'No se encontró el usuario' };

  establecerPassword_(id, passwordNueva);
  eliminarSesionesDeUsuario_(id);
  return { ok: true };
}
