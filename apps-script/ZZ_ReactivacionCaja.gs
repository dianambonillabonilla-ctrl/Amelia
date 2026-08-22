/** Reactivación mínima para la Caja reconstruida desde cero. */
const ACCIONES_FUDO_PERMITIDAS_REACTIVACION_ = [
  'fudo_panel_estado','fudo_api_probar_conexion','fudo_api_sincronizar_ventas','fudo_api_sincronizar_pagos'
];
const ACCIONES_CAJA_PERMITIDAS_REACTIVACION_ = [
  'caja_estado','caja_abrir','caja_movimiento_registrar','caja_movimientos_listar',
  'caja_cerrar','caja_sincronizar_ahora','caja_resumen_admin','caja_historial_listar'
];

function accionPermitidaEnReactivacion_(action) {
  return !reactivacionBackendActiva_() ||
    ACCIONES_PERMITIDAS_REACTIVACION_BACKEND.indexOf(action) !== -1 ||
    ACCIONES_FUDO_PERMITIDAS_REACTIVACION_.indexOf(action) !== -1 ||
    ACCIONES_CAJA_PERMITIDAS_REACTIVACION_.indexOf(action) !== -1;
}

function requiereRol_(usuario, rolesPermitidos) {
  const rolEfectivo = usuario && usuario.rol === 'Caja' ? 'Encargado' : (usuario && usuario.rol);
  if (rolesPermitidos.indexOf(rolEfectivo) === -1 && rolesPermitidos.indexOf(usuario && usuario.rol) === -1) {
    throw new Error('Esta acción requiere uno de estos roles: ' + rolesPermitidos.join(', '));
  }
}
