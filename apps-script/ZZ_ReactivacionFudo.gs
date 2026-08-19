/**
 * REACTIVACIÓN POR MÓDULOS — Usuarios + Sincronización FUDO + Caja
 *
 * Code.gs conserva el candado y router histórico intactos. Esta extensión, cargada al final,
 * amplía únicamente las acciones aprobadas durante la reactivación y adapta el perfil canónico
 * "Caja" al permiso operativo legado "Encargado" que todavía existe en partes del backend.
 *
 * En esta fase SÍ se permite una única automatización operativa: sincronizar los datos financieros
 * de FUDO (ventas/pagos; descuentos y propinas llegan con ventas) cada 15 minutos. No se encienden
 * stock, catálogo, inventario ni tareaDiaria_. Al cerrar Caja se conserva además la sincronización
 * forzada final de cajaCerrar_, de modo que el trigger reduce el desfase pero no sustituye el cierre.
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
 * Sincronización financiera periódica exclusiva de la fase Caja.
 *
 * Se consulta HOY + AYER igual que el sincronizador histórico: esto permite recoger ventas/pagos
 * que FUDO terminó de cerrar tarde y hace que al llegar al siguiente turno el día anterior ya esté
 * prácticamente consolidado. Las operaciones son idempotentes por los IDs reales de FUDO.
 */
function fudoSincronizacionCajaAutomatica_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('FUDO_API_KEY') || !props.getProperty('FUDO_API_SECRET')) {
    return { ok: true, omitida: 'sin_credenciales' };
  }

  const hoy = new Date();
  const ayer = new Date(hoy.getTime());
  ayer.setDate(ayer.getDate() - 1);
  const fechaDesde = formatearFecha_(ayer);
  const fechaHasta = formatearFecha_(hoy);
  const usuarioAutomatico = {
    id: 'sistema-fudo',
    nombre: 'Sincronización automática FUDO',
    rol: 'Administrador',
    sede: 'Ambas'
  };

  const resultado = { ok: true, fecha_desde: fechaDesde, fecha_hasta: fechaHasta, ventas: null, pagos: null };

  try {
    resultado.ventas = fudoApiSincronizarVentas_(fechaDesde, fechaHasta, usuarioAutomatico, {});
    if (resultado.ventas && resultado.ventas.ok === false) resultado.ok = false;
  } catch (err) {
    resultado.ok = false;
    resultado.error_ventas = err && err.message ? err.message : String(err);
    Logger.log('fudoSincronizacionCajaAutomatica_ (ventas) falló: ' + resultado.error_ventas);
    if (typeof fudoApiSyncRegistrar_ === 'function') {
      fudoApiSyncRegistrar_('ventas', {
        ok: false,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        usuario: usuarioAutomatico.nombre,
        error: resultado.error_ventas
      });
    }
  }

  // Pagos se intenta aunque ventas falle. Si una sede queda temporalmente "Sin identificar", el
  // siguiente ciclo la corrige cuando la venta correspondiente ya esté sincronizada.
  try {
    resultado.pagos = fudoApiSincronizarPagos_(fechaDesde, fechaHasta, usuarioAutomatico, {});
    if (resultado.pagos && resultado.pagos.ok === false) resultado.ok = false;
  } catch (err) {
    resultado.ok = false;
    resultado.error_pagos = err && err.message ? err.message : String(err);
    Logger.log('fudoSincronizacionCajaAutomatica_ (pagos) falló: ' + resultado.error_pagos);
    if (typeof fudoApiSyncRegistrar_ === 'function') {
      fudoApiSyncRegistrar_('pagos', {
        ok: false,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        usuario: usuarioAutomatico.nombre,
        error: resultado.error_pagos
      });
    }
  }

  return resultado;
}

/**
 * Configuración de triggers durante la reactivación.
 *
 * Elimina cualquier trigger operativo anterior y crea SOLO el sincronizador financiero de FUDO
 * cada 15 minutos. Cuando termine la reactivación, Code.gs podrá volver a asumir su configuración
 * completa de triggers.
 */
function configurarTriggers() {
  let eliminados = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'tareaDiaria_' ||
        fn === 'fudoSincronizacionAutomatica_' ||
        fn === 'fudoSincronizacionCajaAutomatica_') {
      ScriptApp.deleteTrigger(t);
      eliminados++;
    }
  });

  if (reactivacionBackendActiva_()) {
    ScriptApp.newTrigger('fudoSincronizacionCajaAutomatica_').timeBased().everyMinutes(15).create();
    Logger.log('Reactivación: FUDO financiero cada 15 min. Stock/tarea diaria siguen apagados.');
    return { reactivacion: true, creados: 1, eliminados: eliminados, handler: 'fudoSincronizacionCajaAutomatica_' };
  }

  ScriptApp.newTrigger('tareaDiaria_').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('fudoSincronizacionAutomatica_').timeBased().everyMinutes(15).create();
  return { reactivacion: false, creados: 2, eliminados: eliminados };
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
