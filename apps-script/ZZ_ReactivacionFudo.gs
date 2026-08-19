/**
 * REACTIVACIÓN POR MÓDULOS — Fase Usuarios + Sincronización FUDO
 *
 * Code.gs conserva el candado de Fase 0 y todo su router histórico intacto. Esta extensión,
 * cargada después de Code.gs, amplía únicamente el permiso autoritativo para las cuatro acciones
 * manuales de FUDO aprobadas en esta fase. No habilita stock, catálogo, migraciones, inventario,
 * caja ni automatizaciones.
 */
const ACCIONES_FUDO_PERMITIDAS_REACTIVACION_ = [
  'fudo_panel_estado',
  'fudo_api_probar_conexion',
  'fudo_api_sincronizar_ventas',
  'fudo_api_sincronizar_pagos'
];

function accionPermitidaEnReactivacion_(action) {
  return !reactivacionBackendActiva_() ||
    ACCIONES_PERMITIDAS_REACTIVACION_BACKEND.indexOf(action) !== -1 ||
    ACCIONES_FUDO_PERMITIDAS_REACTIVACION_.indexOf(action) !== -1;
}
