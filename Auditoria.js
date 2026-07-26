/**
 * BITÁCORA DE AUDITORÍA (append-only)
 * Un registro permanente de "quién cambió qué, cuándo, de qué valor a qué valor" — nunca se
 * sobrescribe ni se borra una fila de aquí, solo se agregan nuevas. Existe porque, antes de esto,
 * corregir un conteo o editar un usuario SOBRESCRIBÍA el valor anterior sin dejar rastro: no había
 * forma de saber si un conteo se registró mal desde el principio o si alguien lo "corrigió" después,
 * ni qué rol/sede tenía un usuario antes de un cambio (auditoría de seguridad, jul 2026).
 *
 * Cubre: corregir un conteo (Conteos.gs), editar un usuario (Usuarios.gs), cambios de estado de un
 * traslado — confirmar/observar/resolver (Traslados.gs), avalar una merma y corregir la unidad de
 * una compra (AjustesInventario.gs), y cambiar el estado de una gestión (Gestiones.gs). No registra
 * la CREACIÓN de estas entidades (compras, traslados nuevos, gestiones nuevas) — esa ya queda
 * completa en su propia fila desde el principio; la bitácora existe para lo que se pierde al
 * corregir/actualizar algo ya guardado.
 */
function auditoriaRegistrar_(usuario, accion, entidadTipo, entidadId, valorAnterior, valorNuevo, sede, motivo) {
  try {
    appendRowFromObj_(SHEET_NAMES.AUDITORIA, {
      id: Utilities.getUuid(),
      timestamp: new Date(),
      usuario_id: (usuario && usuario.id) || '',
      usuario_nombre: (usuario && usuario.nombre) || '',
      accion: accion,
      entidad_tipo: entidadTipo,
      entidad_id: entidadId || '',
      valor_anterior: (valorAnterior !== undefined && valorAnterior !== null) ? JSON.stringify(valorAnterior) : '',
      valor_nuevo: (valorNuevo !== undefined && valorNuevo !== null) ? JSON.stringify(valorNuevo) : '',
      sede: sede || '',
      motivo: motivo || ''
    });
  } catch (err) {
    // La bitácora nunca debe bloquear la operación real (ej. guardar un conteo) si por algún
    // motivo falla el registro de auditoría — queda constancia en el registro de ejecución en vez
    // de reventar toda la acción que sí le importa a quien está usando la app.
    Logger.log('auditoriaRegistrar_ falló: ' + err.message);
  }
}

/** Histórico de la bitácora, más reciente primero — para una futura pantalla de auditoría. */
function auditoriaListar_(filtros) {
  filtros = filtros || {};
  let rows = leerTabla_(SHEET_NAMES.AUDITORIA);
  if (filtros.entidad_tipo) rows = rows.filter(function (r) { return r.entidad_tipo === filtros.entidad_tipo; });
  if (filtros.entidad_id) rows = rows.filter(function (r) { return r.entidad_id === filtros.entidad_id; });
  if (filtros.fecha_desde) rows = rows.filter(function (r) { return new Date(r.timestamp) >= new Date(filtros.fecha_desde); });
  if (filtros.fecha_hasta) rows = rows.filter(function (r) { return new Date(r.timestamp) <= new Date(filtros.fecha_hasta + 'T23:59:59'); });
  return rows.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
}