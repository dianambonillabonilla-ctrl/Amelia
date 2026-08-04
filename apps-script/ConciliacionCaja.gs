/**
 * CONCILIACIÓN CAJA → CAJA FUERTE
 *
 * Pedido real: "ayúdame a hacer desde que está la caja en el sistema la conciliación por que no me
 * cuadra dinero... se entrega dinero al administrador y se guarda en caja fuerte pero todo debe de
 * coincidir". Hasta ahora existían dos registros separados del mismo dinero, sin nada que los
 * cruzara:
 *   - Caja_Turno / Caja_Movimientos (caja.html): cuánto se entregó de verdad al administrador,
 *     turno por turno (ver cajaEntregadoTotalDia_ en CajaTurno.gs).
 *   - Base_Caja (base-caja.html): cuánto quedó anotado a mano como depositado en la Caja Fuerte
 *     ese día.
 *
 * cajaConciliacionListar_ recorre cada turno CERRADO desde que existe Caja_Turno y lo cruza contra
 * el registro de Base_Caja de esa misma fecha+sede, sede por sede — la Caja Fuerte es física y
 * propia de cada sede, San Antonio y Capri NUNCA se suman entre sí.
 */
function cajaConciliacionListar_(filtros, usuario) {
  filtros = filtros || {};
  cajaAsegurarEstructura_();

  let turnos = leerTabla_(SHEET_NAMES.CAJA_TURNO).filter(function (t) { return t.estado === 'Cerrado'; });
  if (filtros.sede) turnos = turnos.filter(function (t) { return t.sede === filtros.sede; });
  if (filtros.fecha_desde) turnos = turnos.filter(function (t) { return formatearFecha_(t.fecha) >= filtros.fecha_desde; });
  if (filtros.fecha_hasta) turnos = turnos.filter(function (t) { return formatearFecha_(t.fecha) <= filtros.fecha_hasta; });
  if (usuario && usuario.rol !== 'Administrador' && usuario.sede !== 'Ambas') {
    turnos = turnos.filter(function (t) { return sedeEscrituraPermitida_(usuario, t.sede); });
  }

  const baseCajaPorDiaSede = {};
  leerTabla_(SHEET_NAMES.BASE_CAJA).forEach(function (r) {
    baseCajaPorDiaSede[formatearFecha_(r.fecha) + '|' + r.sede] = r;
  });

  const filas = turnos.map(function (t) {
    const fecha = formatearFecha_(t.fecha);
    const entregasMovimiento = cajaMovimientosResumen_(cajaMovimientosDelDia_(fecha, t.sede)).entregas_administrador;
    const entregaCierre = Number(t.entrega_cierre) || 0;
    const entregadoTotal = Number((entregasMovimiento + entregaCierre).toFixed(2));
    const bc = baseCajaPorDiaSede[fecha + '|' + t.sede] || null;
    const cajaFuerte = bc ? (Number(bc.caja_fuerte) || 0) : null;
    const diferencia = cajaFuerte === null ? null : Number((cajaFuerte - entregadoTotal).toFixed(2));
    return {
      fecha: fecha,
      sede: t.sede,
      entregas_movimiento: Number(entregasMovimiento.toFixed(2)),
      entrega_cierre: entregaCierre,
      entregado_administrador_total: entregadoTotal,
      registrado_en_base_caja: !!bc,
      caja_fuerte_base_caja: cajaFuerte,
      diferencia: diferencia,
      cuadra: bc ? diferencia === 0 : null,
      cuadre_dia: bc ? (Number(bc.cuadre) || 0) : null,
      persona_recibe_cierre: t.persona_recibe_cierre || '',
      usuario_cierre: t.usuario_cierre || ''
    };
  }).sort(function (a, b) {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
    return String(a.sede).localeCompare(String(b.sede));
  });

  const resumen = { dias: filas.length, cuadran: 0, con_diferencia: 0, sin_registrar: 0, diferencia_total: 0 };
  filas.forEach(function (f) {
    if (f.cuadra === true) resumen.cuadran++;
    else if (f.cuadra === false) { resumen.con_diferencia++; resumen.diferencia_total += f.diferencia; }
    else resumen.sin_registrar++;
  });
  resumen.diferencia_total = Number(resumen.diferencia_total.toFixed(2));

  return { ok: true, data: filas, resumen: resumen };
}
