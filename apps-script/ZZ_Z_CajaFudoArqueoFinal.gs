/**
 * CIERRE FINAL DE CAJA — FUDO neto de gastos que impactan arqueo.
 *
 * Archivo temporal de reactivación cargado después de ZZ_ReactivacionFudo.gs. Estas funciones
 * sustituyen las versiones transitorias mientras Caja se valida. Al consolidar la reactivación
 * deberán moverse a CajaTurno.gs/FudoApi.gs y eliminar este archivo.
 */

/** Sincronización financiera de Caja: ventas + pagos + gastos que afectan arqueo. */
function cajaSincronizarFudo_(fecha, sede, usuario, forzar) {
  const fechaFmt = formatearFecha_(fecha);
  if (!cajaFudoCredencialesConfiguradas_()) {
    return { ok:true, aplica:false, fecha:fechaFmt, sede:sede, sincronizado_en:'', ventas:null, pagos:null, gastos:null, error:'' };
  }
  const cache = CacheService.getScriptCache();
  const key = cajaFudoCacheKey_(fechaFmt, sede);
  if (!forzar) return cajaLeerEstadoFudo_(fechaFmt, sede);

  const resultado = {
    ok:false, aplica:true, fecha:fechaFmt, sede:sede, sincronizado_en:new Date(),
    ventas:null, pagos:null, gastos:null, error:''
  };
  const errores = [];
  try {
    resultado.ventas = fudoApiSincronizarVentas_(fechaFmt, fechaFmt, usuario, { sede:'Automática' });
    if (!resultado.ventas || resultado.ventas.ok === false) errores.push(resultado.ventas && resultado.ventas.error ? resultado.ventas.error : 'No se sincronizaron las ventas.');
  } catch (e) { errores.push('Ventas: ' + (e && e.message ? e.message : String(e))); }

  try {
    resultado.pagos = fudoApiSincronizarPagos_(fechaFmt, fechaFmt, usuario, { sede:'Automática' });
    if (!resultado.pagos || resultado.pagos.ok === false) errores.push(resultado.pagos && resultado.pagos.error ? resultado.pagos.error : 'No se sincronizaron los pagos.');
  } catch (e) { errores.push('Pagos: ' + (e && e.message ? e.message : String(e))); }

  try {
    resultado.gastos = fudoApiSincronizarGastosArqueo_(fechaFmt, fechaFmt, usuario);
    if (!resultado.gastos || resultado.gastos.ok === false) errores.push(resultado.gastos && resultado.gastos.error ? resultado.gastos.error : 'No se sincronizaron los gastos de arqueo.');
  } catch (e) { errores.push('Gastos: ' + (e && e.message ? e.message : String(e))); }

  resultado.ok = errores.length === 0;
  resultado.error = errores.join(' | ');
  resultado.sincronizado_en = new Date();
  cache.put(key, JSON.stringify(resultado), CAJA_FUDO_CACHE_SEGUNDOS_);
  return resultado;
}

/**
 * Efectivo esperado del turno.
 *
 * FUDO aporta el efectivo cobrado y los gastos pagados en efectivo que efectivamente impactan una
 * caja registradora. DILANA aporta la custodia física (caja fuerte, entregas, otros ingresos).
 */
function cajaEfectivoEsperado_(apertura, movimientos, fecha, sede) {
  const movimientosTurno = cajaMovimientosVentanaTurno_(apertura, movimientos);
  const r = cajaMovimientosResumen_(movimientosTurno);
  const efectivoFudoActual = cajaEfectivoFudoDia_(fecha, sede);
  const efectivoFudoTurno = Math.max(0, efectivoFudoActual - (Number(apertura.efectivo_fudo_al_abrir) || 0));
  const gastosFudo = typeof fudoGastosArqueoTotalTurno_ === 'function'
    ? fudoGastosArqueoTotalTurno_(fecha, sede, apertura)
    : { total:0, cantidad:0 };

  const esperado = Number(apertura.base_inicial || 0)
    + efectivoFudoTurno
    - (Number(gastosFudo.total) || 0)
    + r.otros_ingresos
    + r.retiros_caja_fuerte
    - r.envios_caja_fuerte
    - r.entregas_admin_caja
    - r.gastos;

  const fuerte = Number(apertura.caja_fuerte_inicial || 0)
    + r.envios_caja_fuerte
    - r.retiros_caja_fuerte
    - r.entregas_admin_caja_fuerte;

  r.gastos_fudo_arqueo = Number(gastosFudo.total) || 0;
  r.gastos_fudo_arqueo_cantidad = Number(gastosFudo.cantidad) || 0;

  return {
    esperado:Number(esperado.toFixed(2)),
    caja_fuerte_esperada:Number(fuerte.toFixed(2)),
    pagos_efectivo_esperado:Number(efectivoFudoTurno.toFixed(2)),
    pagos_efectivo_dia:Number(efectivoFudoActual.toFixed(2)),
    gastos_fudo_arqueo:Number((Number(gastosFudo.total)||0).toFixed(2)),
    gastos_fudo_arqueo_cantidad:Number(gastosFudo.cantidad)||0,
    efectivo_fudo_neto:Number((efectivoFudoTurno-(Number(gastosFudo.total)||0)).toFixed(2)),
    resumen:r
  };
}

/** Sincronización automática financiera exclusiva de Caja: hoy + ayer. */
function fudoSincronizacionCajaAutomatica_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('FUDO_API_KEY') || !props.getProperty('FUDO_API_SECRET')) {
    return { ok:true, omitida:'sin_credenciales' };
  }
  const hoy = new Date();
  const ayer = new Date(hoy.getTime());
  ayer.setDate(ayer.getDate() - 1);
  const fechaDesde = formatearFecha_(ayer);
  const fechaHasta = formatearFecha_(hoy);
  const usuario = { id:'sistema-fudo', nombre:'Sincronización automática FUDO', rol:'Administrador', sede:'Ambas' };
  const resultado = { ok:true, fecha_desde:fechaDesde, fecha_hasta:fechaHasta, ventas:null, pagos:null, gastos:null };

  try { resultado.ventas = fudoApiSincronizarVentas_(fechaDesde, fechaHasta, usuario, {}); }
  catch (e) { resultado.ok=false; resultado.error_ventas=e.message||String(e); }
  try { resultado.pagos = fudoApiSincronizarPagos_(fechaDesde, fechaHasta, usuario, {}); }
  catch (e) { resultado.ok=false; resultado.error_pagos=e.message||String(e); }
  try { resultado.gastos = fudoApiSincronizarGastosArqueo_(fechaDesde, fechaHasta, usuario); }
  catch (e) { resultado.ok=false; resultado.error_gastos=e.message||String(e); }

  if (resultado.ventas && resultado.ventas.ok === false) resultado.ok=false;
  if (resultado.pagos && resultado.pagos.ok === false) resultado.ok=false;
  if (resultado.gastos && resultado.gastos.ok === false) resultado.ok=false;
  return resultado;
}
