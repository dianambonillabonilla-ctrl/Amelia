/**
 * REACTIVACIÓN POR MÓDULOS — Usuarios + Sincronización FUDO + Caja
 *
 * Code.gs conserva el candado y router histórico intactos. Esta extensión, cargada al final,
 * amplía únicamente las acciones aprobadas durante la reactivación y adapta el perfil canónico
 * "Caja" al permiso operativo legado "Encargado" que todavía existe en partes del backend.
 */
const ACCIONES_FUDO_PERMITIDAS_REACTIVACION_ = [
  'fudo_panel_estado',
  'fudo_api_probar_conexion',
  'fudo_api_sincronizar_ventas',
  'fudo_api_sincronizar_pagos'
];

const ACCIONES_CAJA_PERMITIDAS_REACTIVACION_ = [
  'caja_estado',
  'caja_abrir',
  'caja_movimiento_registrar',
  'caja_movimientos_listar',
  'caja_cerrar',
  'caja_sincronizar_ahora'
];

function accionPermitidaEnReactivacion_(action) {
  return !reactivacionBackendActiva_() ||
    ACCIONES_PERMITIDAS_REACTIVACION_BACKEND.indexOf(action) !== -1 ||
    ACCIONES_FUDO_PERMITIDAS_REACTIVACION_.indexOf(action) !== -1 ||
    ACCIONES_CAJA_PERMITIDAS_REACTIVACION_.indexOf(action) !== -1;
}

/**
 * Compatibilidad temporal de perfiles mientras se migra el backend completo:
 * Caja equivale al antiguo Encargado para permisos operativos y Gerencia a Lectura para consulta.
 * No amplía sedes: sedeConsultaPermitida_/sedeEscrituraPermitida_ siguen aplicando normalmente.
 */
function requiereRol_(usuario, rolesPermitidos) {
  const equivalencias = {
    Caja: 'Encargado',
    Gerencia: 'Lectura'
  };
  const rolEfectivo = equivalencias[usuario.rol] || usuario.rol;
  if (rolesPermitidos.indexOf(usuario.rol) === -1 && rolesPermitidos.indexOf(rolEfectivo) === -1) {
    throw new Error('Esta acción requiere uno de estos roles: ' + rolesPermitidos.join(', '));
  }
}

/** El perfil Caja puede cerrar la caja de su sede sin depender de un sector adicional. */
function cajaPuedeCerrar_(usuario, fecha) {
  return usuario.rol === 'Administrador' || usuario.rol === 'Caja' || usuario.rol === 'Encargado';
}