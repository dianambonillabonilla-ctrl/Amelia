/**
 * Endurecimiento final de Conciliación bancaria.
 * Se carga después de ZZZ_CajaConciliacionBancaria.gs y reemplaza únicamente helpers sensibles
 * para mantener la misma defensa de datos que usa el resto de DILANA OS.
 */
function cajaConcBancoAppend_(nombre, obj) {
  const sh = ss_().getSheetByName(nombre), hm = cajaConcBancoHeaderMap_(sh);
  sh.appendRow(hm.headers.map(function(h){
    const valor = obj[h] === undefined ? '' : obj[h];
    return typeof neutralizarFormula_ === 'function' ? neutralizarFormula_(valor) : valor;
  }));
}

// Bre-B puede mostrar fecha valor T+1, pero el movimiento debe seguir identificado con el día
// conciliado (por fecha de movimiento o por fecha valor). No se admite "todo lo del día siguiente"
// porque mezclaría ventas bancarias que realmente pertenecen al turno siguiente.
function cajaConcBancoMovimientoEnVentana_(mov, fecha) {
  const f1 = cajaConcBancoFecha_(mov && mov.fecha_movimiento);
  const f2 = cajaConcBancoFecha_(mov && mov.fecha_valor);
  return f1 === fecha || f2 === fecha;
}
