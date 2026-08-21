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

// Bre-B puede tener fecha valor T+1, pero el movimiento debe pertenecer al día conciliado.
// No se admite "todo lo del día siguiente" porque mezclaría ventas reales del día siguiente.
function cajaConcBancoMovimientoEnVentana_(mov, fecha) {
  const f1 = cajaConcBancoFecha_(mov && mov.fecha_movimiento);
  const f2 = cajaConcBancoFecha_(mov && mov.fecha_valor);
  return f1 === fecha || f2 === fecha;
}
